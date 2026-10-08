"use client"

import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { ROOT_MIGRATION_LIMITS } from "@desktop/core/root-inventory-limits"
import {validMaintenancePendingItem,maintenancePendingLabel,type RootMaintenanceBridge,type RootMaintenancePhase,type RootMaintenanceState } from "@desktop/shared/root-maintenance"

type MaintenanceCommand = Parameters<RootMaintenanceBridge["command"]>[0]
interface Connection {
  bridge: RootMaintenanceBridge
  alive: boolean
  state: RootMaintenanceState | null
  pending: MaintenanceCommand | null
}
const phaseLabels: Record<RootMaintenancePhase, string> = {
  preparing: "准备", validating: "检查", copying: "复制", verifying: "校验",
  committing: "切换目录", cleanup: "清理", complete: "迁移完成",
  "cleanup-pending": "迁移完成，清理待处理", "rollback-pending": "迁移已停止，回滚待处理",
  cancelled: "迁移已取消", failed: "迁移失败", "recovery-required": "需要恢复",
}
const phaseDescriptions: Record<RootMaintenancePhase, string> = {
  preparing: "正在准备本地应用数据迁移。",
  validating: "正在检查原目录和目标目录。",
  copying: "正在复制应用管理的本地数据。",
  verifying: "正在校验新目录中的数据。",
  committing: "正在切换应用的数据目录。",
  cleanup: "正在清理旧目录中的应用管理数据。",
  complete: "应用数据已迁移。",
  "cleanup-pending": "应用数据已迁移，旧目录中的部分数据仍保留。",
  "rollback-pending": "迁移已停止，原数据目录仍是当前目录。",
  cancelled: "迁移已停止，原数据保留在本机。",
  failed: "迁移未完成，请检查本地数据目录后重新打开应用。",
  "recovery-required": "原数据已保留，需要处理恢复问题后再继续。",
}

// The restricted preload is typed, but a malformed/unsupported event must not
// erase the last valid authority or render exception text as a migration result.
function isState(value: RootMaintenanceState): boolean {
  return !!value && value.version === 1 && Number.isSafeInteger(value.revision) && value.revision >= 0
    && Object.hasOwn(phaseLabels, value.phase) && (value.theme === "paper" || value.theme === "ink")
    && (value.sourcePath === null || typeof value.sourcePath === "string")
    && (value.targetPath === null || typeof value.targetPath === "string")
    && (value.currentRootPath == null || typeof value.currentRootPath === "string" && value.currentRootPath.length <= 8192 && !/[\x00-\x1f]/.test(value.currentRootPath))
    && Number.isSafeInteger(value.copiedFiles) && value.copiedFiles >= 0
    && (value.totalFiles === null || Number.isSafeInteger(value.totalFiles) && value.totalFiles >= 0)
    && (value.totalFiles === null || value.copiedFiles <= value.totalFiles)
    && Number.isSafeInteger(value.pendingCount) && value.pendingCount >= 0 && value.pendingCount <= ROOT_MIGRATION_LIMITS.pending
    && (value.pendingItems == null || Array.isArray(value.pendingItems) && value.pendingItems.length === value.pendingCount && value.pendingItems.every(validMaintenancePendingItem))
    && typeof value.canCancel === "boolean" && typeof value.canContinue === "boolean"
}

