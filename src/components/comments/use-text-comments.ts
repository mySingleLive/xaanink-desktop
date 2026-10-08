"use client"

import { useCallback, useMemo, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { browserTextHash } from "@/lib/text-baseline"
import { commentEditors, type CommentSaveCoordinator } from "./comment-save-coordinator"
import type { TextBaseline, TextReceipt } from "@/lib/services/target-text"

import type {
  CommentStatus,
  CommentsTarget,
  CreateCommentInput,
  TextCommentThread,
} from "./types"

/**
 * 行内评论数据层:按挂载目标(章大纲/章正文/世界观/设定)拉取评论线程,
 * 提供发表/回复/改状态/删除/AI 改写应用等变更,以及气泡展开收起的本地 UI 状态。
 * API 契约见 types.ts;失败提示统一走 sonner,同时错误继续上抛给调用方。
 */

/** 错误文案读取:422 锚点定位失败等响应体用 message 字段,其余多为 error,两者都认 */
async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string; message?: string }
    return data.message ?? data.error ?? fallback
  } catch {
    return fallback
  }
}

async function apiGet<T>(url: string, fallback: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw Object.assign(new Error(await readError(res, fallback)), { status: res.status })
  return (await res.json()) as T
}

async function apiSend<T>(
  url: string,
  method: "POST" | "PATCH" | "DELETE",
  body: unknown,
  fallback: string
): Promise<T> {
  const res = await fetch(url, {
    method,
    ...(body !== undefined
      ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
      : {}),
  })
  if (!res.ok) throw Object.assign(new Error(await readError(res, fallback)), { status: res.status })
  // DELETE 等可能无响应体,容忍空 body
  const text = await res.text()
  return (text ? (JSON.parse(text) as T) : (undefined as T))
}

