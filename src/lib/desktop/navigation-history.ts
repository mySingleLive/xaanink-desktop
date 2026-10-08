export type ChatNavigationTarget = { kind: "conversation" | "draft"; id: string; accountId: string }
export type DesktopNavigationTarget = { kind: "tab"; id: string } | ChatNavigationTarget
export interface NavigationSnapshot { canBack: boolean; canForward: boolean; pending: boolean }
export interface NavigationOptions {
  available(target: DesktopNavigationTarget): boolean
  apply(target: DesktopNavigationTarget, signal: AbortSignal): boolean | Promise<boolean>
  limit?: number
}
function same(a: DesktopNavigationTarget | undefined, b: DesktopNavigationTarget) {
  return !!a && a.kind === b.kind && a.id === b.id && (a.kind === "tab" || b.kind !== "tab" && a.accountId === b.accountId)
}
function immutable(target: DesktopNavigationTarget): DesktopNavigationTarget {
  if (!target.id || target.kind !== "tab" && !target.accountId) throw new Error("Invalid navigation target")
  return Object.freeze({ ...target })
}
export class DesktopNavigationHistory {
  private entries: DesktopNavigationTarget[] = []
  private cursor = -1
  private alive = true
  private readonly limit: number
  private listeners = new Set<() => void>()
  private pending: { index: number; target: DesktopNavigationTarget; controller: AbortController; observed: boolean } | null = null
  private snapshot: NavigationSnapshot = Object.freeze({ canBack: false, canForward: false, pending: false })
  constructor(private options: NavigationOptions) {
    this.limit = options.limit ?? 128
    if (!Number.isInteger(this.limit) || this.limit < 2 || this.limit > 1024) throw new Error("Invalid history limit")
  }
  getSnapshot = (): NavigationSnapshot => this.snapshot
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private available(target: DesktopNavigationTarget) { try { return this.options.available(target) } catch { return false } }
  private candidate(direction: -1 | 1) {
    for (let index = this.cursor + direction; index >= 0 && index < this.entries.length; index += direction) {
      const target = this.entries[index]
      if (!same(this.entries[this.cursor], target) && this.available(target)) return index
    }
    return -1
  }
  private publish() {
    const next = { canBack: this.alive && !this.pending && this.candidate(-1) >= 0, canForward: this.alive && !this.pending && this.candidate(1) >= 0, pending: !!this.pending }
    if (next.canBack === this.snapshot.canBack && next.canForward === this.snapshot.canForward && next.pending === this.snapshot.pending) return
    this.snapshot = Object.freeze(next)
    for (const listener of this.listeners) listener()
  }
  private cancelPending() { const pending = this.pending; this.pending = null; pending?.controller.abort() }
  /** Only actual committed view changes enter the history. */
  record(target: DesktopNavigationTarget) {
    if (!this.alive) return
    const next = immutable(target)
    if (this.pending && same(this.pending.target, next)) { this.pending.observed = true; return }
    if (same(this.entries[this.cursor], next)) return
    this.cancelPending()
    this.entries = this.entries.slice(0, this.cursor + 1)
    this.entries.push(next)
    if (this.entries.length > this.limit) this.entries.splice(0, this.entries.length - this.limit)
    this.cursor = this.entries.length - 1
    this.publish()
  }
  /** The first send saves the same draft view as a conversation, not a new visit. */
  replace(from: DesktopNavigationTarget, to: DesktopNavigationTarget) {
    if (!this.alive) return
    const next = immutable(to)
    if (!this.entries.some(target => same(target, from))) return
    this.cancelPending()
    const entries: DesktopNavigationTarget[] = []; let cursor = -1
    for (let index = 0; index < this.entries.length; index++) {
      const target = same(this.entries[index], from) ? next : this.entries[index]
      if (!same(entries.at(-1), target)) entries.push(target)
      if (index === this.cursor) cursor = entries.length - 1
    }
    this.entries = entries; this.cursor = cursor; this.publish()
  }
  refresh() {
    if (this.pending && !this.available(this.pending.target)) this.cancelPending()
    this.publish()
  }
  cancel() { this.cancelPending(); this.publish() }
  reset() { this.cancelPending(); this.entries = []; this.cursor = -1; this.publish() }
  dispose() { this.alive = false; this.reset(); this.listeners.clear() }
  async go(direction: -1 | 1) {
    if (!this.alive || this.pending || direction !== -1 && direction !== 1) return false
    const index = this.candidate(direction)
    if (index < 0) return false
    const move = { index, target: this.entries[index], controller: new AbortController(), observed: false }
    this.pending = move; this.publish()
    try {
      const committed = await this.options.apply(move.target, move.controller.signal)
      if (this.pending !== move || move.controller.signal.aborted || !this.available(move.target)) return false
      if (committed || move.observed) this.cursor = index
      return committed || move.observed
    } catch (error) {
      if (this.pending !== move || move.controller.signal.aborted) return false
      if (move.observed && this.available(move.target)) this.cursor = index
      throw error
    } finally {
      if (this.pending === move) { this.pending = null; this.publish() }
    }
  }
}
