"use client"

import { useCallback, useEffect, useState } from "react"
import { Check, Loader2 } from "lucide-react"
import { AutosaveController, type SaveAttempt, type SaveStatus } from "@/lib/autosave-controller"
import { desktopSaveCoordinator } from "@/lib/desktop/save-coordinator"
import { useStagedChangesStore } from "@/stores/staged-changes"

export type { SaveStatus } from "@/lib/autosave-controller"

/**
 * 防抖自动保存：
 * - schedule(value)：内容变化时调用，delay 毫秒无新变化后保存
 * - saveNow()：失焦时只刷新已有修改，不为单纯浏览创建一次写入
 * - saveNow(value)：明确产生新内容时安排修改并立即保存
 * Web卸载时停止定时保存；桌面卸载由协调器保留待落盘草稿。
 * 路由/评论等依赖动作仍通过原 flush 确认保存。
 */
export function useAutosave<T>(saveFn: (value: T, attempt: SaveAttempt<T>) => Promise<void>, delay = 800) {
  const [status, setStatus] = useState<SaveStatus>("idle")
  const [controller] = useState(() => new AutosaveController<T>(saveFn, delay))
  useEffect(() => { controller.updateSave(saveFn) }, [controller, saveFn])
  useEffect(() => {
    controller.activate()
    const release = typeof window !== "undefined" && window.desktop ? desktopSaveCoordinator.register(controller) : undefined
    const unsubscribe = controller.subscribe(setStatus)
    return () => { unsubscribe(); if (release) release(); else controller.dispose() }
  }, [controller])
  const schedule = useCallback((value: T) => controller.schedule(value), [controller])
  const flush = useCallback(() => controller.flush(), [controller])
  const saveNow = useCallback((value?: T) => {
    if (value !== undefined) controller.schedule(value)
    void controller.flush().catch(() => {})
  }, [controller])
  const retry = useCallback(() => controller.retry(), [controller])
  return { status, schedule, saveNow, flush, retry, controller }
}

/**
 * 自己的自动保存带回的同步令牌（version / updatedAt）登记处。
 * 面板按 key={id:version} 重挂载来接收「外部写入」（如对话 AI 落稿），
 * 但自己的自动保存同样会推高 version——不登记的话每次保存都触发重挂载：
 * 编辑器视图模式被重置回默认值、Monaco 焦点丢失（「分屏按钮失效」即此因）。
 * 保存响应里的新令牌经 track() 登记后，isOwn() 命中即视为自己的回写、保持 key 稳定；
 * 未登记的变化才是外部写入，照常重挂载取新稿。
 */
export function useOwnSyncTokens<T>(keep = 5) {
  const [tokens, setTokens] = useState<T[]>([])
  const track = useCallback(
    (token: T) => setTokens((list) => [...list.slice(-(keep - 1)), token]),
    [keep]
  )
  const isOwn = useCallback((token: T) => tokens.includes(token), [tokens])
  return { track, isOwn }
}

/**
 * 「外部写入才重挂载」的 key 推导（配合 useOwnSyncTokens 使用）。
 * 面板按 key={id:version} 重挂载接收外部写入（对话 AI 落稿/评审应用等），
 * 自己的自动保存也推高 version——但若把自己的回写映射成常量 key（如 "own"），
 * key 字符串照样从旧值跳变、依然触发重挂载（编辑器模式被重置、Monaco 丢焦点）。
 * 本 hook 记忆最近一次「非自己保存」的令牌：自己的回写期间 key 保持原值不变，
 * 只有外部写入才推进 key 触发重挂载取新稿。
 * （props 变化驱动 state 调整采用 React 认可的渲染期 prev 比较模式，不走 effect。）
 */
export function useExternalSyncKey<T>(current: T, isOwn: (token: T) => boolean, blocked = false): T {
  const [syncToken, setSyncToken] = useState(current)
  const [prevCurrent, setPrevCurrent] = useState(current)
  const [wasBlocked, setWasBlocked] = useState(blocked)
  if (current !== prevCurrent || wasBlocked !== blocked) {
    setPrevCurrent(current)
    setWasBlocked(blocked)
    if (!blocked && !isOwn(current)) setSyncToken(current)
  }
  return syncToken
}

const STATUS_TEXT: Record<SaveStatus, string> = {
  idle: "",
  pending: "待保存",
  saving: "保存中…",
  saved: "已保存",
  error: "保存失败",
}

/** 自动保存状态指示（三阶段保存：存在未落库暂存时不宣称「已保存」，统一呈现「待保存」） */
export function SaveStatusIndicator({ status }: { status: SaveStatus }) {
  const hasStaged = useStagedChangesStore(s => Object.values(s.batches).some(b => b.changes.length > 0))
  if (status === "idle") return null
  if (hasStaged && (status === "saved" || status === "saving" || status === "pending")) {
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground" data-testid="staged-pending-indicator">
        <span>待保存</span>
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1 text-xs text-muted-foreground">
      {status === "saving" && <Loader2 className="size-3 animate-spin" />}
      {status === "saved" && <Check className="size-3 text-green-600" />}
      <span className={status === "error" ? "text-destructive" : undefined}>
        {STATUS_TEXT[status]}
      </span>
    </span>
  )
}
