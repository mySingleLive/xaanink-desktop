import { fileExportRequestSchema, fileExportFailureMessages as failures, MAX_EXPORT_BYTES, MAX_TEMPLATE_EXPORT_BYTES, type FileExportBridge, type FileExportFormat, type FileExportResult } from "@desktop/shared/file-export"
export interface DesktopExportOptions { signal?: AbortSignal; bridge?: FileExportBridge }
const pending = new WeakMap<FileExportBridge, symbol>()
class Cancelled extends Error {}

export function desktopExportBridge(): FileExportBridge | undefined {
  const current = typeof window === "undefined" ? undefined : window.desktop
  if (!current) return undefined
  const candidate = current as typeof current & Partial<FileExportBridge>
  if (typeof candidate.exportFile !== "function" || typeof candidate.cancelFileExport !== "function") throw Error("桌面保存功能尚未就绪")
  return candidate as FileExportBridge
}
export async function saveDesktopExport(blob: Blob, filename: string, options: DesktopExportOptions = {}): Promise<boolean> {
  if (options.signal?.aborted) return false
  const bridge = options.bridge ?? desktopExportBridge()
  const owner = typeof window === "undefined" ? undefined : window.desktop
  if (!bridge) throw Error("桌面保存功能尚未就绪")
  if (pending.has(bridge)) throw Error("已有文件正在保存，请稍后重试")
  const format: FileExportFormat | undefined = filename.endsWith(".json") ? "templates" : (["txt", "md", "docx", "pdf"] as const).find(format => filename.endsWith(`.${format}`))
  if (!format) throw Error("导出文件格式无效")
  if (blob.size > (format === "templates" ? MAX_TEMPLATE_EXPORT_BYTES : MAX_EXPORT_BYTES)) throw Error(format === "templates" ? "模板导出超过4MiB" : "导出文件超过32MiB")
  const token = Symbol(), id = crypto.randomUUID(), stopped = Promise.withResolvers<never>(); let sent = false
  void stopped.promise.catch(() => {})
  const abort = () => { stopped.reject(new Cancelled()); if (sent) void bridge.cancelFileExport(id).catch(() => {}) }
  const active = () => {
    if (options.signal?.aborted || pending.get(bridge) !== token || (!options.bridge && typeof window !== "undefined" && window.desktop !== owner)) throw new Cancelled()
  }
  pending.set(bridge, token); options.signal?.addEventListener("abort", abort, { once: true })
  try {
    const buffer = await Promise.race([blob.arrayBuffer(), stopped.promise]); active()
    const request = fileExportRequestSchema.safeParse({ id, filename, format, bytes: new Uint8Array(buffer) })
    if (!request.success) throw Error("导出文件名或格式无效")
    sent = true
    let result: FileExportResult
    try { result = await Promise.race([bridge.exportFile(request.data), stopped.promise]) } catch (error) { if (error instanceof Cancelled) throw error; throw Error("本地文件保存失败，请重试") }
    active()
    if (!result || result.id !== id) throw Error("保存回执无效，请检查所选文件")
    if (result.status === "cancelled") return false
    if (result.status === "failed") throw Error(Object.hasOwn(failures, result.code) ? failures[result.code] : "本地文件保存失败，请重试")
    if (result.status !== "saved" || result.bytesWritten !== request.data.bytes.length || !/^[a-f0-9]{64}$/.test(result.sha256)) throw Error("保存回执无效，请检查所选文件")
    return true
  } catch (error) { if (error instanceof Cancelled) return false; throw error }
  finally { options.signal?.removeEventListener("abort", abort); if (pending.get(bridge) === token) pending.delete(bridge) }
}