export function useTextComments(novelId: string | undefined, target: CommentsTarget | undefined) {
  const queryClient = useQueryClient()
  const targetType = target?.targetType
  const targetId = target?.targetId
  const ready = !!novelId && !!targetType && !!targetId

  const queryKey = useMemo(() => ["comments", targetType, targetId], [targetType, targetId])

  const query = useQuery({
    queryKey,
    enabled: ready,
    queryFn: () =>
      apiGet<{ threads: TextCommentThread[] }>(
        `/api/novels/${novelId}/comments?targetType=${targetType}&targetId=${encodeURIComponent(targetId ?? "")}`,
        "加载评论失败"
      ),
    select: (data) => data.threads,
  })

  const threads = useMemo(() => query.data ?? [], [query.data])

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["comments", targetType, targetId] })
  }, [queryClient, targetType, targetId])

  const notifyError = useCallback((err: Error) => {
    toast.error(err.message)
  }, [])

  const { mutateAsync: createAsync } = useMutation({
    mutationFn: (input: CreateCommentInput) =>
      apiSend<{ comment: unknown }>(
        `/api/novels/${novelId}/comments`,
        "POST",
        {
          targetType,
          targetId,
          quote: input.quote,
          anchorHash: input.anchorHash,
          content: input.content,
          startOffset: input.startOffset,
          endOffset: input.endOffset,
        },
        "发表评论失败"
      ),
    onSuccess: invalidate,
    onError: notifyError,
  })

  const { mutateAsync: replyAsync } = useMutation({
    mutationFn: ({ threadId, content }: { threadId: string; content: string }) =>
      apiSend<{ comment: unknown }>(
        `/api/novels/${novelId}/comments/${threadId}/replies`,
        "POST",
        { content },
        "回复失败"
      ),
    onSuccess: invalidate,
    onError: notifyError,
  })

  const { mutateAsync: statusAsync } = useMutation({
    mutationFn: ({ id, status }: { id: string; status: CommentStatus }) =>
      apiSend<{ comment: unknown }>(
        `/api/novels/${novelId}/comments/${id}`,
        "PATCH",
        { status },
        "更新评论状态失败"
      ),
    onSuccess: invalidate,
    onError: notifyError,
  })

  const { mutateAsync: removeAsync } = useMutation({
    mutationFn: (id: string) =>
      apiSend<unknown>(`/api/novels/${novelId}/comments/${id}`, "DELETE", undefined, "删除评论失败"),
    onSuccess: invalidate,
    onError: notifyError,
  })

  /** AI 改写应用的进行中线程 id(一次只有一条;接口较慢,秒级~十几秒) */
  const [applyingId, setApplyingId] = useState<string | null>(null)
  const applyLock = useRef(false)
  const pendingCommits = useRef(new Map<string, { body: { action: "commit"; preparedId: string; operationId: string; baseline: TextBaseline }; editors: { coordinator: CommentSaveCoordinator; revision: number }[] }>())

  const createComment = useCallback(
    async (input: CreateCommentInput): Promise<void> => {
      if (!ready) throw new Error("评论目标未就绪")
      let anchorHash = input.anchorHash
      if (input.quote && input.sourceText !== undefined) {
        try {
          for (const editor of commentEditors(novelId!, targetType!, targetId!)) await editor.flush()
          anchorHash = await browserTextHash(input.sourceText)
        } catch (error) { notifyError(error as Error); throw error }
      }
      await createAsync({ ...input, anchorHash })
    },
    [ready, createAsync, novelId, targetType, targetId, notifyError]
  )

  const reply = useCallback(
    async (threadId: string, content: string): Promise<void> => {
      if (!ready) throw new Error("评论目标未就绪")
      await replyAsync({ threadId, content })
    },
    [ready, replyAsync]
  )

  const setStatus = useCallback(
    async (id: string, status: CommentStatus): Promise<void> => {
      if (!ready) throw new Error("评论目标未就绪")
      await statusAsync({ id, status })
    },
    [ready, statusAsync]
  )

  /** 三处入口共用两步协议，任何期间的新编辑都保留原基线，不被晚到回执覆盖。 */
  const apply = useCallback(async (id: string, opts?: { range?: "selection" | "paragraph" }) => {
    if (!ready || !novelId || !targetType || !targetId) throw new Error("评论目标未就绪")
    if (applyLock.current) throw new Error("已有评论正在处理")
    applyLock.current = true; setApplyingId(id)
    const url = `/api/novels/${novelId}/comments/${id}/apply`
    let pending = pendingCommits.current.get(id)
    try {
      if (!pending) {
        const registered = commentEditors(novelId, targetType, targetId)
        for (const coordinator of registered) await coordinator.flush()
        const boundaries = registered.map(coordinator => ({ coordinator, revision: coordinator.revision() }))
        const current = await apiGet<{ text: string; baseline: TextBaseline; commentUpdatedAt: string }>(url, "读取原文基线失败")
        for (const { coordinator, revision } of boundaries) {
          const local = coordinator.read()
          if (coordinator.revision() !== revision || local.text !== current.text || local.version !== current.baseline.version || (local.updatedAt && local.updatedAt !== current.baseline.updatedAt)) throw new Error("本地草稿与当前稿不同，请先保存或比较草稿")
        }
        const clicked = threads.find(thread => thread.id === id)
        if (!clicked || clicked.updatedAt !== current.commentUpdatedAt) throw new Error("评论已发生变化，请重新读取评论")
        const prepared = await apiSend<{ prepared: { id: string; baseline: TextBaseline } }>(url, "POST", { action: "prepare", operationId: crypto.randomUUID(), baseline: current.baseline, commentUpdatedAt: clicked.updatedAt, range: opts?.range }, "准备改写失败")
        const currentEditors = commentEditors(novelId, targetType, targetId)
        if (currentEditors.length !== boundaries.length || boundaries.some(({ coordinator }) => !currentEditors.some(current => current.identity === coordinator.identity))) throw new Error("编辑器已切换，请在当前稿中重新应用评论")
        for (const { coordinator, revision } of boundaries) {
          if (coordinator.revision() !== revision) throw new Error("准备改写期间有新输入，草稿已保留，请先保存再重新应用")
        }
        pending = { body: { action: "commit", preparedId: prepared.prepared.id, operationId: crypto.randomUUID(), baseline: prepared.prepared.baseline }, editors: boundaries }
        pendingCommits.current.set(id, pending)
      }
      for (const { coordinator } of pending.editors) coordinator.pause()
      const saved = await apiSend<{ receipt: TextReceipt; text: string; committed: true }>(url, "POST", pending.body, "提交改写失败；请重试原操作核对结果")
      for (const { coordinator, revision } of pending.editors) coordinator.receive(saved.receipt, saved.text, revision)
      pendingCommits.current.delete(id)
      invalidate()
      for (const queryKey of [["chapter", targetId], ["novels"], ["worlds", novelId], ["settings"], ["score-report", targetType, targetId], ["content-versions", targetId]]) void queryClient.invalidateQueries({ queryKey })
      return saved
    } catch (error) {
      const status = (error as { status?: number }).status
      if (pending) for (const { coordinator } of pending.editors) coordinator.conflict(status && status >= 400 && status < 500 ? "评论未提交，本地草稿已保留，请比较当前稿后重新应用" : "评论提交结果待核对，本地草稿已保留；重试原评论应用可读取首次回执")
      if (status && status >= 400 && status < 500) pendingCommits.current.delete(id)
      notifyError(error as Error)
      throw error
    } finally { applyLock.current = false; setApplyingId(null) }
  }, [ready, novelId, targetType, targetId, threads, invalidate, queryClient, notifyError])

  const remove = useCallback(
    async (id: string): Promise<void> => {
      if (!ready) throw new Error("评论目标未就绪")
      await removeAsync(id)
    },
    [ready, removeAsync]
  )

  /** 气泡总开关:false 时调用方隐藏全部气泡 */
  const [showAll, setShowAll] = useState(true)
  /** 显式设置过展开/收起的线程;未设置的按默认规则(OPEN 展开,AGREED/APPLIED 收起) */
  const [expandedOverrides, setExpandedOverrides] = useState<ReadonlyMap<string, boolean>>(
    new Map()
  )

  const isExpanded = useCallback(
    (thread: TextCommentThread): boolean =>
      expandedOverrides.get(thread.id) ?? thread.status === "OPEN",
    [expandedOverrides]
  )

  const toggleExpanded = useCallback(
    (id: string) => {
      setExpandedOverrides((prev) => {
        const thread = threads.find((t) => t.id === id)
        const current = prev.get(id) ?? (thread ? thread.status === "OPEN" : true)
        const next = new Map(prev)
        next.set(id, !current)
        return next
      })
    },
    [threads]
  )

  const expandedIds = useMemo<ReadonlySet<string>>(
    () => new Set(threads.filter(isExpanded).map((t) => t.id)),
    [threads, isExpanded]
  )

  return {
    threads,
    isLoading: query.isLoading,
    showAll,
    setShowAll,
    expandedIds,
    toggleExpanded,
    isExpanded,
    createComment,
    reply,
    setStatus,
    apply,
    applyingId,
    remove,
  }
}
