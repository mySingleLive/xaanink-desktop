import type { CloseOwner } from './close-coordinator'
import type { RootIdentity } from '../core/data-root'
import type { WorkLeaseRecoveryPreview, WorkLeaseRecoveryOptions } from '../core/work-lease-recovery'
import { WorkLeaseRecovery, WorkLeaseRecoveryError } from '../core/work-lease-recovery'
import { z } from 'zod'
import type {BrandNames} from '../shared/brand-names'
export interface WorkLeaseHandoffIdentity { workId: string; owner: CloseOwner }
export interface WorkLeaseHandoffOptions {
  namesForWork?(work:RootIdentity):Readonly<BrandNames>
  assertHost(): void
  assertOwner(owner: CloseOwner): void
  assertClosed(): void
  target(workId: string): Promise<RootIdentity>
  confirm(preview: WorkLeaseRecoveryPreview, signal: AbortSignal): Promise<boolean>
  close(intent: 'quit'): Promise<boolean>
  notice(message: string): Promise<void>
  restart(): void
  recoveryHook?: WorkLeaseRecoveryOptions['hook']
}
export type WorkLeaseHandoffOutcome = { workId: string; status: 'recovered' | 'cancelled' | 'failed' | 'cleanup-pending' }
export class WorkLeaseHandoffError extends Error { constructor(readonly code: string) { super(code) } }
const inputSchema = z.object({ workId: z.uuid(), owner: z.object({ owner: z.number().int().safe().min(1), sessionId: z.uuid() }).strict() }).strict()
const messages = {
  recovered: '作品锁已恢复。应用将重新启动后重新打开作品。',
  cancelled: '已取消作品锁恢复。作品数据与已有恢复记录已保留，应用将重新启动。',
  failed: '无法确认作品锁可安全恢复，原锁和作品数据已保留。应用将重新启动，请检查占用情况后再试。',
  'cleanup-pending': '作品锁恢复尚待收尾。作品数据与恢复记录已保留，应用将重新启动后可重新确认处理。',
} as const
const safeCodes = new Set(['HANDOFF_INPUT_INVALID', 'HANDOFF_HOST_LOST', 'HANDOFF_OWNER_CHANGED', 'HANDOFF_NOT_CLOSED', 'HANDOFF_NOT_STARTED', 'HANDOFF_STATE_INVALID', 'HANDOFF_CONFIRM_FAILED', 'HANDOFF_IO_FAILED', 'HANDOFF_NOTICE_FAILED', 'HANDOFF_CLOSE_FAILED', 'HANDOFF_RESTART_UNCONFIRMED'])
const checkFailures = new Set(['WORK_CHANGED', 'OWNER_FOREIGN', 'OWNER_UNCERTAIN', 'OWNER_ALIVE', 'OWNER_INVALID', 'OWNER_CHANGED', 'LOCK_CHANGED', 'LOCK_CONTENTS_UNKNOWN', 'AUDIT_INVALID', 'AUDIT_CHANGED'])
function fail(code: string): never { throw new WorkLeaseHandoffError(code) }
function safe(error: unknown, fallback: string) { return new WorkLeaseHandoffError(error instanceof WorkLeaseHandoffError && safeCodes.has(error.code) ? error.code : fallback) }
function synchronous(run: () => void, code: string) { try { const value: unknown = run(); if (value && typeof (value as { then?: unknown }).then === 'function') { void Promise.resolve(value).catch(() => {}); fail(code) } } catch { fail(code) } }
function freezePreview(preview: WorkLeaseRecoveryPreview): WorkLeaseRecoveryPreview { return Object.freeze({ ...preview, work: Object.freeze({ ...preview.work }), owner: Object.freeze({ ...preview.owner }) }) }
export class WorkLeaseHandoff {
  private identity: WorkLeaseHandoffIdentity
  private recovery: WorkLeaseRecovery
  private started = false
  private endedBeforeClose = false
  private closed = false
  private afterCloseEntered = false
  private cancelled = false
  private committed = false
  private restartUnconfirmed = false
  private completed = false
  private noticed = false
  private result: WorkLeaseHandoffOutcome | null = null
  private preview: WorkLeaseRecoveryPreview | null = null
  private approved: WorkLeaseRecoveryPreview | null = null
  private target: RootIdentity | null = null
  private controller = new AbortController()
  private startFlight: Promise<boolean> | null = null
  private finishFlight: Promise<void> | null = null
  private cancelFlight: Promise<void> | null = null
  private authorityFailure: string | null = null
  constructor(identity: WorkLeaseHandoffIdentity, private options: WorkLeaseHandoffOptions) {
    try { const parsed = inputSchema.parse(identity); this.identity = Object.freeze({ ...parsed, owner: Object.freeze({ ...parsed.owner }) }) } catch { throw new WorkLeaseHandoffError('HANDOFF_INPUT_INVALID') }
    this.recovery = new WorkLeaseRecovery({
      namesForWork:options.namesForWork,
      assertHost: () => this.guard(), assertWorkClosed: () => this.assertClosed(),
      assertConfirmed: (id, work, owner) => { this.guard(); const preview = this.approved; if (this.cancelled || !preview || id !== preview.requestId || JSON.stringify(work) !== JSON.stringify(preview.work) || JSON.stringify(owner) !== JSON.stringify(preview.owner)) throw Error('CONFIRMATION_REQUIRED') },
      hook: phase => this.options.recoveryHook?.(phase),
    })
  }
  get pending() { return this.restartUnconfirmed || this.started && !this.endedBeforeClose && !this.committed }
  get preparing() { return !!this.startFlight && !this.afterCloseEntered }
  get requiresRestart() { return this.afterCloseEntered }
  // completed is set only after confirmation, physical core IO and notice
  // actually finish; a cancellation's bookkeeping can settle one microtask later.
  get ready() { return this.completed && !this.committed && !this.authorityFailure }
  get outcome(): WorkLeaseHandoffOutcome | null { return this.result ? { ...this.result } : null }
  private guard() {
    if (this.authorityFailure) fail(this.authorityFailure)
    try { synchronous(() => this.options.assertHost(), 'HANDOFF_HOST_LOST'); synchronous(() => this.options.assertOwner(this.identity.owner), 'HANDOFF_OWNER_CHANGED'); if (this.closed) this.assertClosed() }
    catch (error) { const failure = safe(error, 'HANDOFF_HOST_LOST'); this.authorityFailure = failure.code; this.controller.abort(); this.retirePreview(); throw failure }
  }
  private assertClosed() { synchronous(() => this.options.assertClosed(), 'HANDOFF_NOT_CLOSED') }
  private retirePreview() { this.approved = null; if (this.preview) this.recovery.cancel(this.preview.requestId) }
  start(): Promise<boolean> {
    if (this.startFlight) return this.startFlight
    if (this.started || this.cancelled || this.committed) return Promise.reject(new WorkLeaseHandoffError('HANDOFF_STATE_INVALID'))
    this.started = true
    const flight = Promise.resolve().then(async () => {
      try { this.guard(); const result = await this.options.close('quit'); if (!result && !this.afterCloseEntered) this.endedBeforeClose = true; return result }
      catch (error) { if (!this.afterCloseEntered) this.endedBeforeClose = true; throw safe(error, 'HANDOFF_CLOSE_FAILED') }
    })
    this.startFlight = flight
    void flight.then(() => { if (this.startFlight === flight) this.startFlight = null }, () => { if (this.startFlight === flight) this.startFlight = null })
    return flight
  }
  finishClosed(): Promise<void> {
    if (this.finishFlight) return this.finishFlight
    if (!this.started || this.endedBeforeClose || this.committed) return Promise.reject(new WorkLeaseHandoffError('HANDOFF_NOT_STARTED'))
    const flight = Promise.resolve().then(() => this.finish()).catch(error => { throw safe(error, 'HANDOFF_IO_FAILED') })
    this.finishFlight = flight
    void flight.then(() => { if (this.finishFlight === flight) this.finishFlight = null }, () => { if (this.finishFlight === flight) this.finishFlight = null })
    return flight
  }
  private async checkedRecovery(run: () => Promise<void>) {
    try { await run() }
    catch (error) {
      this.guard()
      if (this.cancelled) { this.retirePreview(); await this.recovery.flush(); this.result ??= { workId: this.identity.workId, status: 'cancelled' }; return }
      if (error instanceof WorkLeaseRecoveryError && checkFailures.has(error.code)) { this.retirePreview(); await this.recovery.flush(); this.result = { workId: this.identity.workId, status: 'failed' }; return }
      throw safe(error, 'HANDOFF_IO_FAILED')
    }
  }
  private async finish() {
    // This callback is reached only from the host's afterClose branch. A failed
    // first proof cannot authorize recovery, or make old editor buffers reusable.
    this.afterCloseEntered = true; this.guard(); this.assertClosed(); this.closed = true; this.completed = false
    if (!this.result && this.cancelled) { this.retirePreview(); await this.recovery.flush(); this.result = { workId: this.identity.workId, status: 'cancelled' } }
    if (!this.result && !this.preview) {
      if (!this.target) { try { this.target = await this.options.target(this.identity.workId) } catch (error) { throw safe(error, 'HANDOFF_IO_FAILED') }; this.guard() }
      await this.checkedRecovery(async () => { this.preview = freezePreview(await this.recovery.prepare(this.target!)) })
      this.guard()
    }
    if (!this.result && !this.approved) {
      if (this.cancelled) { this.retirePreview(); await this.recovery.flush(); this.result = { workId: this.identity.workId, status: 'cancelled' } }
      else {
        const preview = this.preview!; let confirmed: boolean
        try { confirmed = await Promise.resolve().then(() => this.cancelled ? false : this.options.confirm(preview, this.controller.signal)) } catch (error) { throw safe(error, 'HANDOFF_CONFIRM_FAILED') }
        this.guard()
        if (!this.cancelled && typeof confirmed !== 'boolean') return fail('HANDOFF_CONFIRM_FAILED')
        if (this.cancelled || confirmed !== true) { this.retirePreview(); await this.recovery.flush(); this.result = { workId: this.identity.workId, status: 'cancelled' } }
        else this.approved = preview
      }
    }
    if (!this.result) {
      await this.checkedRecovery(async () => { const result = await this.recovery.recover(this.preview!.requestId); this.result = { workId: this.identity.workId, status: result.status } })
      this.guard()
    }
    this.retirePreview(); await this.recovery.flush(); this.guard()
    if (!this.noticed) { try { await this.options.notice(messages[this.result!.status]) } catch (error) { throw safe(error, 'HANDOFF_NOTICE_FAILED') }; this.guard(); this.noticed = true }
    this.completed = true
  }
  cancel(): Promise<void> {
    if (this.committed) return Promise.resolve()
    this.cancelled = true; this.controller.abort(); this.retirePreview(); this.completed = false
    if (this.cancelFlight) return this.cancelFlight
    const flight = Promise.resolve().then(async () => { const finishing = this.finishFlight; if (finishing) await finishing.catch(() => {}); await this.recovery.flush() })
    this.cancelFlight = flight
    void flight.then(() => { if (this.cancelFlight === flight) this.cancelFlight = null }, () => { if (this.cancelFlight === flight) this.cancelFlight = null })
    return flight
  }
  commit(): boolean {
    if (this.restartUnconfirmed) return fail('HANDOFF_RESTART_UNCONFIRMED')
    if (this.committed) return false
    if (!this.ready) return fail('HANDOFF_STATE_INVALID')
    this.guard(); this.assertClosed(); this.committed = true; this.completed = false
    try { synchronous(() => this.options.restart(), 'HANDOFF_RESTART_UNCONFIRMED') }
    catch { this.restartUnconfirmed = true; return fail('HANDOFF_RESTART_UNCONFIRMED') }
    return true
  }
}
