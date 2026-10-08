import { constants, type BigIntStats, lstatSync, realpathSync, readdirSync, openSync, fstatSync, readSync, closeSync, unlinkSync, rmdirSync, renameSync } from 'node:fs'
import { lstat, open, readdir } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import {LEGACY_NAMES,type BrandNames} from '../shared/brand-names'
import {assertBrandControls} from './brand-names'
import type { RootIdentity } from './data-root'
import { assertDirectory, directoryIdentity, rootIdentitySchema } from './root-ownership'

export const WORK_LEASE_AUDIT_FILENAME = LEGACY_NAMES.audit
export const MAX_WORK_LEASE_AUDIT_BYTES = 16 * 1024
const ownerSchema = z.object({ token: z.uuid(), pid: z.number().int().safe().min(1), host: z.string().min(1).max(255).regex(/^[^\x00-\x1f\x7f]+$/) }).strict()
const numberText = z.string().regex(/^\d{1,32}$/)
const revisionSchema = z.object({ device: numberText, inode: numberText, size: numberText, mtimeNs: numberText, ctimeNs: numberText }).strict()
const fileIdentitySchema = z.object({ device: numberText, inode: numberText }).strict()
const ownerProofSchema = z.object({ revision: revisionSchema, bytes: z.string().max(5500), sha256: z.string().regex(/^[a-f\d]{64}$/) }).strict()
const payloadSchema = z.object({ schemaVersion: z.literal(1), type: z.enum(['xuanxiang-work-lease-recovery','xaanink-work-lease-recovery']), revision: z.number().int().safe().min(1), auditId: z.uuid(), phase: z.enum(['observed', 'recovered']), work: rootIdentitySchema, lock: revisionSchema, owner: ownerSchema, ownerProof: ownerProofSchema }).strict()
const envelopeSchema = z.object({ fileIdentity: fileIdentitySchema, payload: payloadSchema, checksum: z.string().regex(/^[a-f\d]{64}$/) }).strict()
type Revision = z.infer<typeof revisionSchema>
type AuditPayload = z.infer<typeof payloadSchema>
interface Snapshot { stat: BigIntStats; bytes: Buffer }
interface Audit { snapshot: Snapshot; payload: AuditPayload }
interface Request {
  id: string; work: RootIdentity; names:Readonly<BrandNames>; owner: LeaseOwner; originalOwner: Snapshot | null
  lock: BigIntStats | null; audit: Audit | null; phase: 'owner-present' | 'empty-lock' | 'lock-absent' | 'recovered'
  cancelled: boolean; flight?: Promise<WorkLeaseRecoveryResult>
}
const digest = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')
const revision = (stat: BigIntStats): Revision => ({ device: String(stat.dev), inode: String(stat.ino), size: String(stat.size), mtimeNs: String(stat.mtimeNs), ctimeNs: String(stat.ctimeNs) })
const identityEqual = (a: BigIntStats, b: BigIntStats) => a.dev === b.dev && a.ino === b.ino
const revisionEqual = (a: BigIntStats, b: BigIntStats) => identityEqual(a, b) && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs
const proofIdentityEqual = (info: BigIntStats, proof: Revision) => String(info.dev) === proof.device && String(info.ino) === proof.inode
const sameSnapshot = (a: Snapshot, b: Snapshot) => revisionEqual(a.stat, b.stat) && a.bytes.equals(b.bytes)
function fail(code: string): never { throw new WorkLeaseRecoveryError(code) }
const failureCodes = new Set(['HOST_NOT_OWNED', 'WORK_NOT_CLOSED', 'WORK_CHANGED', 'CONFIRMATION_REQUIRED', 'REQUEST_INVALID', 'OWNER_FOREIGN', 'OWNER_UNCERTAIN', 'OWNER_ALIVE', 'OWNER_INVALID', 'OWNER_CHANGED', 'AUDIT_INVALID', 'AUDIT_CHANGED', 'AUDIT_DURABILITY_UNCONFIRMED', 'AUDIT_WRITE_FAILED', 'LOCK_CHANGED', 'LOCK_CONTENTS_UNKNOWN', 'RECOVERY_BUSY', 'RECOVERY_LIMIT', 'RECOVERY_IO_FAILED'])
function safeError(error: unknown) { return new WorkLeaseRecoveryError(error instanceof WorkLeaseRecoveryError && failureCodes.has(error.code) ? error.code : 'RECOVERY_IO_FAILED') }
function synchronous(value: unknown, code: string) {
  if (value && typeof (value as { then?: unknown }).then === 'function') { void Promise.resolve(value).catch(() => {}); fail(code) }
}
function workImmediately(work: RootIdentity) {
  try { const root = lstatSync(work.path, { bigint: true }); if (!root.isDirectory() || root.isSymbolicLink() || String(root.dev) !== work.device || String(root.ino) !== work.inode || realpathSync(work.path) !== work.path) fail('WORK_CHANGED') } catch { fail('WORK_CHANGED') }
}

