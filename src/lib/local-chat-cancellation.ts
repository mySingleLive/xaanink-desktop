import { retainDatabaseTask } from "@desktop/service/context"
/** 进程内尽快释放排队/模型名额；跨进程仍以数据库 epoch 与心跳撤销为准。 */
const shared = globalThis as typeof globalThis & { novelAttemptAborts?: Map<string, AbortController> }
const controllers = shared.novelAttemptAborts ??= new Map<string, AbortController>()
export function registerAttemptAbort(attemptId: string, controller: AbortController) {
  const releaseDatabase = retainDatabaseTask()
  controllers.set(attemptId, controller)
  return () => { if (controllers.get(attemptId) === controller) controllers.delete(attemptId); releaseDatabase() }
}
export function abortLocalAttempt(attemptId: string) { controllers.get(attemptId)?.abort(new DOMException("作者已停止执行", "AbortError")) }

/** 注册只由实际执行器持有，finally 移除；页面轮询不能制造存活证明。 */
export function isLocalAttemptRunning(attemptId: string) {
  const controller = controllers.get(attemptId)
  return !!controller && !controller.signal.aborted
}

/** Quit/maintenance can request interruption; leases are released only by executor finally. */
export function abortAllLocalAttempts() {
  for (const controller of controllers.values()) controller.abort(new DOMException("应用正在关闭，已提交的内容会保留", "AbortError"))
}
export function localAttemptCount() { return controllers.size }
