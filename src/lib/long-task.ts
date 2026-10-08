import { retainDatabaseTask } from "@desktop/service/context"
import { AsyncLocalStorage } from "node:async_hooks"
import { getCostConfig } from "./ai/cost-config"

/** FIFO、可取消的进程内名额。释放幂等；缩小限额不会撤销已运行任务。 */
export class LongTaskQueue {
  active = 0
  limit = 2
  private queue: { resolve: (release: () => void) => void; reject: (error: unknown) => void; signal?: AbortSignal; abort: () => void }[] = []
  get waiting() { return this.queue.length }
  setLimit(limit: number) { if (!Number.isInteger(limit) || limit < 1 || limit > 8) throw new Error("Invalid concurrency"); this.limit = limit; this.drain() }
  private grant() {
    this.active++
    let released = false
    return () => { if (released) return; released = true; this.active--; this.drain() }
  }
  private drain() {
    while (this.active < this.limit && this.queue.length) {
      const entry = this.queue.shift()!
      entry.signal?.removeEventListener("abort", entry.abort)
      if (entry.signal?.aborted) entry.reject(entry.signal.reason)
      else entry.resolve(this.grant())
    }
  }
  acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(signal.reason)
    if (this.active < this.limit) return Promise.resolve(this.grant())
    return new Promise((resolve, reject) => {
      const entry = { resolve, reject, signal, abort: () => { this.queue = this.queue.filter(item => item !== entry); reject(signal?.reason) } }
      this.queue.push(entry); signal?.addEventListener("abort", entry.abort, { once: true })
    })
  }
}
const shared = globalThis as typeof globalThis & { novelLongTasks?: { queue: LongTaskQueue; context: AsyncLocalStorage<boolean> } }
const runtime = shared.novelLongTasks ??= { queue: new LongTaskQueue(), context: new AsyncLocalStorage<boolean>() }
export const longTaskQueue = runtime.queue
export const runInsideLongTask = <T>(work: () => T) => runtime.context.run(true, work)
export async function acquireLongTask(signal?: AbortSignal, limit?: number) {
  if (runtime.context.getStore()) return () => {}
  const releaseDatabase = retainDatabaseTask()
  try {
    longTaskQueue.setLimit(limit ?? (await getCostConfig()).maxConcurrentTasks)
    const release = await longTaskQueue.acquire(signal)
    return () => { release(); releaseDatabase() }
  } catch (error) { releaseDatabase(); throw error }
}
export async function withLongTask<T>(work: () => Promise<T>, signal?: AbortSignal) {
  const release = await acquireLongTask(signal)
  try { return await runInsideLongTask(work) } finally { release() }
}
