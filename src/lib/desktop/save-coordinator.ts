import type { AutosaveController, AutosaveDraftSnapshot } from "../autosave-controller"

export interface DesktopDraftSnapshot {
  version: 1
  revision: number
  createdAt: string
  autosaves: Array<{ id: string; draft: AutosaveDraftSnapshot<unknown> }>
  sources: Record<string, unknown>
  issues: Array<{ source: string; code: "DRAFT_SOURCE_UNREADABLE" }>
}
export interface DesktopDraftSource { read(): unknown; subscribe?(changed: () => void): () => void }
export interface DesktopFlushOptions { retryFailures?: boolean; signal?: AbortSignal }
/** Resolve only after the main process has acknowledged its atomic journal. */
export type DesktopDraftWriter = (snapshot: DesktopDraftSnapshot) => Promise<void>
export type DesktopSaveFailure = "DURABLE_SAVE_UNAVAILABLE" | "AUTOSAVE_FLUSH_FAILED" | "DRAFT_SOURCE_UNREADABLE" | "DURABLE_SAVE_FAILED"
export class DesktopSaveError extends Error {
  constructor(readonly code: DesktopSaveFailure) {
    super({ DURABLE_SAVE_UNAVAILABLE: "草稿持久化尚未就绪，请保留窗口", AUTOSAVE_FLUSH_FAILED: "修改尚未确认，草稿已保留，请处理冲突或重试原保存", DRAFT_SOURCE_UNREADABLE: "部分草稿无法读取，原记录已保留，请恢复后重试", DURABLE_SAVE_FAILED: "草稿落盘失败，已保留本地输入，请重试或导出草稿" }[code])
    this.name = "DesktopSaveError"
  }
}
export interface DesktopSaveState { status: "idle" | "saving" | "saved" | "error"; revision: number; durableRevision: number | null; failure: DesktopSaveFailure | null }
interface Entry { id: string; controller: AutosaveController<unknown>; owners: Set<symbol>; unsubscribe(): void; durableRevision: number | null }
interface SourceEntry { source: DesktopDraftSource; unsubscribe(): void; cached?: unknown }
function abortError() { return new DOMException("已取消等待保存，草稿继续保留", "AbortError") }
/** Cancel one close wait, never dispose a shared editor save or rollback a write. */
function waitFor<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(abortError())
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); reject(abortError()) }
    signal.addEventListener("abort", abort, { once: true })
    promise.then(value => { signal.removeEventListener("abort", abort); if (!signal.aborted) resolve(value) }, error => { signal.removeEventListener("abort", abort); if (!signal.aborted) reject(error) })
  })
}
function content(snapshot: DesktopDraftSnapshot) { return JSON.stringify({ autosaves: snapshot.autosaves, sources: snapshot.sources, issues: snapshot.issues }) }

/** A renderer checkpoint is a recovery draft, never approval or finalization.
 * Keep detached dirty controllers until the main journal acknowledges their
 * complete data. Concurrent callers share the write; cancelling one caller
 * stops its wait only. The main writer must bound its IO and reject stale
 * writer generations; the renderer does not claim localStorage is fsync. */
