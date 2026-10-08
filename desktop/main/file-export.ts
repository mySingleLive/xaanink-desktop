import { randomUUID, createHash } from "node:crypto"
import { constants, type BigIntStats } from "node:fs"
import { open, lstat, realpath, rename, unlink } from "node:fs/promises"
import { basename, dirname, isAbsolute, join } from "node:path"
import { fileExportRequestSchema, exportExtensions, type FileExportFormat, type FileExportResult, type FileExportRequest, type FileExportFailure } from "../shared/file-export"
import {validateDraftSnapshot} from "./draft-journal"
import {z} from "zod"
import { templateDocumentSchema } from "../shared/template-library"
export interface FileExportOptions {
  assertOwner(owner: string): void
  chooseSave(owner: string, input: { filename: string; format: FileExportFormat; extension: string }): Promise<string | null>
  guardTarget(canonicalTarget: string): Promise<void>
  beforeRename?(): Promise<void>
  beforeDirectorySync?(): Promise<void>
  platform?: NodeJS.Platform
}
class ExportError extends Error { constructor(readonly code: FileExportFailure) { super(code) } }
class ExportCancelled extends Error {}
interface Operation { owner: string; id: string; cancelled: boolean; stopped: PromiseWithResolvers<void> }
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex")
const sameIdentity = (a: BigIntStats, b: BigIntStats) => a.dev === b.dev && a.ino === b.ino
const sameRevision = (a: BigIntStats, b: BigIntStats) => sameIdentity(a, b) && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs
const invalid = () => { throw new ExportError("EXPORT_TARGET_INVALID") }
async function selectedFile(path: string): Promise<BigIntStats | null> {
  try { const info = await lstat(path, { bigint: true }); if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1n) invalid(); return info }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error }
}
async function readOwned(path: string, identity: BigIntStats, bytes: Uint8Array) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const info = await handle.stat({ bigint: true })
    if (!info.isFile() || info.nlink !== 1n || !sameIdentity(info, identity) || info.size !== BigInt(bytes.length)) throw new ExportError("EXPORT_TARGET_CHANGED")
    const digest = createHash("sha256"); let length = 0
    for (;;) { const block = Buffer.allocUnsafe(Math.min(64 * 1024, bytes.length + 1 - length)), result = await handle.read(block); if (!result.bytesRead) break; length += result.bytesRead; if (length > bytes.length) throw new ExportError("EXPORT_TARGET_CHANGED"); digest.update(block.subarray(0, result.bytesRead)) }
    const after = await lstat(path, { bigint: true })
    if (!after.isFile() || after.nlink !== 1n || !sameIdentity(after, identity) || !sameRevision(info, await handle.stat({ bigint: true })) || length !== bytes.length || digest.digest("hex") !== hash(bytes)) throw new ExportError("EXPORT_TARGET_CHANGED")
  } finally { await handle.close() }
}
function validateContent(request: FileExportRequest) {
  if (["txt", "md", "templates", "recovery"].includes(request.format)) {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(request.bytes)
    if (request.format === "templates") templateDocumentSchema.parse(JSON.parse(text))
    if (request.format === "recovery") {const envelope=z.object({format:z.enum(["xuanxiang-recovery","xaanink-recovery"]),version:z.literal(1),snapshot:z.unknown()}).strict().parse(JSON.parse(text));validateDraftSnapshot(envelope.snapshot)}
  } else if (request.format === "pdf") {
    if (new TextDecoder().decode(request.bytes.subarray(0, 5)) !== "%PDF-") throw Error("invalid PDF")
  } else if (request.bytes.length < 4 || request.bytes[0] !== 0x50 || request.bytes[1] !== 0x4b || request.bytes[2] !== 3 || request.bytes[3] !== 4) throw Error("invalid DOCX")
}
/** Native dialog paths are main-owned; no renderer-supplied path is accepted. */
export class FileExports {
  private operations = new Map<string, Operation>()
  private recent = new Map<string, Set<string>>()
  private pending = new Set<Promise<FileExportResult>>()
  constructor(private options: FileExportOptions) {}
  private active(operation: Operation) {
    if (operation.cancelled || this.operations.get(operation.owner) !== operation) throw new ExportCancelled()
    try { this.options.assertOwner(operation.owner) } catch { this.cancel(operation.owner, operation.id); throw new ExportCancelled() }
  }
  save(owner: string, input: unknown): Promise<FileExportResult> {
    const parsed = fileExportRequestSchema.safeParse(input)
    if (!parsed.success) return Promise.resolve({ id: null, status: "failed", code: "EXPORT_INPUT_INVALID" })
    const id = parsed.data.id
    try { this.options.assertOwner(owner) } catch { return Promise.resolve({ id, status: "cancelled" }) }
    if (this.operations.has(owner) || this.pending.size >= 8) return Promise.resolve({ id, status: "failed", code: "EXPORT_BUSY" })
    let recent = this.recent.get(owner); if (!recent) this.recent.set(owner, recent = new Set())
    if (recent.has(id)) return Promise.resolve({ id, status: "failed", code: "EXPORT_REPLAY" })
    const request = { ...parsed.data, bytes: Uint8Array.from(parsed.data.bytes) }
    try { validateContent(request) } catch { return Promise.resolve({ id, status: "failed", code: "EXPORT_INPUT_INVALID" }) }
    recent.add(id); if (recent.size > 128) recent.delete(recent.values().next().value!)
    const operation: Operation = { owner, id, cancelled: false, stopped: Promise.withResolvers<void>() }
    this.operations.set(owner, operation)
    const flight = Promise.resolve().then(() => this.run(operation, request))
    this.pending.add(flight); void flight.finally(() => this.pending.delete(flight)).catch(() => {})
    return flight
  }
  cancel(owner: string, id?: string) { const operation = this.operations.get(owner); if (operation && (!id || id === operation.id)) { operation.cancelled = true; operation.stopped.resolve(); this.operations.delete(owner) } }
  cancelWindow(prefix: string) { for (const owner of this.operations.keys()) if (owner.startsWith(prefix)) this.cancel(owner); for (const owner of this.recent.keys()) if (owner.startsWith(prefix)) this.recent.delete(owner) }
  async flush() { for (;;) { const pending = [...this.pending]; if (!pending.length) return; await Promise.allSettled(pending) } }
  private async protect(path: string) { try { await this.options.guardTarget(path) } catch { throw new ExportError("EXPORT_TARGET_PROTECTED") } }
  private async run(operation: Operation, request: FileExportRequest): Promise<FileExportResult> {
    let temporary: string | undefined, owned: BigIntStats | undefined, committed = false
    try {
      this.active(operation)
      const selected = await Promise.race([this.options.chooseSave(operation.owner, { filename: request.filename, format: request.format, extension: exportExtensions[request.format] }), operation.stopped.promise.then(() => { throw new ExportCancelled() })])
      this.active(operation); if (!selected) return { id: request.id, status: "cancelled" }
      if (!isAbsolute(selected) || selected.length > 4096 || /[\x00-\x1f]/.test(selected) || !basename(selected).endsWith(`.${exportExtensions[request.format]}`)) invalid()
      const parent = dirname(selected), info = await lstat(parent, { bigint: true }), canonical = await realpath(parent)
      if (!info.isDirectory() || info.isSymbolicLink()) invalid()
      const path = join(canonical, basename(selected)), before = await selectedFile(path)
      const guard = async () => {
        const current = await lstat(parent, { bigint: true }), canonicalInfo = await lstat(canonical, { bigint: true })
        if (!current.isDirectory() || current.isSymbolicLink() || !sameIdentity(current, info) || !sameIdentity(canonicalInfo, info) || await realpath(parent) !== canonical) throw new ExportError("EXPORT_TARGET_CHANGED")
        const after = await selectedFile(path)
        if (before ? !after || !sameRevision(before, after) : after !== null) throw new ExportError("EXPORT_TARGET_CHANGED")
      }
      await this.protect(path); await guard(); this.active(operation)
      temporary = join(canonical, `.${randomUUID()}.tmp`)
      const handle = await open(temporary, "wx", 0o600)
      try { owned = await handle.stat({ bigint: true }); await handle.writeFile(request.bytes); await handle.sync(); owned = await handle.stat({ bigint: true }) } finally { await handle.close() }
      await this.options.beforeRename?.()
      const temp = await lstat(temporary, { bigint: true })
      if (!temp.isFile() || temp.nlink !== 1n || !sameRevision(temp, owned)) throw new ExportError("EXPORT_TARGET_CHANGED")
      await readOwned(temporary, owned, request.bytes)
      await this.protect(path); await guard()
      const finalTemp = await lstat(temporary, { bigint: true })
      if (!finalTemp.isFile() || finalTemp.nlink !== 1n || !sameRevision(finalTemp, owned)) throw new ExportError("EXPORT_TARGET_CHANGED")
      this.active(operation)
      await rename(temporary, path); committed = true
      await this.options.beforeDirectorySync?.()
      // Attempt on every OS. Only a verified Windows unsupported operation is
      // exempt; permissions, missing paths and genuine IO errors forbid ACK.
      let phase: "open" | "stat" | "sync" | "close" = "open"
      try {
        const directory = await open(canonical, "r")
        try { phase = "stat"; const directoryInfo = await directory.stat({ bigint: true }); if (!directoryInfo.isDirectory() || !sameIdentity(directoryInfo, info)) throw new ExportError("EXPORT_TARGET_CHANGED"); phase = "sync"; await directory.sync() }
        finally { const previous = phase; phase = "close"; await directory.close(); phase = previous }
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        const unsupported = (phase === "open" && code === "EISDIR") || ((phase === "open" || phase === "sync") && ["ENOTSUP", "EOPNOTSUPP", "ENOSYS"].includes(code ?? "")) || (phase === "sync" && code === "EINVAL")
        if ((this.options.platform ?? process.platform) !== "win32" || !unsupported) throw error
      }
      await this.protect(path)
      const afterParent = await lstat(parent, { bigint: true })
      if (!afterParent.isDirectory() || !sameIdentity(afterParent, info) || await realpath(parent) !== canonical) throw new ExportError("EXPORT_TARGET_CHANGED")
      await readOwned(path, owned, request.bytes)
      // The final byte read can yield while a selected parent is replaced.
      // Recheck the directory authorization after that read, before ACK.
      await this.protect(path)
      const finalParent = await lstat(parent, { bigint: true }), finalCanonical = await lstat(canonical, { bigint: true })
      if (!finalParent.isDirectory() || finalParent.isSymbolicLink() || !finalCanonical.isDirectory() || !sameIdentity(finalParent, info) || !sameIdentity(finalCanonical, info) || await realpath(parent) !== canonical) throw new ExportError("EXPORT_TARGET_CHANGED")
      this.active(operation)
      return { id: request.id, status: "saved", bytesWritten: request.bytes.length, sha256: hash(request.bytes) }
    } catch (error) {
      if (committed) return { id: request.id, status: "failed", code: "EXPORT_DURABILITY_UNCONFIRMED" }
      if (error instanceof ExportCancelled) return { id: request.id, status: "cancelled" }
      return { id: request.id, status: "failed", code: error instanceof ExportError ? error.code : "EXPORT_WRITE_FAILED" }
    } finally {
      if (temporary && owned && !committed) {
        try { const current = await lstat(temporary, { bigint: true }); if (current.isFile() && sameRevision(current, owned)) await unlink(temporary) } catch { /* A foreign replacement or failed cleanup is preserved; never expose its cause. */ }
      }
      if (this.operations.get(operation.owner) === operation) this.operations.delete(operation.owner)
    }
  }
}
