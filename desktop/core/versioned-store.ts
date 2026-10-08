import { randomUUID } from "node:crypto"
import { open, readFile, rename, unlink } from "node:fs/promises"
import { dirname, join } from "node:path"

export interface Snapshot<T> { revision: number; value: T }
export class RevisionConflict extends Error { constructor() { super("设置已变更，请重新读取后保存"); this.name = "RevisionConflict" } }
export interface StoreOptions { beforeRename?: () => Promise<void>; beforeDirectorySync?: () => Promise<void>; withWrite?: <T>(run: () => Promise<T>) => Promise<T> }
export class CommitDurabilityError extends Error {
  readonly committed = true
  constructor(cause: unknown) { super("设置已替换，但无法确认目录同步，请重新读取并重试", { cause }) }
}

async function syncDirectory(directory: string) {
  // Windows does not support opening a directory with fs.open. The flushed file
  // is still atomically replaced there; Windows crash durability is tested on OS.
  if (process.platform === "win32") return
  const handle = await open(directory, "r")
  try { await handle.sync() } finally { await handle.close() }
}

export async function atomicWrite(path: string, content: string, options: StoreOptions = {}): Promise<void> {
  if (options.withWrite) {
    const { withWrite, ...writeOptions } = options
    return withWrite(() => atomicWrite(path, content, writeOptions))
  }
  const temporary = join(dirname(path), `.${randomUUID()}.tmp`)
  let committed = false
  let ownsTemporary = false
  try {
    const handle = await open(temporary, "wx", 0o600)
    ownsTemporary = true
    try { await handle.writeFile(content, "utf8"); await handle.sync() } finally { await handle.close() }
    await options.beforeRename?.()
    await rename(temporary, path)
    committed = true
    try { await options.beforeDirectorySync?.(); await syncDirectory(dirname(path)) } catch (cause) { throw new CommitDurabilityError(cause) }
  } finally {
    if (ownsTemporary && !committed) await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error })
  }
}

/** One main-process owner per file; the App/root lock protects cross-process use. */
export class VersionedStore<T> {
  private queue: Promise<unknown> = Promise.resolve()
  private readonly defaults: T
  constructor(readonly path: string, defaults: T, readonly validate: (value: unknown) => T, readonly options: StoreOptions = {}) {
    this.defaults = structuredClone(validate(defaults))
  }
  private enqueue<R>(run: () => Promise<R>): Promise<R> {
    const result = this.queue.then(run)
    this.queue = result.catch(() => undefined)
    return result
  }
  private async readDisk(): Promise<Snapshot<T>> {
    let text: string
    try { text = await readFile(this.path, "utf8") }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { revision: 0, value: structuredClone(this.defaults) }
      throw error
    }
    const row: unknown = JSON.parse(text)
    if (!row || typeof row !== "object" || !("schemaVersion" in row) || row.schemaVersion !== 1 ||
      !("revision" in row) || !Number.isSafeInteger(row.revision) || (row.revision as number) < 0 || !("value" in row)) {
      throw new Error("设置格式或版本不可识别，原文件已保留")
    }
    return { revision: row.revision as number, value: this.validate(row.value) }
  }
  async read(): Promise<Snapshot<T>> { return this.enqueue(() => this.readDisk()) }
  async update(revision: number, value: T, beforeCommit?: () => void): Promise<Snapshot<T>> {
    const validated = structuredClone(this.validate(value))
    return this.enqueue(async () => {
      const before = await this.readDisk()
      if (!Number.isSafeInteger(revision) || before.revision !== revision || revision >= Number.MAX_SAFE_INTEGER) throw new RevisionConflict()
      const next = { revision: revision + 1, value: validated }
      await atomicWrite(this.path, JSON.stringify({ schemaVersion: 1, ...next }) + "\n", { ...this.options, beforeRename: async()=>{await this.options.beforeRename?.();beforeCommit?.()} })
      return structuredClone(next)
    })
  }
}
