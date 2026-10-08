"use client"

/**
 * 候选采用共享动作（card-select F2/F7）：CandidatePanel 底部按钮与对话侧选卡操作面板
 * 同一链路——命中当前会话待答选稿问答走 answer 通道（不发 REST），否则 REST accept
 * （普通 / wordRangeAdjust 调档采用 / mode:"replace" 换用三形态）；成功后失效
 * ["content-candidates"] 与 ["chapter", chapterId] 缓存并按场景发推进/过渡检查消息。
 */
import { toast } from "sonner"
import { useQuery, type QueryClient } from "@tanstack/react-query"

import { replaceCheckMessage } from "@/lib/card-select-actions"
import type { ContentCheck } from "@/lib/content-policy"
import type { WordRequirement } from "@/lib/word-requirement"
import { dispatchChatSendMessage } from "@/components/chat/ui-events"
import { dispatchPendingAnswer, type PendingAnswerMatch } from "@/components/chat/pending-answer"

import { apiGet, apiSend, ApiError } from "./api"
import type { NovelDetail } from "./types"

/** 候选全文（GET …/candidates/{candidateId} 返回的 candidate；ContentCandidate 行 + wordCount） */
export interface CandidateDetail {
  id: string
  chapterId: string
  status: string
  content: string
  contentHash: string
  baseVersion: number
  wordCount: number
  variant?: string | null
  checks?: ContentCheck[]
  wordRequirement?: WordRequirement | null
}

/** 采用成功后的推进消息（CandidatePanel sendAdvance 的原文案，quiet 直发不带 toast） */
export function candidateAdvanceMessage(chapterTitle: string, label: string, wordCount: number): string {
  return `我已采用《${chapterTitle}》候选稿「${label}」（${wordCount.toLocaleString()} 字）。请核实采用结果，刷新本章评审，并给出后续环节（定稿或继续下一章）。`
}

export interface AcceptCandidateArgs {
  novelId: string
  chapterTitle: string
  /** 当前章（replace 模式的版本 CAS 对象） */
  chapter: { id: string; version: number }
  candidate: CandidateDetail
  /** 角度中文名（immersive → 沉浸氛围） */
  label: string
  /** 命中当前会话待答选稿问答的选项：走 answer 通道，不发 REST */
  answerMatch: PendingAnswerMatch | null
  /** 换用：以当前章版本 CAS 替换正文，原采用稿撤回（card-select F7） */
  mode?: "replace"
  /** 调整字数范围后采用（card-select F2）：服务端先调本章规划档再复评采用 */
  wordRangeAdjust?: { wordMin: number; wordBudget: number }
  /** 换用且本章之后已有后续章节正文：成功后发换用过渡检查指令（否则发推进消息） */
  hasLaterChapters?: boolean
  queryClient: QueryClient
  refetchDetail?: () => Promise<unknown> | void
}

export type AcceptCandidateResult = { ok: true } | { ok: false; message: string }

/** 本章之后已有正文的后续章节数（小说详情缓存 ["novels", novelId]，仅作换用提示与分流） */
export function useLaterChapterCount(novelId: string, chapterId: string | null | undefined): number {
  const { data } = useQuery({
    queryKey: ["novels", novelId],
    queryFn: () => apiGet<{ novel: NovelDetail }>(`/api/novels/${novelId}`, "加载小说详情失败"),
    enabled: !!chapterId,
  })
  if (!chapterId || !data) return 0
  const flat = data.novel.volumes
    .slice()
    .sort((a, b) => a.index - b.index)
    .flatMap((v) => v.chapters.slice().sort((a, b) => a.index - b.index))
  const pos = flat.findIndex((c) => c.id === chapterId)
  return pos >= 0 ? flat.slice(pos + 1).filter((c) => c.wordCount > 0).length : 0
}

export async function acceptCandidateAction(args: AcceptCandidateArgs): Promise<AcceptCandidateResult> {
  const { novelId, chapterTitle, candidate, label, answerMatch } = args
  if (answerMatch) {
    dispatchPendingAnswer(answerMatch, novelId)
    toast.info("已提交选稿回答，对话将继续采用流程")
    return { ok: true }
  }
  const replace = args.mode === "replace"
  try {
    await apiSend(`/api/novels/${novelId}/chapters/${candidate.chapterId}/candidates/${candidate.id}/accept`, "POST", {
      expectedVersion: replace ? args.chapter.version : candidate.baseVersion,
      operationId: `ui-accept-${candidate.id}${replace ? "-replace" : ""}${args.wordRangeAdjust ? "-adjust" : ""}`,
      candidateHash: candidate.contentHash,
      ...(replace ? { mode: "replace" } : {}),
      ...(args.wordRangeAdjust ? { wordRangeAdjust: args.wordRangeAdjust } : {}),
    })
    toast.success(
      args.wordRangeAdjust
        ? `已调整本章字数档为 ${args.wordRangeAdjust.wordMin.toLocaleString()}–${args.wordRangeAdjust.wordBudget.toLocaleString()} 并采用《${chapterTitle}》候选稿（${candidate.wordCount.toLocaleString()} 字）`
        : replace
          ? `已用候选稿「${label}」替换《${chapterTitle}》正文（${candidate.wordCount.toLocaleString()} 字）`
          : `已采用《${chapterTitle}》候选稿（${candidate.wordCount.toLocaleString()} 字），可继续定稿`
    )
    await Promise.all([
      args.queryClient.invalidateQueries({ queryKey: ["content-candidates"] }),
      args.queryClient.invalidateQueries({ queryKey: ["chapter", candidate.chapterId] }),
    ])
    await args.refetchDetail?.()
    if (replace && args.hasLaterChapters) {
      dispatchChatSendMessage(
        replaceCheckMessage({ chapterTitle, label, chapterId: candidate.chapterId, candidateId: candidate.id, wordCount: candidate.wordCount }),
        novelId
      )
      toast.info("已发到对话，参谋将检查与后续章节的过渡与一致性")
    } else {
      dispatchChatSendMessage(candidateAdvanceMessage(chapterTitle, label, candidate.wordCount), novelId)
    }
    return { ok: true }
  } catch (error) {
    // CANDIDATE_STALE / 版本冲突等：原样展示服务端 message，并引导刷新候选状态
    const message = error instanceof Error ? error.message : "采用失败"
    toast.error(message)
    if (error instanceof ApiError && (error.status === 409 || error.code?.startsWith("CANDIDATE"))) {
      await args.queryClient.invalidateQueries({ queryKey: ["content-candidates"] })
      await args.refetchDetail?.()
    }
    return { ok: false, message }
  }
}
