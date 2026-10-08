"use client"

/**
 * 三阶段保存 · 面板包裹层。
 * 阶段一：面板顶部出现浅主题色一栏，左侧 [×]（悬停提示「退出修改模式」，点击撤回全部暂存修改并收起该栏），
 * 右侧放 [修改(N)]（主题色实底深字，计数深绿），悬停出修改明细卡，点击确认 → 阶段二；
 * 阶段二：同栏按钮变 [发送]（同款主题色实底深字），悬停出明细卡 + [撤销]，点击经暂存仓桥接 ChatPanel 发送；
 * 该栏仅在有暂存修改时渲染，普通状态不占位。
 * 撤销/落库后：revertNonce 变化经 key 强制重挂载面板，取回服务端真稿。
 * 同时在 dashboard 挂载点注册 apiSend 拦截上下文（tab 解析）。
 */

import { useEffect, useMemo } from "react"
import { useQueryClient, type QueryClient } from "@tanstack/react-query"
import { PenLine, SendHorizontal, Undo2, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import {
  registerStagedInterception,
  stagedBatchCount,
  stagedDebugState,
  useStagedChangesStore,
  type StagedBatch,
} from "@/stores/staged-changes"
import { buildTabId, useTabsStore, type Tab } from "@/stores/tabs"
import { snapshotFromQueryEntries, type matchStagedPattern } from "@/lib/staged-save"

/* ---------------- 拦截上下文（dashboard 内注册一次） ---------------- */

/** 设定的世界归属：优先取请求体（新建设定携带 worldId），否则在查询缓存的设定列表里按 id 反查 */
function settingWorldId(
  match: NonNullable<ReturnType<typeof matchStagedPattern>>,
  body: unknown,
  queryClient: QueryClient
): string | null {
  const fromBody =
    body && typeof body === "object" ? (body as { worldId?: string | null }).worldId : undefined
  if (fromBody) return fromBody
  const settingId = Object.values(match.params)[0]
  if (!settingId) return null
  for (const query of queryClient.getQueryCache().getAll()) {
    const data = query.state.data as
      | { settings?: { id?: string; worldId?: string | null }[] }
      | undefined
    const hit = data?.settings?.find(s => s.id === settingId)
    if (hit) return hit.worldId ?? null
  }
  return null
}

function resolveBatchFromTabs(
  match: NonNullable<ReturnType<typeof matchStagedPattern>>,
  queryClient: QueryClient,
  body?: unknown
): { batchKey: string; label: string } {
  const t = match.pattern.tab(match.params, match.novelId)
  const tabs = useTabsStore.getState().tabs
  // 设定在世界面板内嵌编辑：批次挂到所属世界表盘，[修改(N)] 栏才能随世界面板渲染
  if (match.pattern.kind === "SETTING") {
    const settingId = Object.values(match.params)[0]
    // 暂存期创建的占位设定：跟随其 create 修改项所在批次，避免同批合并落空
    if (settingId?.startsWith("staged-")) {
      const owner = Object.values(useStagedChangesStore.getState().batches).find(b =>
        b.changes.some(c => c.targetId === settingId && c.op === "create")
      )
      if (owner) return { batchKey: owner.batchKey, label: owner.label }
    }
    const worldId = settingWorldId(match, body, queryClient)
    const worldTab = worldId
      ? tabs.find(tab => tab.type === "world" && tab.refId === worldId)
      : undefined
    if (worldTab) return { batchKey: worldTab.id, label: worldTab.title }
  }
  const hit =
    tabs.find(tab => tab.type === t.type && tab.novelId === match.novelId && (t.refId ? tab.refId === t.refId : true)) ??
    tabs.find(tab => tab.novelId === match.novelId && tab.refId != null && Object.values(match.params).includes(tab.refId))
  if (hit) return { batchKey: hit.id, label: hit.title }
  try {
    return {
      batchKey: buildTabId(t.type as Parameters<typeof buildTabId>[0], match.novelId, { refId: t.refId }),
      label: match.pattern.kindLabel,
    }
  } catch {
    return { batchKey: `${t.type}:${t.refId ?? match.novelId}`, label: match.pattern.kindLabel }
  }
}

export function StagedInterceptionBootstrap() {
  const queryClient = useQueryClient()
  useEffect(() => {
    registerStagedInterception({
      resolveBatch: (match, body) => resolveBatchFromTabs(match, queryClient, body),
      snapshot: (url, _envelope) =>
        Promise.resolve(snapshotFromQueryEntries(queryClient.getQueryCache().getAll(), url)),
    })
    // 开发排障钩子：__stagedDebug.resolve(url) / .cacheDump() / .state()
    ;(window as unknown as { __stagedDebug?: unknown }).__stagedDebug = {
      state: stagedDebugState,
      resolve: (url: string) => snapshotFromQueryEntries(queryClient.getQueryCache().getAll(), url),
      cacheDump: () =>
        queryClient.getQueryCache().getAll().map(q => ({
          key: q.queryKey,
          hasData: q.state.data !== undefined,
          topKeys: q.state.data && typeof q.state.data === "object" ? Object.keys(q.state.data).slice(0, 8) : [],
        })),
    }
    return () => registerStagedInterception(null)
  }, [queryClient])
  return null
}

/* ---------------- 明细悬停卡（group-hover；bg-popover/border-border 全局令牌） ---------------- */

function ChangeListCard({ batch, footer }: { batch: StagedBatch; footer?: React.ReactNode }) {
  const items = batch.changes.flatMap(c => c.items.map(i => ({ ...i, op: c.op })))
  return (
    <div
      className={cn(
        "invisible absolute top-[calc(100%+6px)] right-0 z-30 w-72 rounded-card border border-border bg-popover p-3 opacity-0 shadow-2 transition-opacity duration-150",
        "group-hover:visible group-hover:opacity-100"
      )}
      role="tooltip"
    >
      <p className="mb-2 text-xs font-medium text-muted-foreground">
        本面板修改 · {batch.phase === "chipped" ? "发送后才生效" : "均未落库"}
      </p>
      <ul className="grid max-h-56 gap-1.5 overflow-y-auto">
        {items.map(item => (
          <li key={item.key} className="flex items-baseline gap-1.5 text-xs leading-relaxed">
            <span
              className={cn(
                "shrink-0 text-[11px]",
                item.op === "delete"
                  ? "font-semibold text-destructive"
                  : item.op === "create"
                    ? "font-semibold text-success"
                    : "text-muted-foreground"
              )}
            >
              {item.op === "delete" ? "删除" : item.op === "create" ? "新增" : item.fieldLabel}
            </span>
            <span className="min-w-0 truncate">{item.summary}</span>
          </li>
        ))}
      </ul>
      {footer && (
        <div className="mt-2.5 flex items-center justify-end gap-2 border-t border-border pt-2.5">
          {footer}
        </div>
      )}
    </div>
  )
}

/* ---------------- 包裹层 ---------------- */

export function StagedSaveSurface({ tab, children }: { tab: Tab; children: React.ReactNode }) {
  const batch = useStagedChangesStore(s => s.batches[tab.id])
  const confirm = useStagedChangesStore(s => s.confirm)
  const revert = useStagedChangesStore(s => s.revert)
  const requestStagedSend = useStagedChangesStore(s => s.requestStagedSend)
  const count = stagedBatchCount(batch)
  const revertNonce = batch?.revertNonce ?? 0
  const phase = batch?.phase ?? "editing"

  const bar = useMemo(() => {
    if (!batch || count === 0) return null
    return (
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-primary/10 px-3 py-1.5">
        <Tooltip>
          <TooltipTrigger
            data-testid="staged-exit-button"
            aria-label="退出修改模式"
            onClick={() => revert(tab.id)}
            className="flex size-6 items-center justify-center rounded-inner text-muted-foreground transition-colors hover:bg-primary/15 hover:text-foreground"
          >
            <X className="size-3.5" />
          </TooltipTrigger>
          <TooltipContent side="bottom">退出修改模式</TooltipContent>
        </Tooltip>
        <div className="group relative">
          {phase === "editing" ? (
            <Button
              size="sm"
              data-testid="staged-edit-button"
              onClick={() => confirm(tab.id)}
            >
              <PenLine />
              修改
              <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-white/40 px-1 font-mono text-[11px] font-semibold text-[#157f3c]">
                {count}
              </span>
            </Button>
          ) : (
            <Button
              size="sm"
              data-testid="staged-send-button"
              onClick={() => requestStagedSend(tab.id, tab.novelId)}
            >
              <SendHorizontal />
              发送
            </Button>
          )}
          <ChangeListCard
            batch={batch}
            footer={
              phase === "editing" ? (
                <span className="text-[11px] text-muted-foreground">
                  点击按钮确认 → 修改气泡进入对话框
                </span>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs text-destructive hover:text-destructive"
                  onClick={() => revert(tab.id)}
                >
                  <Undo2 className="size-3" />
                  撤销（恢复已保存稿）
                </Button>
              )
            }
          />
        </div>
      </div>
    )
  }, [batch, count, phase, confirm, revert, requestStagedSend, tab.id, tab.novelId])

  return (
    <div className="flex h-full flex-col">
      {bar}
      <div key={`${tab.id}:${revertNonce}`} className="min-h-0 flex-1">
        {children}
      </div>
    </div>
  )
}