async function boundedFile(path: string, limit: number, code: string): Promise<Snapshot | null> {
  let before: BigIntStats
  try { before = await lstat(path, { bigint: true }) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; return fail(code) }
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.size < 1n || before.size > BigInt(limit)) fail(code)
  try {
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const opened = await handle.stat({ bigint: true }); if (!revisionEqual(before, opened)) fail(code)
      const buffer = Buffer.alloc(limit + 1); let size = 0
      for (;;) { const read = await handle.read(buffer, size, buffer.length - size, null); if (!read.bytesRead) break; size += read.bytesRead; if (size > limit) fail(code) }
      const after = await handle.stat({ bigint: true }), leaf = await lstat(path, { bigint: true })
      if (!revisionEqual(opened, after) || !revisionEqual(after, leaf) || !leaf.isFile() || leaf.nlink !== 1n || size !== Number(after.size)) fail(code)
      return { stat: after, bytes: Buffer.from(buffer.subarray(0, size)) }
    } finally { await handle.close() }
  } catch { return fail(code) }
}
async function lockStat(work: RootIdentity,names:Readonly<BrandNames>): Promise<BigIntStats | null> {
  const path = join(work.path, names.lock)
  try { const info = await lstat(path, { bigint: true }); if (!info.isDirectory() || info.isSymbolicLink()) fail('LOCK_CHANGED'); const actual = await directoryIdentity(path); if (actual.device !== String(info.dev) || actual.inode !== String(info.ino)) fail('LOCK_CHANGED'); return info }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; if (error instanceof WorkLeaseRecoveryError) throw error; return fail('LOCK_CHANGED') }
}
function boundedFileSync(path: string, limit: number, code: string): Snapshot | null {
  let before: BigIntStats
  try { before = lstatSync(path, { bigint: true }) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; return fail(code) }
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.size < 1n || before.size > BigInt(limit)) fail(code)
  let fd: number | undefined
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW); const opened = fstatSync(fd, { bigint: true }); if (!revisionEqual(before, opened)) fail(code)
    const buffer = Buffer.alloc(limit + 1); let size = 0
    for (;;) { const count = readSync(fd, buffer, size, buffer.length - size, null); if (!count) break; size += count; if (size > limit) fail(code) }
    const after = fstatSync(fd, { bigint: true }), leaf = lstatSync(path, { bigint: true })
    if (!revisionEqual(opened, after) || !revisionEqual(after, leaf) || !leaf.isFile() || leaf.nlink !== 1n || size !== Number(after.size)) fail(code)
    return { stat: after, bytes: Buffer.from(buffer.subarray(0, size)) }
  } catch { return fail(code) }
  finally { if (fd !== undefined) closeSync(fd) }
}
async function syncDirectory(path: string) {
  let phase: 'open' | 'sync' | 'close' = 'open'
  try { const handle = await open(path, 'r'); try { phase = 'sync'; await handle.sync() } finally { const previous = phase; phase = 'close'; await handle.close(); phase = previous } }
  catch (error) { const code = (error as NodeJS.ErrnoException).code, unsupported = phase === 'open' && code === 'EISDIR' || (phase === 'open' || phase === 'sync') && ['ENOTSUP', 'EOPNOTSUPP', 'ENOSYS'].includes(code ?? '') || phase === 'sync' && code === 'EINVAL'; if (process.platform !== 'win32' || !unsupported) throw error }
}
function decodeAudit(work: RootIdentity, snapshot: Snapshot,names:Readonly<BrandNames>): Audit {
  let envelope: z.infer<typeof envelopeSchema>
  try { envelope = envelopeSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(snapshot.bytes))) } catch { return fail('AUDIT_INVALID') }
  if(envelope.payload.type!==names.auditType)fail('AUDIT_INVALID')
  if (String(snapshot.stat.dev) !== envelope.fileIdentity.device || String(snapshot.stat.ino) !== envelope.fileIdentity.inode) fail('AUDIT_CHANGED')
  if (digest(JSON.stringify({ fileIdentity: envelope.fileIdentity, payload: envelope.payload })) !== envelope.checksum || JSON.stringify(envelope.payload.work) !== JSON.stringify(work)) fail('AUDIT_CHANGED')
  const raw = Buffer.from(envelope.payload.ownerProof.bytes, 'base64')
  try { if (raw.toString('base64') !== envelope.payload.ownerProof.bytes || raw.length < 1 || raw.length > 4096 || String(raw.length) !== envelope.payload.ownerProof.revision.size || digest(raw) !== envelope.payload.ownerProof.sha256 || JSON.stringify(ownerSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)))) !== JSON.stringify(envelope.payload.owner)) fail('AUDIT_INVALID') } catch { return fail('AUDIT_INVALID') }
  if (envelope.payload.owner.host !== hostname()) fail('OWNER_FOREIGN')
  return { snapshot, payload: envelope.payload }
}
/** Cold startup triage only; no ownership grant, audit write or lease removal. */
export interface WorkLeaseAuditObservation {readonly phase:'absent'|'observed'|'recovered';assertCurrent():void}
export function observeWorkLeaseAudit(input:RootIdentity,names:Readonly<BrandNames>=LEGACY_NAMES):WorkLeaseAuditObservation {
  const work=Object.freeze(rootIdentitySchema.parse(input))
  workImmediately(work)
  assertBrandControls(work,names)
  const snapshot = boundedFileSync(join(work.path, names.audit), MAX_WORK_LEASE_AUDIT_BYTES, 'AUDIT_INVALID')
  const phase=snapshot?decodeAudit(work,snapshot,names).payload.phase:'absent'
  workImmediately(work)
  return Object.freeze({phase,assertCurrent(){
    workImmediately(work)
    assertBrandControls(work,names)
    const current=boundedFileSync(join(work.path,names.audit),MAX_WORK_LEASE_AUDIT_BYTES,'AUDIT_CHANGED')
    if(snapshot?!current||!sameSnapshot(snapshot,current):current!==null)fail('AUDIT_CHANGED')
    workImmediately(work)
  }})
}
export function inspectWorkLeaseAudit(work: RootIdentity): 'absent' | 'observed' | 'recovered' {
  return observeWorkLeaseAudit(work).phase
}
export interface LeaseOwner { token: string; pid: number; host: string }
export interface WorkLeaseRecoveryOptions {
  namesForWork?(work:RootIdentity):Readonly<BrandNames>
  assertHost(): void
  assertWorkClosed(work: RootIdentity): void | Promise<void>
  assertConfirmed(requestId: string, work: RootIdentity, owner: LeaseOwner): void
  probePid?(pid: number): void
  hook?(phase: 'before-owner-unlink' | 'after-owner-unlink' | 'before-directory-remove' | 'before-audit-rename' | 'before-audit-sync' | 'after-audit-commit'): void | Promise<void>
}
export interface WorkLeaseRecoveryPreview { requestId: string; work: RootIdentity; owner: LeaseOwner; stage: 'owner-present' | 'empty-lock' | 'lock-absent' }
export type WorkLeaseRecoveryResult = { requestId: string; status: 'recovered' | 'cleanup-pending' }
export class WorkLeaseRecoveryError extends Error { constructor(readonly code: string) { super(code) } }
export class WorkLeaseRecovery {
  private requests = new Map<string, Request>()
  private busy = new Set<string>()
  private pending = new Set<Promise<WorkLeaseRecoveryResult>>()
  constructor(private options: WorkLeaseRecoveryOptions) {}
  private names(work:RootIdentity){try{const names=this.options.namesForWork?.(work)??LEGACY_NAMES;assertBrandControls(work,names);return names}catch{fail('WORK_CHANGED')}}
  private host() { try { synchronous(this.options.assertHost(), 'HOST_NOT_OWNED') } catch { fail('HOST_NOT_OWNED') } }
  private async closed(work: RootIdentity) { this.host(); try { await this.options.assertWorkClosed(work) } catch { fail('WORK_NOT_CLOSED') }; this.host(); try { await assertDirectory(work) } catch { fail('WORK_CHANGED') }; this.host() }
  private confirmed(request: Request) { this.host(); if (request.cancelled || this.requests.get(request.id) !== request) fail('REQUEST_INVALID'); try { synchronous(this.options.assertConfirmed(request.id, request.work, request.owner), 'CONFIRMATION_REQUIRED') } catch { fail('CONFIRMATION_REQUIRED') } }
  private dead(owner: LeaseOwner) {
    if (owner.host !== hostname()) fail('OWNER_FOREIGN')
    try { (this.options.probePid ?? (pid => process.kill(pid, 0)))(owner.pid) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return; fail('OWNER_UNCERTAIN') }
    fail('OWNER_ALIVE')
  }
  private async audit(work: RootIdentity,names=this.names(work)): Promise<Audit | null> {
    const snapshot = await boundedFile(join(work.path, names.audit), MAX_WORK_LEASE_AUDIT_BYTES, 'AUDIT_INVALID')
    if (!snapshot) return null
    return decodeAudit(work, snapshot,names)
  }
  private async sameAudit(request: Request) { const current = await this.audit(request.work,request.names); if (request.audit ? !current || !sameSnapshot(current.snapshot, request.audit.snapshot) : current !== null) fail('AUDIT_CHANGED') }
  private async entries(work: RootIdentity, expected: 'owner' | 'empty',brand=this.names(work)) { let names: string[]; try { names = await readdir(join(work.path, brand.lock)) } catch { return fail('LOCK_CHANGED') }; if (expected === 'owner' ? names.length !== 1 || names[0] !== 'owner.json' : names.length !== 0) fail('LOCK_CONTENTS_UNKNOWN') }
  async prepare(input: RootIdentity): Promise<WorkLeaseRecoveryPreview> {
    this.host(); let work: RootIdentity
    try { work = rootIdentitySchema.parse(input) } catch { return fail('WORK_CHANGED') }
    if (this.pending.size >= 32 || this.busy.has(work.path) || [...this.requests.values()].some(request => request.work.path === work.path && request.phase !== 'recovered' && !request.cancelled)) fail('RECOVERY_BUSY')
    if (this.requests.size >= 128) { for (const [id, request] of this.requests) if (request.phase === 'recovered') this.requests.delete(id); if (this.requests.size >= 128) fail('RECOVERY_LIMIT') }
    this.busy.add(work.path)
    try {
      await this.closed(work); const brand=this.names(work),audit = await this.audit(work,brand), lock = await lockStat(work,brand)
      let owner: LeaseOwner, originalOwner: Snapshot | null, stage: WorkLeaseRecoveryPreview['stage']
      if (lock) {
        const names = await readdir(join(work.path, brand.lock))
        if (names.length === 1 && names[0] === 'owner.json') {
          const snapshot = await boundedFile(join(work.path, brand.lock, 'owner.json'), 4096, 'OWNER_INVALID'); if (!snapshot) fail('OWNER_INVALID')
          try { owner = ownerSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(snapshot.bytes))) } catch { return fail('OWNER_INVALID') }
          this.dead(owner); originalOwner = snapshot; stage = 'owner-present'
          if (audit?.payload.phase === 'observed' && (!proofIdentityEqual(lock, audit.payload.lock) || JSON.stringify(revision(snapshot.stat)) !== JSON.stringify(audit.payload.ownerProof.revision) || snapshot.bytes.toString('base64') !== audit.payload.ownerProof.bytes)) fail('AUDIT_CHANGED')
        } else if (names.length === 0 && audit?.payload.phase === 'observed' && proofIdentityEqual(lock, audit.payload.lock)) { owner = audit.payload.owner; originalOwner = null; stage = 'empty-lock' }
        else if (names.length !== 0) return fail('LOCK_CONTENTS_UNKNOWN')
        else return fail(audit ? 'LOCK_CHANGED' : 'OWNER_INVALID')
      } else {
        if (!audit) fail('OWNER_INVALID')
        owner = audit.payload.owner; originalOwner = null; stage = 'lock-absent'
      }
      await this.closed(work); const final = await lockStat(work,brand)
      if (lock ? !final || !revisionEqual(lock, final) : final !== null) fail('LOCK_CHANGED')
      const request: Request = { id: randomUUID(), work: Object.freeze(work), names:brand, owner: Object.freeze(owner), originalOwner, lock, audit, phase: stage, cancelled: false }
      this.requests.set(request.id, request)
      return { requestId: request.id, work: { ...work }, owner: { ...owner }, stage }
    } catch (error) { throw safeError(error) }
    finally { this.busy.delete(work.path) }
  }
  private async validate(request: Request) {
    this.confirmed(request); await this.closed(request.work); await this.sameAudit(request)
    if(this.names(request.work).family!==request.names.family)fail('WORK_CHANGED')
    const lock = await lockStat(request.work,request.names)
    if (request.lock ? !lock || !identityEqual(request.lock, lock) : lock !== null) fail('LOCK_CHANGED')
    if (request.phase === 'owner-present') {
      if (!lock || !revisionEqual(request.lock!, lock)) fail('LOCK_CHANGED'); await this.entries(request.work, 'owner')
      const snapshot = await boundedFile(join(request.work.path, request.names.lock, 'owner.json'), 4096, 'OWNER_CHANGED')
      if (!snapshot || !request.originalOwner || !sameSnapshot(snapshot, request.originalOwner)) fail('OWNER_CHANGED'); this.dead(request.owner)
    } else if (request.phase === 'empty-lock') { await this.entries(request.work, 'empty'); if (!lock || !revisionEqual(request.lock!, lock)) fail('LOCK_CHANGED') }
    this.confirmed(request)
  }
  /** Bounded metadata only: do not yield between the last checks and unlink/rmdir. */
  private immediately(request: Request) {
    this.confirmed(request)
    workImmediately(request.work)
    if(this.names(request.work).family!==request.names.family)fail('WORK_CHANGED')
    const receipt = boundedFileSync(join(request.work.path, request.names.audit), MAX_WORK_LEASE_AUDIT_BYTES, 'AUDIT_CHANGED')
    if (request.audit ? !receipt || !sameSnapshot(request.audit.snapshot, receipt) : receipt !== null) fail('AUDIT_CHANGED')
    const path = join(request.work.path, request.names.lock); let lock: BigIntStats | null = null
    try { lock = lstatSync(path, { bigint: true }) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') fail('LOCK_CHANGED') }
    if (request.lock ? !lock || !lock.isDirectory() || lock.isSymbolicLink() || !revisionEqual(request.lock, lock) || realpathSync(path) !== path : lock !== null) fail('LOCK_CHANGED')
    if (request.phase === 'owner-present' || request.phase === 'empty-lock') {
      const names = readdirSync(path)
      if (request.phase === 'owner-present' ? names.length !== 1 || names[0] !== 'owner.json' : names.length !== 0) fail('LOCK_CONTENTS_UNKNOWN')
      if (request.phase === 'owner-present') { const owner = boundedFileSync(join(path, 'owner.json'), 4096, 'OWNER_CHANGED'); if (!owner || !request.originalOwner || !sameSnapshot(owner, request.originalOwner)) fail('OWNER_CHANGED'); this.dead(request.owner) }
      const final = lstatSync(path, { bigint: true }); if (!revisionEqual(request.lock!, final)) fail('LOCK_CHANGED')
    }
    this.confirmed(request)
  }
  recover(requestId: string): Promise<WorkLeaseRecoveryResult> {
    const request = this.requests.get(requestId); if (!request || request.cancelled) return Promise.reject(new WorkLeaseRecoveryError('REQUEST_INVALID'))
    if (request.phase === 'recovered') return Promise.resolve({ requestId, status: 'recovered' })
    if (request.flight) return request.flight
    if (this.busy.has(request.work.path) || this.pending.size >= 32) return Promise.reject(new WorkLeaseRecoveryError('RECOVERY_BUSY'))
    this.busy.add(request.work.path)
    const flight = Promise.resolve().then(() => this.run(request)).catch(error => { throw safeError(error) }); request.flight = flight
    this.pending.add(flight)
    void flight.finally(() => { request.flight = undefined; this.busy.delete(request.work.path); this.pending.delete(flight) }).catch(() => {})
    return flight
  }
  cancel(requestId: string) { const request = this.requests.get(requestId); if (request) { request.cancelled = true; this.requests.delete(requestId) } }
  async flush() { for (;;) { const flights = [...this.pending]; if (!flights.length) return; await Promise.allSettled(flights) } }
  private async syncAudit(request: Request) { this.confirmed(request); await this.sameAudit(request); try { await this.options.hook?.('before-audit-sync'); await syncDirectory(request.work.path) } catch { fail('AUDIT_DURABILITY_UNCONFIRMED') }; await this.closed(request.work); await this.sameAudit(request); this.confirmed(request) }
  private async writeAudit(request: Request, phase: AuditPayload['phase']) {
    const previous = request.audit, path = join(request.work.path, request.names.audit), temporary = join(request.work.path, `${request.names.leaseTemporaryPrefix}${randomUUID()}.tmp`)
    let owned: BigIntStats | undefined, committed = false
    try {
      const handle = await open(temporary, 'wx', 0o600)
      try {
        owned = await handle.stat({ bigint: true })
        const reuseProof = previous && (previous.payload.phase === 'observed' || request.phase === 'lock-absent')
        if (!reuseProof && (!request.lock || !request.originalOwner)) fail('AUDIT_INVALID')
        const payload: AuditPayload = { schemaVersion: 1, type: request.names.auditType as AuditPayload["type"], revision: (previous?.payload.revision ?? 0) + 1, auditId: reuseProof ? previous.payload.auditId : request.id, phase, work: request.work, lock: reuseProof ? previous.payload.lock : revision(request.lock!), owner: request.owner, ownerProof: reuseProof ? previous.payload.ownerProof : { revision: revision(request.originalOwner!.stat), bytes: request.originalOwner!.bytes.toString('base64'), sha256: digest(request.originalOwner!.bytes) } }
        const base = { fileIdentity: { device: String(owned.dev), inode: String(owned.ino) }, payload }, bytes = Buffer.from(JSON.stringify({ ...base, checksum: digest(JSON.stringify(base)) }) + '\n')
        if (bytes.length > MAX_WORK_LEASE_AUDIT_BYTES) fail('AUDIT_INVALID')
        await handle.writeFile(bytes); await handle.sync(); owned = await handle.stat({ bigint: true })
        await this.options.hook?.('before-audit-rename'); await this.validate(request)
        const actual = await boundedFile(temporary, MAX_WORK_LEASE_AUDIT_BYTES, 'AUDIT_CHANGED')
        if (!actual || !revisionEqual(actual.stat, owned) || !actual.bytes.equals(bytes)) fail('AUDIT_CHANGED')
        this.immediately(request); const finalTemp = lstatSync(temporary, { bigint: true }); if (!finalTemp.isFile() || finalTemp.nlink !== 1n || !revisionEqual(finalTemp, owned)) fail('AUDIT_CHANGED'); renameSync(temporary, path); committed = true
        const snapshot = await boundedFile(path, MAX_WORK_LEASE_AUDIT_BYTES, 'AUDIT_CHANGED')
        if (!snapshot || !identityEqual(snapshot.stat, owned) || !snapshot.bytes.equals(bytes)) fail('AUDIT_CHANGED')
        request.audit = { snapshot, payload }
      } finally { await handle.close() }
      await this.options.hook?.('after-audit-commit'); await this.syncAudit(request)
    } catch (error) { if (error instanceof WorkLeaseRecoveryError) throw error; fail(committed ? 'AUDIT_DURABILITY_UNCONFIRMED' : 'AUDIT_WRITE_FAILED') }
    finally { if (owned && !committed) try { const current = await lstat(temporary, { bigint: true }); if (revisionEqual(current, owned)) { workImmediately(request.work); const final = lstatSync(temporary, { bigint: true }); if (final.isFile() && final.nlink === 1n && revisionEqual(final, owned)) unlinkSync(temporary) } } catch { /* Preserve foreign/unknown temporary data. */ } }
  }
  private async run(request: Request): Promise<WorkLeaseRecoveryResult> {
    await this.validate(request)
    if (!request.audit || request.audit.payload.phase === 'recovered' && request.phase === 'owner-present') await this.writeAudit(request, 'observed')
    else await this.syncAudit(request)
    if (request.phase === 'owner-present') {
      await this.options.hook?.('before-owner-unlink'); await this.validate(request)
      this.immediately(request); unlinkSync(join(request.work.path, request.names.lock, 'owner.json')); request.phase = 'empty-lock'
      try { const after = await lockStat(request.work,request.names); if (!after || !identityEqual(request.lock!, after)) fail('LOCK_CHANGED'); request.lock = after; await this.options.hook?.('after-owner-unlink') }
      catch { return { requestId: request.id, status: 'cleanup-pending' } }
    }
    try {
      if (request.phase === 'empty-lock') {
        await this.options.hook?.('before-directory-remove'); await this.validate(request)
        this.immediately(request); rmdirSync(join(request.work.path, request.names.lock)); request.phase = 'lock-absent'; request.lock = null
      }
      await this.validate(request); await syncDirectory(request.work.path); await this.writeAudit(request, 'recovered'); this.immediately(request); request.phase = 'recovered'
      return { requestId: request.id, status: 'recovered' }
    } catch (error) { if (error instanceof WorkLeaseRecoveryError && ['LOCK_CHANGED', 'LOCK_CONTENTS_UNKNOWN', 'AUDIT_CHANGED', 'WORK_CHANGED'].includes(error.code)) throw error; return { requestId: request.id, status: 'cleanup-pending' } }
  }
}
