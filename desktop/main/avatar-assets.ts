import { constants } from "node:fs"
import { open, mkdir, lstat, realpath, rename, unlink } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { isAbsolute, join, resolve, sep } from "node:path"
import sharp from "sharp"
import type { StoreOptions } from "../core/versioned-store"

export interface AvatarAssetOptions extends Pick<StoreOptions, "withWrite"> {
  root: string
  readSelectedFile?: (path: string, signal: AbortSignal) => Promise<Buffer>
  beforeRename?: () => Promise<void>
  beforeDirectorySync?: () => Promise<void>
}
export interface AvatarPreview { draftId: string; previewDataUrl: string; width: number; height: number; bytes: number }
export interface PersistedAvatar { assetId: string; url: string }
const MAX_INPUT = 10 * 1024 * 1024
const MAX_PIXELS = 16_000_000
const MAX_OUTPUT = 2 * 1024 * 1024
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const messages: Record<string, string> = {
  INVALID_SESSION: "头像编辑会话无效", SESSION_LIMIT: "头像编辑操作过多，请关闭其他编辑或重新启动应用",
  CANCELLED: "头像编辑已取消", STALE_SELECTION: "已选择新的头像，旧读取已忽略", INVALID_SELECTION: "请选择可读取的本地图片文件",
  INPUT_TOO_LARGE: "头像图片不能超过10MiB", INVALID_IMAGE: "请选择有效的PNG、JPEG或WebP图片", PIXEL_LIMIT: "头像图片不能超过1600万像素",
  ANIMATED_IMAGE: "头像暂不支持动画图片", DRAFT_UNAVAILABLE: "头像草稿已失效，请重新选择", ASSET_WRITE_FAILED: "头像保存失败，草稿已保留，请重试",
  INVALID_ASSET_ID: "头像资源标识无效", ASSET_READ_FAILED: "头像资源无法安全读取",
}
export class AvatarAssetError extends Error { constructor(readonly code: string) { super(messages[code] ?? "头像处理失败"); this.name = "AvatarAssetError" } }
interface Draft { id: string; bytes: Buffer; width: number; height: number; sequence: number; assetId?: string; writing?: Promise<PersistedAvatar> }
interface Session { owner: string; id: string; controller: AbortController; sequence: number; selection?: AbortController; selectionStaged?: boolean; draft?: Draft }
function error(code: string): never { throw new AvatarAssetError(code) }
function supportedSignature(bytes: Buffer) {
  return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) ||
    (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP")
}
async function limitedRead(path: string, signal: AbortSignal, limit: number): Promise<Buffer> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const info = await file.stat(); if (!info.isFile()) error("INVALID_SELECTION")
    if (info.size > limit) error("INPUT_TOO_LARGE")
    const chunks: Buffer[] = []; let total = 0
    for (;;) {
      signal.throwIfAborted()
      const block = Buffer.allocUnsafe(Math.min(64 * 1024, limit + 1 - total))
      const { bytesRead } = await file.read(block, 0, block.length, null)
      signal.throwIfAborted(); if (!bytesRead) break
      total += bytesRead; if (total > limit) error("INPUT_TOO_LARGE")
      chunks.push(block.subarray(0, bytesRead))
    }
    return Buffer.concat(chunks, total)
  } finally { await file.close() }
}

/** Main-only: selectedPath must come from the main process's native picker.
 * Preview drafts are memory-only. Settings commit remains the caller's CAS;
 * call assertActive immediately before starting it, and cancel after success.
 */
