"use client"

import { useEffect, useRef, useState } from "react"
import { useRegisterCommentSave } from "@/components/comments/comment-save-coordinator"
import { DraftConflictTools } from "./DraftConflictTools"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Loader2, Plus, Sparkles, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import type { SettingType } from "@/generated/prisma/enums"
import { buildTabId, useTabsStore } from "@/stores/tabs"

import { apiGet, apiSend } from "./api"
import { SETTING_TYPE_LABELS } from "./labels"
import { isSingletonSettingType } from "@/lib/setting-types"
import type { ContentPanelProps } from "./registry"
import { SettingContentEditor } from "./SettingContentEditor"
import {
  defaultContent,
  isTextSettingType,
  normalizeContent,
  type SettingContent,
} from "./setting-content"
import {
  SaveStatusIndicator,
  useAutosave,
  useExternalSyncKey,
  useOwnSyncTokens,
} from "./use-autosave"

export interface SettingItem {
  id: string
  type: SettingType
  name: string
  content: unknown
  version: number
  worldId: string | null
  parentId: string | null
}

/** 从 AI 输出中提取 JSON（兼容 ```json 代码块），失败返回 null */
function extractJson(raw: string): unknown | null {
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidates = [fence?.[1], raw]
  for (const c of candidates) {
    if (!c) continue
    try {
      return JSON.parse(c.trim())
    } catch {
      // 尝试下一个候选
    }
  }
  return null
}

/** 把 AI 结果采用为设定 content：结构化类型尝试 JSON 解析，纯文本类型直接采用原文 */
function adoptAssistText(type: SettingType, raw: string): SettingContent | null {
  const parsed = extractJson(raw)
  if (parsed !== null) return normalizeContent(type, parsed)
  if (isTextSettingType(type)) {
    return { text: raw.trim() }
  }
  return null
}

