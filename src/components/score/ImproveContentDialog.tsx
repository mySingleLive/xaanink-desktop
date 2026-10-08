"use client"

/**
 * 正文改进对话框（评审视图「改进正文」）：抽卡数量 / 字数范围 / 改进项列表（维度·AI 评审建议·用户建议·自定义）配置，
 * 然后选择在当前对话或新对话中执行——执行体是以当前正文为底稿的抽卡任务（chatAction improve+draw）。
 * 交互规则（默认勾选、维度联动）的唯一来源是 @/lib/improve-draw 的纯函数；
 * 配置按 targetId 记忆于会话内 store（use-improve-dialog-settings，不写库）。
 */
import { useEffect, useMemo, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"

import { apiGet } from "@/components/content/api"
import { dispatchChatSendMessage } from "@/components/chat/ui-events"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { REDRAW_DEFAULT_COUNT, REDRAW_MAX_COUNT, redrawWordRangeError } from "@/lib/draw-redraw"
import {
  applyImproveItemToggle, applyImproveItemsBulk, customItemId, defaultUncheckedIds, dimensionItems,
  improveDrawAction, improveDrawInstruction,
  type ImprovementItem, type ImproveItemsPayload,
} from "@/lib/improve-draw"
import { cn } from "@/lib/utils"
import { useChatStore } from "@/stores/chat"

import { useImproveDialogSettings, type ImproveDialogCustomItem } from "./use-improve-dialog-settings"
import type { ScoreReport } from "./use-score-report"

const GROUP_ORDER: { key: string; title: string; match: (item: ImprovementItem) => boolean }[] = [
  { key: "dimension", title: "改进维度", match: (i) => i.group === "dimension" },
  { key: "ai", title: "AI 评审建议", match: (i) => i.group === "report" || i.group === "ai-comment" },
  { key: "user", title: "用户建议", match: (i) => i.group === "user-comment" },
  { key: "custom", title: "自定义改进项", match: (i) => i.group === "custom" },
]

export function ImproveContentDialog({ novelId, report, onClose }: { novelId: string; report: ScoreReport; onClose: () => void }) {
  const targetId = report.targetId
  const { data, isLoading, error } = useQuery({
    queryKey: ["improve-items", report.targetType, targetId],
    queryFn: () =>
      apiGet<{ payload: ImproveItemsPayload }>(
        `/api/novels/${novelId}/score-report/improve-items?targetType=${report.targetType}&targetId=${targetId}`,
        "加载改进项失败"
      ),
    staleTime: 0,
  })
  const payload = data?.payload

  const saved = useImproveDialogSettings((s) => s.byTarget[targetId])

  const [count, setCount] = useState(saved?.count ?? REDRAW_DEFAULT_COUNT)
  const [wordMin, setWordMin] = useState(saved ? String(saved.wordMin) : "")
  const [wordBudget, setWordBudget] = useState(saved ? String(saved.wordBudget) : "")
  const [unchecked, setUnchecked] = useState<Set<string> | null>(null)
  const [customItems, setCustomItems] = useState<ImproveDialogCustomItem[]>(saved?.customItems ?? [])
  const [customDraft, setCustomDraft] = useState("")
  const [inited, setInited] = useState(false)

  // 聚合载荷到达即派生初始态（React 官方 render-adjust 模式：渲染期判守卫后 setState，立即重渲染）：
  // store 记忆优先，否则默认勾选规则 + 本章规划字数档
  if (payload && !inited) {
    setInited(true)
    if (!saved) {
      setWordMin(String(payload.wordMin))
      setWordBudget(String(payload.wordBudget))
    }
    setUnchecked(saved ? new Set(saved.uncheckedIds) : defaultUncheckedIds(payload.dimensions, payload.items))
  }

  const customRows = useMemo<ImprovementItem[]>(
    () => customItems.map((c) => ({ id: c.id, group: "custom", label: "自定义", text: c.text })),
    [customItems]
  )
  const rows = useMemo<ImprovementItem[]>(
    () => (payload ? [...dimensionItems(payload.dimensions), ...payload.items, ...customRows] : customRows),
    [payload, customRows]
  )
  const ready = !!payload && unchecked !== null
  const checkedRows = unchecked ? rows.filter((r) => !unchecked.has(r.id)) : []

  const toggle = (id: string) => setUnchecked((prev) => (prev ? applyImproveItemToggle(rows, prev, id) : prev))
  const bulk = (ids: string[], target: boolean) => setUnchecked((prev) => (prev ? applyImproveItemsBulk(rows, prev, ids, target) : prev))

  const addCustom = () => {
    const text = customDraft.trim()
    if (!text) return
    if (customItems.some((c) => c.text === text)) { setCustomDraft(""); return }
    setCustomItems((prev) => [...prev, { id: customItemId(), text }])
    setCustomDraft("")
  }
  const removeCustom = (id: string) => setCustomItems((prev) => prev.filter((c) => c.id !== id))

  // 配置按章记忆：取消/执行/遮罩关闭都保留（不写库，仅会话内）
  const latest = useRef({ count, wordMin, wordBudget, customItems, unchecked })
  useEffect(() => {
    latest.current = { count, wordMin, wordBudget, customItems, unchecked }
  })
  const persist = () => {
    const s = latest.current
    if (!s.unchecked || !payload) return
    const min = Number(s.wordMin)
    const max = Number(s.wordBudget)
    useImproveDialogSettings.getState().setSettings(targetId, {
      count: s.count,
      wordMin: Number.isInteger(min) && min >= 1 ? min : payload.wordMin,
      wordBudget: Number.isInteger(max) && max >= 1 ? max : payload.wordBudget,
      customItems: s.customItems,
      uncheckedIds: [...s.unchecked],
    })
  }
  const close = () => { persist(); onClose() }

  // 字数校验：载荷未到时输入框为空串，不报错；初始化后必有值，清空输入即报错
  const wordError = wordMin === "" && wordBudget === "" ? null : redrawWordRangeError(Number(wordMin), Number(wordBudget))
  const canExecute = ready && !wordError && checkedRows.length > 0

  const buildTask = () => {
    if (!payload || !unchecked || !canExecute) return null
    const config = { count, wordMin: Number(wordMin), wordBudget: Number(wordBudget) }
    return {
      draft: improveDrawInstruction({
        targetLabel: report.targetLabel,
        planned: { wordMin: payload.wordMin, wordBudget: payload.wordBudget },
        config,
        items: checkedRows,
      }),
      action: improveDrawAction({ targetId, config, items: checkedRows }),
    }
  }

  /** 主按钮：新建会话并自动发送（沿用 requestNewConversation autoSend 守卫） */
  const executeInNew = () => {
    const task = buildTask()
    if (!task) return
    persist()
    useChatStore.getState().requestNewConversation({ novelId, draft: task.draft, action: task.action, autoSend: true })
    useChatStore.getState().requestChatFocus()
    onClose()
  }

  /** 次按钮：注入当前打开的会话（作品不匹配时由 ChatPanel 回退新会话；生成中排队） */
  const executeInCurrent = () => {
    const task = buildTask()
    if (!task) return
    persist()
    dispatchChatSendMessage(task.draft, novelId, { action: task.action })
    useChatStore.getState().requestChatFocus()
    onClose()
  }

  const renderRow = (row: ImprovementItem) => {
    const on = !unchecked?.has(row.id)
    return (
      <div
        key={row.id}
        role="checkbox"
        aria-checked={on}
        tabIndex={0}
        data-testid={`improve-item-${row.id}`}
        className={cn(
          "flex cursor-pointer items-start gap-2.5 rounded-inner px-1.5 py-1.5 transition-colors hover:bg-hover-wash",
          !on && "opacity-50"
        )}
        onClick={() => toggle(row.id)}
        onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); toggle(row.id) } }}
      >
        <Checkbox
          checked={on}
          onCheckedChange={() => toggle(row.id)}
          onClick={(e) => e.stopPropagation()}
          className="mt-[3px]"
          aria-label={row.label}
        />
        <div className="min-w-0 flex-1 text-[12.5px] leading-[1.55]">
          <div className="flex items-baseline gap-1.5">
            <span className="shrink-0 rounded-full bg-primary/10 px-2 text-[11px] leading-[1.7] text-primary">{row.label}</span>
            <span className="line-clamp-2 min-w-0 text-foreground/90">{row.text}</span>
          </div>
          {row.suggestion && (
            <p className="line-clamp-2 text-[11.5px] text-muted-foreground"><b className="font-medium">建议：</b>{row.suggestion}</p>
          )}
          {row.quote && (
            <p className="mt-0.5 truncate border-l-2 border-primary/60 pl-1.5 text-[11px] text-muted-foreground/85">{row.quote}</p>
          )}
        </div>
        {row.group === "custom" && (
          <button
            type="button"
            aria-label="删除"
            data-testid={`improve-custom-del-${row.id}`}
            className="shrink-0 rounded-inner px-1 text-[11px] text-muted-foreground hover:bg-hover-wash hover:text-destructive"
            onClick={(e) => { e.stopPropagation(); removeCustom(row.id) }}
          >
            ✕
          </button>
        )}
      </div>
    )
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) close() }}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-xl" data-testid="improve-dialog">
        <DialogHeader className="border-b border-border px-4 pb-2.5 pt-3.5">
          <DialogTitle className="text-[14.5px]">改进正文 · {report.targetLabel.replace(/正文$/, "").trim()}</DialogTitle>
          <DialogDescription className="text-[11.5px]">
            以当前正文{payload ? `（${payload.contentWordCount.toLocaleString()} 字）` : ""}为底稿，按勾选的改进项抽卡生成候选稿；原稿不被替换
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-x-5 gap-y-2 border-b border-border px-4 py-3">
          <div className="flex items-center gap-2 text-[12.5px]">
            <span className="shrink-0 text-muted-foreground">抽卡数量</span>
            <div className="flex overflow-hidden rounded-inner border border-border">
              {Array.from({ length: REDRAW_MAX_COUNT }, (_, i) => i + 1).map((c) => (
                <button
                  key={c}
                  type="button"
                  data-testid={`improve-count-${c}`}
                  onClick={() => setCount(c)}
                  className={cn(
                    "border-l border-border px-2.5 py-[3px] text-[11.5px] first:border-l-0",
                    c === count ? "bg-selected-surface font-medium text-primary" : "text-muted-foreground hover:bg-hover-wash"
                  )}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-[12.5px]">
            <span className="shrink-0 text-muted-foreground">字数范围</span>
            <input
              data-testid="improve-word-min"
              value={wordMin}
              onChange={(e) => setWordMin(e.target.value)}
              inputMode="numeric"
              className={cn("w-[62px] rounded-inner border bg-transparent px-1.5 py-[3px] text-right text-[12px] text-foreground outline-none focus:border-ring", wordError ? "border-destructive" : "border-input")}
            />
            <span className="shrink-0 text-muted-foreground">～</span>
            <input
              data-testid="improve-word-max"
              value={wordBudget}
              onChange={(e) => setWordBudget(e.target.value)}
              inputMode="numeric"
              className={cn("w-[62px] rounded-inner border bg-transparent px-1.5 py-[3px] text-right text-[12px] text-foreground outline-none focus:border-ring", wordError ? "border-destructive" : "border-input")}
            />
            <span className="shrink-0 text-muted-foreground">字</span>
          </div>
          {wordError
            ? <p role="alert" className="w-full text-[11px] text-destructive">{wordError}</p>
            : <p className="w-full text-[10.5px] text-muted-foreground">字数范围仅作用本批候选，不改卷章大纲</p>}
        </div>

        <div className="flex items-baseline gap-2 px-4 pb-1 pt-2.5 text-[12.5px] font-medium">
          改进项
          <span className="text-[11.5px] font-normal text-muted-foreground" data-testid="improve-count-label">
            已选 {checkedRows.length} / {rows.length} · 未勾选项不做任何处理
          </span>
          <span className="ml-auto flex gap-1">
            <button type="button" data-testid="improve-select-all" className="rounded-inner px-1.5 py-0.5 text-[11.5px] font-normal text-muted-foreground hover:bg-hover-wash hover:text-foreground" onClick={() => bulk(rows.map((r) => r.id), true)}>全选</button>
            <button type="button" data-testid="improve-select-none" className="rounded-inner px-1.5 py-0.5 text-[11.5px] font-normal text-muted-foreground hover:bg-hover-wash hover:text-foreground" onClick={() => bulk(rows.map((r) => r.id), false)}>清空</button>
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-2" data-testid="improve-items">
          {isLoading && (
            <div className="flex flex-col gap-2 px-1.5 py-2" role="status">
              {[0, 1, 2].map((i) => <div key={i} className="h-7 animate-pulse rounded-inner bg-muted" />)}
            </div>
          )}
          {error && <p role="alert" className="px-1.5 py-2 text-[12px] text-destructive">{error.message}</p>}
          {ready && GROUP_ORDER.map(({ key, title, match }) => {
            const groupRows = rows.filter(match)
            if (key === "custom" || groupRows.length > 0) {
              const onCount = groupRows.filter((r) => !unchecked.has(r.id)).length
              const allOn = groupRows.length > 0 && onCount === groupRows.length
              return (
                <div key={key} data-testid={`improve-group-${key}`}>
                  <div className="flex items-center gap-2 px-1.5 pb-0.5 pt-2 text-[11.5px] font-medium tracking-wide text-muted-foreground">
                    {title}
                    {groupRows.length > 0 && <span className="font-normal">{onCount}/{groupRows.length}</span>}
                    {groupRows.length > 0 && (
                      <button
                        type="button"
                        className="ml-auto rounded-inner px-1.5 py-0.5 font-normal hover:bg-hover-wash hover:text-foreground"
                        onClick={() => bulk(groupRows.map((r) => r.id), !allOn)}
                      >
                        {allOn ? "清空" : "全选"}
                      </button>
                    )}
                  </div>
                  {groupRows.length === 0 && key !== "custom" && (
                    <p className="px-1.5 pb-1 pl-8 text-[11.5px] text-muted-foreground/80">暂无</p>
                  )}
                  {groupRows.map(renderRow)}
                  {key === "custom" && (
                    <div className="flex items-center gap-2 px-1.5 py-1.5">
                      <input
                        data-testid="improve-custom-input"
                        value={customDraft}
                        onChange={(e) => setCustomDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustom() } }}
                        placeholder="输入新的改进要求，回车或点添加"
                        className="min-w-0 flex-1 rounded-inner border border-input bg-transparent px-2 py-1 text-[12.5px] text-foreground outline-none focus:border-ring"
                      />
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={addCustom} data-testid="improve-custom-add">添加</Button>
                    </div>
                  )}
                </div>
              )
            }
            return null
          })}
        </div>

        <div className="flex items-center gap-2 border-t border-border px-4 py-3">
          {ready && checkedRows.length === 0 && (
            <span className="text-[11px] text-destructive" data-testid="improve-empty-hint">至少选择一项改进项</span>
          )}
          <span className="flex-1" />
          <Button size="sm" disabled={!canExecute} onClick={executeInNew} data-testid="improve-exec-new">在新对话中执行</Button>
          <Button size="sm" variant="outline" disabled={!canExecute} onClick={executeInCurrent} data-testid="improve-exec-current">在当前对话中执行</Button>
          <Button size="sm" variant="ghost" onClick={close} data-testid="improve-cancel">取消</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