export class AvatarAssetService {
  private readonly sessions = new Map<string, Session>()
  // No eviction: a cancelled native-picker session cannot ever revive during
  // this service lifetime. Store only bounded IDs, never buffers or promises.
  private readonly retired = new Set<string>()
  private closed = false
  private admissionBlocked = false
  private reading = 0
  constructor(private readonly options: AvatarAssetOptions) { if (!isAbsolute(options.root)) error("INVALID_SELECTION") }
  private key(owner: string, sessionId: string) {
    if (typeof owner !== "string" || !owner || owner.length > 128 || /[\x00-\x1f]/.test(owner) || typeof sessionId !== "string" || !UUID.test(sessionId)) error("INVALID_SESSION")
    return `${owner}\0${sessionId}`
  }
  begin(owner: string, sessionId: string): void {
    const key = this.key(owner, sessionId)
    if (this.closed || this.retired.has(key)) error("CANCELLED")
    if (this.sessions.has(key)) return
    // Reserve retirement capacity at begin so cancellation itself always fits.
    if (this.admissionBlocked || this.sessions.size >= 16 || this.retired.size + this.sessions.size >= 8192) error("SESSION_LIMIT")
    this.sessions.set(key, { owner, id: sessionId, controller: new AbortController(), sequence: 0 })
  }
  private session(owner: string, sessionId: string) {
    const session = this.sessions.get(this.key(owner, sessionId))
    if (this.closed || !session || session.controller.signal.aborted) error("CANCELLED")
    return session
  }
  assertActive(owner: string, sessionId: string, draftId?: string): void {
    const session = this.session(owner, sessionId)
    if (draftId !== undefined && session.draft?.id !== draftId) error("DRAFT_UNAVAILABLE")
  }
  private assertSelection(session: Session, sequence: number) {
    if (this.session(session.owner, session.id) !== session) error("CANCELLED")
    if (session.sequence !== sequence) error("STALE_SELECTION")
  }
  /** Allocate before awaiting the native picker, so click order remains
   * authoritative even when its async callbacks arrive in reverse order. */
  beginSelection(owner: string, sessionId: string): number {
    const session = this.session(owner, sessionId)
    session.selection?.abort(new AvatarAssetError("STALE_SELECTION"))
    session.selection = new AbortController(); session.selectionStaged = false
    // A cancelled picker will never stage a file. Keep the last valid draft,
    // but invalidate all older reads at the moment the new picker is opened.
    return ++session.sequence
  }
  private async cancellable<T>(signal: AbortSignal, run: () => Promise<T>): Promise<T> {
    let aborted!: () => void
    const stopped = new Promise<never>((_resolve, reject) => {
      aborted = () => reject(signal.reason instanceof AvatarAssetError ? signal.reason : new AvatarAssetError("CANCELLED"))
      signal.addEventListener("abort", aborted, { once: true }); if (signal.aborted) aborted()
    })
    try { return await Promise.race([Promise.resolve().then(run), stopped]) }
    finally { signal.removeEventListener("abort", aborted) }
  }
  async stageSelected(owner: string, sessionId: string, selectedPath: string, selectionNumber?: number): Promise<AvatarPreview> {
    const session = this.session(owner, sessionId)
    if (typeof selectedPath !== "string" || !isAbsolute(selectedPath) || selectedPath.length > 4096 || selectedPath.includes("\0")) error("INVALID_SELECTION")
    if (this.reading >= 4) error("SESSION_LIMIT")
    const sequence = selectionNumber ?? this.beginSelection(owner, sessionId)
    if (!Number.isSafeInteger(sequence) || sequence < 1) error("STALE_SELECTION")
    this.assertSelection(session, sequence)
    if (!session.selection || session.selectionStaged) error("STALE_SELECTION")
    session.selectionStaged = true
    const controller = session.selection
    const signal = AbortSignal.any([session.controller.signal, controller.signal])
    const work = async () => {
      {
        this.assertSelection(session, sequence)
        let source: Buffer
        try { source = await (this.options.readSelectedFile ?? ((path, current) => limitedRead(path, current, MAX_INPUT)))(selectedPath, signal) }
        catch (cause) { this.assertSelection(session, sequence); if (cause instanceof AvatarAssetError) throw cause; error("INVALID_SELECTION") }
        this.assertSelection(session, sequence)
        if (!Buffer.isBuffer(source)) error("INVALID_IMAGE")
        if (source.length > MAX_INPUT) error("INPUT_TOO_LARGE")
        if (!supportedSignature(source)) error("INVALID_IMAGE")
        let normalized: { data: Buffer; info: sharp.OutputInfo }
        try {
          // Header-only metadata permits a precise pixel-limit error. Actual
          // decoding separately enforces the same cap, and strips metadata.
          const metadata = await sharp(source, { limitInputPixels: false, failOn: "warning" }).metadata()
          this.assertSelection(session, sequence)
          if (!["png", "jpeg", "webp"].includes(metadata.format ?? "")) error("INVALID_IMAGE")
          if ((metadata.pages ?? 1) > 1) error("ANIMATED_IMAGE")
          if (!metadata.width || !metadata.height || metadata.width * metadata.height > MAX_PIXELS) error("PIXEL_LIMIT")
          normalized = await sharp(source, { limitInputPixels: MAX_PIXELS, failOn: "warning" }).rotate().resize({ width: 512, height: 512, fit: "inside", withoutEnlargement: true }).png().timeout({ seconds: 10 }).toBuffer({ resolveWithObject: true })
        } catch (cause) { this.assertSelection(session, sequence); if (cause instanceof AvatarAssetError) throw cause; error("INVALID_IMAGE") }
        this.assertSelection(session, sequence)
        if (normalized.data.length > MAX_OUTPUT) error("INVALID_IMAGE")
        const draft: Draft = { id: randomUUID(), bytes: normalized.data, width: normalized.info.width, height: normalized.info.height, sequence }
        session.draft = draft
        return { draftId: draft.id, previewDataUrl: `data:image/png;base64,${draft.bytes.toString("base64")}`, width: draft.width, height: draft.height, bytes: draft.bytes.length }
      }
    }
    // Reserve before scheduling work. Cancelled host reads cannot hold the
    // live preparation quota; late work still fails its sequence checks.
    this.reading++
    try { return await this.cancellable(signal, work) } finally { this.reading-- }
  }
  private async directory(create: boolean): Promise<string | null> {
    const root = await realpath(resolve(this.options.root)); let path = root
    for (const name of ["assets", "global"]) {
      path = join(path, name)
      if (create) { try { await mkdir(path, { mode: 0o700 }) } catch (cause) { if ((cause as NodeJS.ErrnoException).code !== "EEXIST") throw cause } }
      let info
      try { info = await lstat(path) } catch (cause) { if (!create && (cause as NodeJS.ErrnoException).code === "ENOENT") return null; throw cause }
      if (!info.isDirectory() || info.isSymbolicLink() || !(await realpath(path)).startsWith(root + sep)) error(create ? "ASSET_WRITE_FAILED" : "ASSET_READ_FAILED")
    }
    return path
  }
  async persistDraft(owner: string, sessionId: string, draftId: string): Promise<PersistedAvatar> {
    const session = this.session(owner, sessionId); const draft = session.draft
    if (!draft || draft.id !== draftId) error("DRAFT_UNAVAILABLE")
    const current = () => { if (this.session(owner, sessionId) !== session) error("CANCELLED"); if (session.draft !== draft) error("DRAFT_UNAVAILABLE") }
    if (draft.writing) return draft.writing
    const assetId = draft.assetId ??= randomUUID()
    const work = async () => {
      let temporary = ""; let ownsTemporary = false
      try {
        current(); const dir = (await this.directory(true))!; current()
        temporary = join(dir, `.${randomUUID()}.tmp`)
        const handle = await open(temporary, "wx", 0o600); ownsTemporary = true
        try { current(); await handle.writeFile(draft.bytes); await handle.sync() } finally { await handle.close() }
        await this.options.beforeRename?.(); current()
        await rename(temporary, join(dir, `${assetId}.png`)); ownsTemporary = false
        await this.options.beforeDirectorySync?.(); current()
        // Windows cannot fs.open a directory. File data was flushed before the
        // atomic rename; crash durability still needs target-OS validation.
        if (process.platform !== "win32") { const directory = await open(dir, "r"); try { await directory.sync() } finally { await directory.close() } }
        current(); return { assetId, url: `xaanink://asset/global/${assetId}` }
      } catch (cause) { if (cause instanceof AvatarAssetError) throw cause; error("ASSET_WRITE_FAILED") }
      finally { if (ownsTemporary) await unlink(temporary).catch(() => undefined) }
    }
    const pending = draft.writing = this.options.withWrite ? this.options.withWrite(work) : work()
    try { return await pending } finally { if (draft.writing === pending) draft.writing = undefined }
  }
  cancel(owner: string, sessionId: string, draftId?: string): void {
    const key = this.key(owner, sessionId); const session = this.sessions.get(key)
    // Successful save cleanup may name its frozen draft. It must not retire a
    // newer selection that arrived after persistence or settings commit began.
    if (draftId !== undefined && session?.draft?.id !== draftId) return
    if (session) this.sessions.delete(key)
    // Cancellation can arrive before a queued save/picker handler registers
    // its session. Remember it anyway, scoped to its owner. Reserve space for
    // all live sessions; saturation blocks admission rather than reviving IDs.
    if (!this.retired.has(key)) {
      if (this.retired.size + this.sessions.size < 8192) this.retired.add(key)
      else this.admissionBlocked = true
    }
    if (session) { session.draft = undefined; session.controller.abort(new AvatarAssetError("CANCELLED")) }
  }
  cancelOwner(owner: string): void { for (const session of this.sessions.values()) if (session.owner === owner) this.cancel(owner, session.id) }
  close(): void { this.closed = true; for (const session of this.sessions.values()) this.cancel(session.owner, session.id); this.retired.clear() }
  async readAsset(assetId: string): Promise<Buffer | null> {
    if (typeof assetId !== "string" || !UUID.test(assetId)) error("INVALID_ASSET_ID")
    try {
      const dir = await this.directory(false); if (!dir) return null
      const bytes = await limitedRead(join(dir, `${assetId}.png`), new AbortController().signal, MAX_OUTPUT)
      if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) error("ASSET_READ_FAILED")
      return bytes
    } catch (cause) { if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null; error("ASSET_READ_FAILED") }
  }
}