export function RootMaintenanceScreen() {
  const [state, setState] = useState<RootMaintenanceState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<MaintenanceCommand | null>(null)
  const [available, setAvailable] = useState(false)
  const [detailsPage,setDetailsPage]=useState(0)
  const connection = useRef<Connection | null>(null)

  useEffect(() => {
    const bridge = window.desktopMaintenance
    if (!bridge) { setError("迁移状态暂不可用，请重新打开应用。"); return }
    setAvailable(true)
    const current: Connection = { bridge, alive: true, state: null, pending: null }
    connection.current = current
    const live = () => current.alive && connection.current === current
    const receive = (next: RootMaintenanceState) => {
      if (!live()) return
      if (!isState(next)) { setError("迁移状态暂不可用，请重新打开应用。"); return }
      if (current.state && next.revision <= current.state.revision) return
      current.state = { ...next,pendingItems:next.pendingItems?[...next.pendingItems]:next.pendingItems }
      setState(current.state)
      setError(null)
    }
    let unsubscribe: (() => void) | undefined
    try {
      // Progress may arrive synchronously while subscribing. Its revision must
      // already be observed when the initial asynchronous snapshot resolves.
      unsubscribe = bridge.subscribe(receive)
      void Promise.resolve(bridge.state()).then(receive, () => {
        if (live()) setError("暂时无法读取迁移状态，请稍后重试。")
      })
    } catch {
      if (live()) setError("迁移状态暂不可用，请重新打开应用。")
    }
    return () => {
      current.alive = false
      if (connection.current === current) connection.current = null
      unsubscribe?.()
    }
  }, [])

  const command = async (action: MaintenanceCommand) => {
    const current = connection.current
    if (!current?.alive || current.pending) return
    if (action === "cancel" && !current.state?.canCancel) return
    if (action === "continue" && !current.state?.canContinue) return
    if (action === "quit" && current.state?.canContinue) return
    // This synchronous guard also covers two activations before React commits.
    current.pending = action
    setPending(action)
    setError(null)
    try { await current.bridge.command(action) }
    catch {
      if (current.alive && connection.current === current) setError("操作未完成，请重试。")
    } finally {
      if (current.alive && connection.current === current) {
        current.pending = null
        setPending(null)
      }
    }
  }
  const terminal = state && ["complete", "cleanup-pending", "rollback-pending", "cancelled", "failed", "recovery-required"].includes(state.phase)
  const items=state?.pendingItems??[],pageCount=Math.ceil(items.length/20),pageIndex=Math.min(detailsPage,Math.max(0,pageCount-1))
  const countText = state && state.totalFiles !== null ? `已复制 ${state.copiedFiles} / ${state.totalFiles} 个文件` : null

  return <main className={`${state?.theme ?? "paper"} flex h-dvh min-h-0 flex-col overflow-auto bg-background font-sans text-foreground`}>
    <div className="desktop-drag h-11 w-full shrink-0" aria-hidden="true" />
    <div className="flex flex-1 items-center justify-center px-5 pb-8 pt-3">
      <section aria-labelledby="root-maintenance-title" className="w-full min-w-0 max-w-xl rounded-xl border border-border bg-card p-6 sm:p-8">
        <h1 id="root-maintenance-title" className="font-heading text-2xl font-semibold">迁移应用数据</h1>
        <div role="status" aria-live="polite" aria-atomic="true" className="mt-6 space-y-2">
          <h2 className="text-base font-medium">{state ? phaseLabels[state.phase] : "正在读取迁移状态…"}</h2>
          {state && <p className="text-sm leading-6 text-muted-foreground">{phaseDescriptions[state.phase]}</p>}
        </div>
        {state && !terminal && <div className="mt-4 space-y-2">
          <progress aria-label="迁移进度" aria-valuetext={countText ?? "正在处理，文件总数尚未确定"}
            value={state.totalFiles === null ? undefined : state.copiedFiles}
            max={state.totalFiles === null ? undefined : Math.max(1, state.totalFiles)}
            className="h-2 w-full accent-primary" />
          {countText && <p className="text-xs text-muted-foreground">{countText}</p>}
        </div>}
        {state && <dl className="mt-5 space-y-3 text-sm">
          <div><dt className="text-xs text-muted-foreground">原数据目录</dt><dd className="mt-1 break-all leading-6">{state.sourcePath ?? "正在确认原目录…"}</dd></div>
          <div><dt className="text-xs text-muted-foreground">目标目录</dt><dd className="mt-1 break-all leading-6">{state.targetPath ?? "正在确认目标目录…"}</dd></div>
          {state.currentRootPath && <div><dt className="text-xs text-muted-foreground">当前数据目录</dt><dd className="mt-1 break-all leading-6">{state.currentRootPath}</dd></div>}
        </dl>}
        {state?.currentRootPath && <p className="mt-4 text-sm leading-6 text-muted-foreground">当前使用重新定位后的原目录，迁移历史与待处理文件仍保留。</p>}
        {state?.phase === "cleanup-pending" && <p className="mt-5 text-sm leading-6 text-muted-foreground">旧目录仍有 {state.pendingCount} 项待清理，可继续使用新目录。</p>}
        {state?.phase === "rollback-pending" && <p className="mt-5 text-sm leading-6 text-muted-foreground">目标目录仍有 {state.pendingCount} 项待处理，可返回原目录。</p>}
        {state&&state.pendingCount>0&&["cleanup-pending","rollback-pending"].includes(state.phase)&&(state.pendingItems?<details className="mt-4 rounded-lg border border-border p-3">
          <summary className="cursor-pointer text-sm">查看 {state.pendingCount} 项待处理内容</summary>
          <ul aria-label="待处理明细" className="mt-3 space-y-2 text-xs leading-5">{items.slice(pageIndex*20,(pageIndex+1)*20).map((item,index)=><li key={`${pageIndex}:${index}`} className="break-all">{maintenancePendingLabel(item)}</li>)}</ul>
          {pageCount>1&&<nav aria-label="待处理明细分页" className="mt-3 flex items-center justify-end gap-2 text-xs"><span>第 {pageIndex+1} / {pageCount} 页</span><Button variant="outline" size="sm" disabled={pageIndex===0} onClick={()=>setDetailsPage(pageIndex-1)}>上一页</Button><Button variant="outline" size="sm" disabled={pageIndex===pageCount-1} onClick={()=>setDetailsPage(pageIndex+1)}>下一页</Button></nav>}
        </details>:<p className="mt-4 text-sm text-muted-foreground">待处理明细暂不可用，原文件仍保留。</p>)}
        {error && <p role="alert" className="mt-5 text-sm leading-6 text-destructive">{error}</p>}
        {(state || available && (error || pending)) && <div className="mt-6 flex flex-wrap justify-end gap-2">
          {state?.canCancel && <Button variant="outline" data-maintenance-command="cancel" disabled={!!pending} onClick={() => { void command("cancel") }}>{pending === "cancel" ? "正在取消…" : "取消迁移"}</Button>}
          {state?.canContinue
            ? <Button data-maintenance-command="continue" disabled={!!pending} onClick={() => { void command("continue") }}>{pending === "continue" ? "正在返回…" : "返回工作台"}</Button>
            : <Button variant="outline" data-maintenance-command="quit" disabled={!!pending} onClick={() => { void command("quit") }}>{pending === "quit" ? "正在退出…" : "退出应用"}</Button>}
        </div>}
      </section>
    </div>
  </main>
}