/** 单个设定的编辑区（key=setting.id，切换条目时重置本地状态）；worldId 用于世界级设定的 AI 辅助上下文 */
export function SettingEditor({
  novelId,
  setting,
  settingType,
  worldId,
  focusConcept,
  singleton,
  onSaved,
  onDirtyChange,
  onDeleted,
}: {
  novelId: string
  setting: SettingItem
  settingType: SettingType
  worldId?: string | null
  /** 对话区实体芯片带来的子概念定位请求：滚动到该概念并高亮；key 变化即重新触发 */
  focusConcept?: { name: string; key: number }
  /** 单例设定（文风设定）：隐藏名称输入与删除入口 */
  singleton?: boolean
  /* 保存成功回传服务端 version：父层登记为自己的回写，避免 key 重挂载重置编辑器 */
  onSaved: (version: number) => void
  onDirtyChange: (dirty: boolean) => void
  onDeleted: () => void
}) {
  const queryClient = useQueryClient()
  const openTab = useTabsStore((s) => s.openTab)
  const [name, setName] = useState(setting.name)
  const nameRef = useRef(setting.name)
  const [content, setContent] = useState<SettingContent>(() =>
    normalizeContent(settingType, setting.content)
  )
  const contentRef = useRef(content)
  const versionRef = useRef(setting.version)
  const saveRequests = useRef(new Map<string, { name: string; content: SettingContent; operationId: string; expectedVersion: number }>())
  const [conflict, setConflict] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [assistOpen, setAssistOpen] = useState(false)
  const [instruction, setInstruction] = useState("")
  const [assistText, setAssistText] = useState<string | null>(null)

  const save = async (value: { name: string; content: SettingContent }, attempt: { operationId: string }) => {
    if (!saveRequests.current.has(attempt.operationId)) saveRequests.current.set(attempt.operationId, { ...value, operationId: attempt.operationId, expectedVersion: versionRef.current })
    const res = await apiSend<{
      setting: SettingItem
      cascadeJobId: string | null
      cascadeAffectedCount: number
    }>(
      `/api/novels/${novelId}/settings/${setting.id}`,
      "PATCH",
      saveRequests.current.get(attempt.operationId),
      "保存设定失败"
    )
    versionRef.current = res.setting.version
    saveRequests.current.delete(attempt.operationId); setConflict(null); onSaved(res.setting.version)
    // 触发了级联修订：刷新侧边栏角标并提示跳转查看
    if (res.cascadeJobId) {
      queryClient.invalidateQueries({ queryKey: ["cascade", novelId] })
      toast.info(`内容已更新，检测到 ${res.cascadeAffectedCount} 处受影响内容待修订`, {
        duration: 10000,
        action: {
          label: "查看修订",
          onClick: () =>
            openTab({
              id: buildTabId("cascade", novelId),
              type: "cascade",
              novelId,
              title: "级联修订",
            }),
        },
      })
    }
  }

  const { status, schedule, saveNow, flush, controller, retry } = useAutosave(async (value: { name: string; content: SettingContent }, attempt) => {
    try { await save(value, attempt) } catch (error) { setConflict((error as Error).message); throw error }
  })
  useEffect(() => { onDirtyChange(status === "pending" || status === "saving" || status === "error") }, [status, onDirtyChange])
  useRegisterCommentSave(novelId, "SETTING", setting.id, {
    identity: controller,
    flush, revision: () => controller.revision,
    read: () => ({ text: "text" in contentRef.current ? contentRef.current.text : "", version: versionRef.current }),
    pause: () => { controller.pause(); onDirtyChange(true) },
    conflict: message => { controller.pause(); setConflict(message); onDirtyChange(true) },
    receive: (receipt, text, localRevision) => {
      if (receipt.version === null) throw new Error("缺少设定版本回执")
      if (receipt.version < versionRef.current) return
      onSaved(receipt.version)
      if (!controller.confirmExternal(localRevision)) { setConflict("评论保存期间有新输入，本地草稿已保留，请比较当前稿"); return }
      versionRef.current = receipt.version
      const next = { ...contentRef.current, text }; contentRef.current = next; setContent(next)
      controller.resume(); setConflict(null); onDirtyChange(false)
    },
  })

  const updateContent = (next: SettingContent) => {
    // Preserve fields supplied by chat that this editor does not render.
    const merged = { ...contentRef.current, ...next }
    onDirtyChange(true); contentRef.current = merged
    setContent(merged)
    schedule({ name: nameRef.current, content: merged })
  }

  const updateName = (next: string) => {
    onDirtyChange(true)
    nameRef.current = next
    setName(next)
    if (next.trim()) schedule({ name: next, content: contentRef.current })
  }

  const deleteMutation = useMutation({
    mutationFn: () =>
      apiSend(`/api/novels/${novelId}/settings/${setting.id}`, "DELETE", undefined, "删除失败"),
    onSuccess: () => {
      toast.success("设定已删除")
      setConfirmDelete(false)
      onDeleted()
    },
    onError: (err) => toast.error(err.message),
  })

  const assistMutation = useMutation({
    mutationFn: () =>
      apiSend<{ text: string }>(
        `/api/novels/${novelId}/settings/assist`,
        "POST",
        { type: settingType, name, currentContent: content, instruction, worldId },
        "AI 生成失败"
      ),
    onSuccess: (data) => setAssistText(data.text),
    onError: (err) => toast.error(err.message),
  })

  const adopt = () => {
    if (!assistText) return
    const adopted = adoptAssistText(settingType, assistText)
    if (!adopted) {
      toast.error("AI 结果无法解析为该设定的结构，请手动整理")
      return
    }
    updateContent(adopted)
    saveNow()
    setAssistOpen(false)
    setAssistText(null)
    setInstruction("")
    toast.success("已采用 AI 生成内容")
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {conflict && <div role="alert" className="text-sm text-destructive">{conflict}<Button size="sm" variant="ghost" onClick={() => void retry().catch(error => toast.error(error.message))}>重试原保存</Button>
        <DraftConflictTools
          readLocal={() => ({ title: nameRef.current, text: "text" in contentRef.current ? contentRef.current.text : JSON.stringify(contentRef.current, null, 2), data: { version: versionRef.current, content: contentRef.current } })}
          readCurrent={async () => {
            const { settings } = await apiGet<{ settings: SettingItem[] }>(`/api/novels/${novelId}/settings?${worldId ? `worldId=${worldId}` : `type=${settingType}`}`)
            const current = settings.find(row => row.id === setting.id); if (!current) throw new Error("设定已不存在，本地草稿仍保留")
            const content = normalizeContent(settingType, current.content)
            return { title: current.name, text: "text" in content ? content.text : JSON.stringify(content, null, 2), data: { version: current.version, content } }
          }}
          revision={() => controller.revision} pause={() => controller.pause()}
          saveLocal={async (current, local, operationId, revision) => {
            const { setting: saved } = await apiSend<{ setting: SettingItem }>(`/api/novels/${novelId}/settings/${setting.id}`, "PATCH", { name: local.title, content: local.data.content, operationId, expectedVersion: current.data.version })
            onSaved(saved.version)
            if (!controller.confirmExternal(revision)) throw new Error("已保存比较稿，期间的新输入已保留，请重新比较")
            const next = normalizeContent(settingType, saved.content); versionRef.current = saved.version; nameRef.current = saved.name; contentRef.current = next; setName(saved.name); setContent(next); setConflict(null); onDirtyChange(false)
          }}
          adoptCurrent={(current, revision) => {
            if (!controller.confirmExternal(revision)) throw new Error("仍有未确认的保存，请稍后核对")
            versionRef.current = current.data.version; nameRef.current = current.title; contentRef.current = current.data.content; setName(current.title); setContent(current.data.content); onSaved(current.data.version); setConflict(null); onDirtyChange(false)
          }}
        />
      </div>}
      <div className="flex items-center gap-3">
        {!singleton && (
          <Input
            value={name}
            onChange={(e) => updateName(e.target.value)}
            onBlur={() => saveNow()}
            placeholder="设定名称"
            className="max-w-64 font-medium"
          />
        )}
        {!singleton && <Badge variant="secondary">v{setting.version}</Badge>}
        <SaveStatusIndicator status={status} />
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setAssistText(null)
              setAssistOpen(true)
            }}
          >
            <Sparkles />
            AI 辅助生成
          </Button>
          {!singleton && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="删除该设定"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="text-muted-foreground" />
            </Button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        <SettingContentEditor
          settingType={settingType}
          value={content}
          onChange={updateContent}
          onBlur={() => saveNow()}
          commentsTarget={{ novelId, targetType: "SETTING", targetId: setting.id }}
          focusConcept={focusConcept}
          settingName={setting.name}
          settingId={setting.id}
        />
      </div>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除设定</DialogTitle>
            <DialogDescription>
              确定要删除「{setting.name}」吗？该操作不可撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate()}
            >
              {deleteMutation.isPending && <Loader2 className="animate-spin" />}
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={assistOpen}
        onOpenChange={(open) => {
          setAssistOpen(open)
          if (!open) {
            setAssistText(null)
            assistMutation.reset()
          }
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>AI 辅助生成 · {SETTING_TYPE_LABELS[settingType]}</DialogTitle>
            <DialogDescription>
              基于小说主题与已有设定生成初稿，预览确认后再采用。
            </DialogDescription>
          </DialogHeader>
          {assistText === null ? (
            <div className="flex flex-col gap-3">
              <Textarea
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                placeholder="补充你的想法（可选），如：想要一个以东方王朝为骨架的世界观"
                rows={3}
              />
              <DialogFooter>
                <Button
                  disabled={assistMutation.isPending}
                  onClick={() => assistMutation.mutate()}
                >
                  {assistMutation.isPending && <Loader2 className="animate-spin" />}
                  生成
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="flex min-h-0 flex-col gap-3">
              <div className="max-h-80 overflow-y-auto rounded-lg bg-muted/60 p-3 text-sm whitespace-pre-wrap">
                {assistText}
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  disabled={assistMutation.isPending}
                  onClick={() => {
                    setAssistText(null)
                  }}
                >
                  返回修改
                </Button>
                <Button onClick={adopt}>采用</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** 设定编辑（type=setting）：左侧条目列表 + 右侧结构化编辑区 */
export function SettingPanel({ novelId, settingType }: ContentPanelProps) {
  const queryClient = useQueryClient()
  // 初始选中：若对话面板实体芯片刚请求了本面板的设定聚焦，直接以它为初始值（只读快照，不消费）
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    const focus = useTabsStore.getState().panelFocus
    return settingType && focus?.tabId === buildTabId("setting", novelId, { settingType })
      ? focus.settingId
      : null
  })
  // 子概念定位请求（对话区点设定内概念芯片）：随选中条目传给编辑器滚动高亮；手动切换条目时清空
  const [conceptFocus, setConceptFocus] = useState<{ name: string; key: number } | null>(() => {
    const focus = useTabsStore.getState().panelFocus
    return settingType &&
      focus?.tabId === buildTabId("setting", novelId, { settingType }) &&
      focus.concept
      ? { name: focus.concept, key: Date.now() }
      : null
  })

  // 聚焦请求接力：挂载时消费初始读到的遗留请求；之后的新请求经订阅在回调里应用
  useEffect(() => {
    if (!settingType) return
    const tabId = buildTabId("setting", novelId, { settingType })
    const { panelFocus, consumePanelFocus } = useTabsStore.getState()
    if (panelFocus?.tabId === tabId) consumePanelFocus(tabId)
    return useTabsStore.subscribe((state) => {
      if (state.panelFocus?.tabId !== tabId) return
      const focus = useTabsStore.getState().consumePanelFocus(tabId)
      if (focus) {
        setSelectedId(focus.settingId)
        setConceptFocus(focus.concept ? { name: focus.concept, key: Date.now() } : null)
      }
    })
  }, [novelId, settingType])

  const { data, isLoading, isError } = useQuery({
    queryKey: ["settings", novelId, settingType],
    queryFn: () =>
      apiGet<{ settings: SettingItem[] }>(
        `/api/novels/${novelId}/settings?type=${settingType}`,
        "加载设定失败"
      ),
    enabled: !!settingType,
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["settings", novelId, settingType] })
    queryClient.invalidateQueries({ queryKey: ["novels"] })
    queryClient.invalidateQueries({ queryKey: ["novels", novelId] }); queryClient.invalidateQueries({queryKey: ["scene-factions", novelId]})
  }

  /* 自己的自动保存令牌登记（见 useOwnSyncTokens/useExternalSyncKey）：保存回写不再触发 key 重挂载 */
  const ownSaves = useOwnSyncTokens<number | null>()
  const [dirty, setDirty] = useState(false)

  const createMutation = useMutation({
    mutationFn: () => {
      const names = new Set((data?.settings ?? []).map((s) => s.name))
      let n = 1
      while (names.has(`未命名设定 ${n}`)) n += 1
      return apiSend<{ setting: SettingItem }>(
        `/api/novels/${novelId}/settings`,
        "POST",
        { type: settingType, name: `未命名设定 ${n}`, content: defaultContent(settingType!) },
        "创建失败"
      )
    },
    onSuccess: ({ setting }) => {
      invalidate()
      setSelectedId(setting.id)
      setConceptFocus(null)
    },
    onError: (err) => toast.error(err.message),
  })

  /* 派生数据与重挂载令牌必须在早退之前计算（hook 顺序稳定） */
  const settings = data?.settings ?? []
  const selected = settings.find((s) => s.id === selectedId) ?? settings[0] ?? null
  /* 外部写入才推进的重挂载令牌（自己的保存回写保持原 key） */
  const syncKey = useExternalSyncKey(selected?.version ?? null, ownSaves.isOwn, dirty)

  /* 单例设定（文风设定）每本小说恰有一条：无列表/新增/删除入口，缺失时打开面板自动创建 */
  const singleton = settingType ? isSingletonSettingType(settingType) : false
  const autoCreateFired = useRef(false)
  useEffect(() => {
    if (!singleton || !data || (data.settings?.length ?? 0) > 0) return
    if (autoCreateFired.current || createMutation.isPending) return
    autoCreateFired.current = true
    createMutation.mutate()
  }, [singleton, data, createMutation])

  if (!settingType) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        缺少设定类型参数
      </div>
    )
  }
  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    )
  }
  if (isError) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        设定加载失败，请稍后重试
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0">
      {!singleton && (
        <div className="flex w-52 shrink-0 flex-col border-r">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="text-sm font-medium">{SETTING_TYPE_LABELS[settingType]}</span>
            <Button
              variant="ghost"
              size="icon"
              aria-label="新增设定"
              disabled={createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {settings.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                还没有{SETTING_TYPE_LABELS[settingType]}
                <br />
                点击右上角 + 新增
              </p>
            ) : (
              settings.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(s.id)
                    setConceptFocus(null)
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                    selected?.id === s.id
                      ? "bg-primary/10 font-medium text-primary"
                      : "hover:bg-muted"
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{s.name}</span>
                  <span className="text-xs text-muted-foreground">v{s.version}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      <div className="min-w-0 flex-1 p-4">
        {selected ? (
          <SettingEditor
            key={`${selected.id}:${syncKey}`}
            novelId={novelId}
            setting={selected}
            onDirtyChange={setDirty}
            settingType={settingType}
            singleton={singleton}
            focusConcept={conceptFocus ?? undefined}
            onSaved={(version) => {
              ownSaves.track(version)
              invalidate()
            }}
            onDeleted={() => {
              invalidate()
              setSelectedId(null)
              setConceptFocus(null)
            }}
          />
        ) : singleton ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            新增一条{SETTING_TYPE_LABELS[settingType]}开始编辑
          </div>
        )}
      </div>
    </div>
  )
}