export class DesktopSaveCoordinator {
  private entries = new Map<AutosaveController<unknown>, Entry>()
  private sources = new Map<string, SourceEntry>()
  private persistence: { writer: DesktopDraftWriter } | undefined
  private generation = 0
  private flight: Promise<DesktopDraftSnapshot> | undefined
  private checkpointFlight: Promise<DesktopDraftSnapshot> | undefined
  private journalQueue: Promise<unknown> = Promise.resolve()
  private written: { writer: { writer: DesktopDraftWriter }; revision: number; content: string } | undefined
  private checkpoint: ReturnType<typeof setTimeout> | undefined
  private listeners = new Set<(state: DesktopSaveState) => void>()
  private state: DesktopSaveState = { status: "idle", revision: 0, durableRevision: null, failure: null }
  constructor(private options: { checkpointDelayMs?: number | null } = {}) {}
  getState() { return { ...this.state, revision: this.generation } }
  subscribe(listener: (state: DesktopSaveState) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private emit(status: DesktopSaveState["status"], failure: DesktopSaveFailure | null = null) {
    this.state = { ...this.state, status, failure, revision: this.generation }
    // UI observers cannot interrupt writer registration, durable receipt
    // bookkeeping, or another observer's notification.
    for (const listener of this.listeners) { try { listener(this.getState()) } catch { /* Preserve the save lifecycle even if a view observer fails. */ } }
  }
  private changed() { this.generation++; this.emit("idle"); this.requestCheckpoint() }
  private requestCheckpoint() {
    clearTimeout(this.checkpoint)
    if (!this.persistence || this.options.checkpointDelayMs === null) return
    this.checkpoint = setTimeout(() => { this.checkpoint = undefined; void this.checkpointDrafts().catch(() => {}) }, this.options.checkpointDelayMs ?? 800)
  }
  private remove(entry: Entry, notify = true) {
    if (this.entries.get(entry.controller) !== entry) return
    this.entries.delete(entry.controller); entry.unsubscribe(); entry.controller.dispose()
    if (notify) this.changed()
  }
  register<T>(controller: AutosaveController<T>): () => void {
    const target = controller as AutosaveController<unknown>
    let entry = this.entries.get(target)
    if (!entry) {
      entry = { id: crypto.randomUUID(), controller: target, owners: new Set(), unsubscribe: () => {}, durableRevision: null }
      this.entries.set(target, entry)
      entry.unsubscribe = target.subscribe(() => this.changed())
    }
    const current = entry, owner = Symbol("autosave-lifecycle")
    current.owners.add(owner); target.activate(); this.changed()
    return () => {
      if (!current.owners.delete(owner) || this.entries.get(target) !== current) return
      if (!current.owners.size && !target.dirty && (!target.snapshot().latest || current.durableRevision === target.revision)) this.remove(current)
      else this.changed()
    }
  }
  registerSource(id: string, source: DesktopDraftSource): () => void {
    if (this.sources.has(id)) throw new Error("DRAFT_SOURCE_ALREADY_REGISTERED")
    const entry: SourceEntry = { source, unsubscribe: () => {} }
    this.sources.set(id, entry)
    entry.unsubscribe = source.subscribe?.(() => this.changed()) ?? (() => {})
    this.changed()
    return () => { if (this.sources.get(id) !== entry) return; this.sources.delete(id); entry.unsubscribe(); this.changed() }
  }
  configurePersistence(writer: DesktopDraftWriter): () => void {
    const registration = { writer }; this.persistence = registration; this.changed()
    return () => { if (this.persistence !== registration) return; this.persistence = undefined; clearTimeout(this.checkpoint); this.changed() }
  }
  exportSnapshot(): DesktopDraftSnapshot {
    const sources: Record<string, unknown> = {}, issues: DesktopDraftSnapshot["issues"] = []
    for (const [id, entry] of this.sources) {
      try { entry.cached = structuredClone(entry.source.read()); sources[id] = structuredClone(entry.cached) }
      catch { issues.push({ source: id, code: "DRAFT_SOURCE_UNREADABLE" }); if (entry.cached !== undefined) sources[id] = structuredClone(entry.cached) }
    }
    const autosaves: DesktopDraftSnapshot["autosaves"] = []
    for (const entry of this.entries.values()) {
      try { autosaves.push({ id: entry.id, draft: entry.controller.snapshot() }) }
      catch { issues.push({ source: entry.id, code: "DRAFT_SOURCE_UNREADABLE" }) }
    }
    return { version: 1, revision: this.generation, createdAt: new Date().toISOString(), autosaves, sources, issues }
  }
  async flushAll(options: DesktopFlushOptions = {}): Promise<DesktopDraftSnapshot> {
    if (options.signal?.aborted) throw abortError()
    clearTimeout(this.checkpoint)
    if (!this.flight) {
      // Lock before emit/save callbacks can synchronously re-enter flushAll.
      const work = Promise.resolve().then(() => this.flushStable(!!options.retryFailures)); this.flight = work
      const complete = () => { if (this.flight === work) this.flight = undefined }
      void work.then(complete, complete)
    }
    return waitFor(this.flight, options.signal)
  }
  /** Recovery journal only. Pending/failed/paused operations remain inert data;
   * this never invokes save, retry, resume, confirm, send or approval. */
  async checkpointDrafts(options: Pick<DesktopFlushOptions, "signal"> & {afterRevision?:number} = {}): Promise<DesktopDraftSnapshot> {
    if (options.signal?.aborted) throw abortError()
    if(options.afterRevision!==undefined){
      if(!Number.isSafeInteger(options.afterRevision)||options.afterRevision<0||options.afterRevision>=Number.MAX_SAFE_INTEGER)throw new DesktopSaveError("DURABLE_SAVE_FAILED")
      // An unchanged recovery payload still needs a distinct actual journal
      // receipt after the application's first protected checkpoint.
      if(this.generation<=options.afterRevision){this.generation=options.afterRevision;this.changed()}
    }
    clearTimeout(this.checkpoint)
    if (!this.checkpointFlight) {
      const work = Promise.resolve().then(() => this.checkpointStable()); this.checkpointFlight = work
      const complete = () => { if (this.checkpointFlight === work) this.checkpointFlight = undefined }
      void work.then(complete, complete)
    }
    return waitFor(this.checkpointFlight, options.signal)
  }
  private persist(snapshot: DesktopDraftSnapshot, writer: { writer: DesktopDraftWriter }): Promise<boolean> {
    const captured = content(snapshot)
    const work = this.journalQueue.then(async () => {
      const current = this.exportSnapshot(), changed = content(current) !== captured
      if (changed && this.generation === snapshot.revision) this.changed()
      if (this.persistence !== writer || this.generation !== snapshot.revision || changed) return false
      // GC of acknowledged detached controllers changes the next payload even
      // though no author edit occurred. Never send different content at the
      // same main-side revision, including overlapping checkpoint/close calls.
      if (this.written?.writer === writer && this.written.revision === snapshot.revision && this.written.content !== captured) { this.changed(); return false }
      try { await writer.writer(structuredClone(snapshot)) }
      catch { throw new DesktopSaveError("DURABLE_SAVE_FAILED") }
      this.written = { writer, revision: snapshot.revision, content: captured }
      return true
    })
    this.journalQueue = work.then(() => undefined, () => undefined)
    return work
  }
  private acknowledge(snapshot: DesktopDraftSnapshot) {
    this.state = { ...this.state, durableRevision: snapshot.revision }
    let removed = false
    for (const entry of [...this.entries.values()]) {
      if (!snapshot.autosaves.some(row => row.id === entry.id && row.draft.revision === entry.controller.revision)) continue
      entry.durableRevision = entry.controller.revision
      if (!entry.owners.size && !entry.controller.dirty) { this.remove(entry, false); removed = true }
    }
    // Future journal content omits those fully acknowledged entries.
    if (removed) this.generation++
    const acknowledgedGeneration = this.generation, acknowledgedContent = content(this.exportSnapshot())
    clearTimeout(this.checkpoint); this.emit("saved")
    const changed = content(this.exportSnapshot()) !== acknowledgedContent
    if (changed && this.generation === acknowledgedGeneration) this.changed()
    // A synchronous observer can schedule another local revision. Its input
    // still belongs to this close barrier, never a later unconfirmed save.
    return this.generation === acknowledgedGeneration && !changed
  }
  private failed(error: unknown, checkpointAfterClose = false): never {
    const failure = error instanceof DesktopSaveError ? error : new DesktopSaveError("DURABLE_SAVE_FAILED")
    this.emit("error", failure.code)
    // Failed close removed the pending debounce. Restore one pure recovery
    // checkpoint, even if a paused flush emitted no controller notification.
    // A checkpoint's own failure never reschedules itself into a retry loop.
    if (checkpointAfterClose) this.requestCheckpoint()
    throw failure
  }
  private async checkpointStable(): Promise<DesktopDraftSnapshot> {
    try {
      for (;;) {
        const writer = this.persistence
        if (!writer) throw new DesktopSaveError("DURABLE_SAVE_UNAVAILABLE")
        this.emit("saving")
        const snapshot = this.exportSnapshot(), captured = content(snapshot)
        if (snapshot.issues.length) throw new DesktopSaveError("DRAFT_SOURCE_UNREADABLE")
        if (!await this.persist(snapshot, writer)) continue
        const current = this.exportSnapshot(), changed = content(current) !== captured
        if (changed && this.generation === snapshot.revision) this.changed()
        if (this.persistence !== writer || this.generation !== snapshot.revision || changed) continue
        if (!this.acknowledge(snapshot)) continue
        return snapshot
      }
    } catch (error) { return this.failed(error) }
  }
  private async flushStable(retryFailures: boolean): Promise<DesktopDraftSnapshot> {
    try {
      for (;;) {
        if (!this.persistence) throw new DesktopSaveError("DURABLE_SAVE_UNAVAILABLE")
        this.emit("saving")
        const flushed = await Promise.allSettled([...this.entries.values()].map(async ({ controller }) => {
          while (controller.dirty) {
            const before = controller.snapshot()
            if (retryFailures && before.failed) await controller.retry()
            else await controller.flush()
            const after = controller.snapshot()
            // Another flush can start the next revision while this waiter is
            // resuming. Wait for it too. A disposed legacy flush is a no-op.
            if (controller.dirty && !after.inFlight && JSON.stringify(before) === JSON.stringify(after)) throw new DesktopSaveError("AUTOSAVE_FLUSH_FAILED")
          }
        }))
        if (flushed.some(result => result.status === "rejected")) throw new DesktopSaveError("AUTOSAVE_FLUSH_FAILED")
        if ([...this.entries.values()].some(entry => entry.controller.dirty)) continue
        const writer = this.persistence
        if (!writer) throw new DesktopSaveError("DURABLE_SAVE_UNAVAILABLE")
        const snapshot = this.exportSnapshot()
        if (snapshot.issues.length) throw new DesktopSaveError("DRAFT_SOURCE_UNREADABLE")
        const captured = content(snapshot)
        if (!await this.persist(snapshot, writer)) continue
        const current = this.exportSnapshot()
        const contentChanged = content(current) !== captured
        // A source may deliberately provide only read(). Even without a store
        // notification, changed journal content requires a new main-side CAS.
        if (contentChanged && this.generation === snapshot.revision) this.changed()
        if (this.persistence !== writer || this.generation !== snapshot.revision || contentChanged || [...this.entries.values()].some(entry => entry.controller.dirty)) continue
        if (!this.acknowledge(snapshot)) continue
        return snapshot
      }
    } catch (error) {
      return this.failed(error, true)
    }
  }
}
export const desktopSaveCoordinator = new DesktopSaveCoordinator()
