import { z } from "zod"

export const MAX_EXPORT_BYTES = 32 * 1024 * 1024
export const MAX_TEMPLATE_EXPORT_BYTES = 4 * 1024 * 1024
export type FileExportFormat = "txt" | "md" | "docx" | "pdf" | "templates" | "recovery"
export const exportExtensions: Record<FileExportFormat, string> = { txt: "txt", md: "md", docx: "docx", pdf: "pdf", templates: "json", recovery: "json" }
export const fileExportRequestSchema = z.object({
  id: z.uuid(), format: z.enum(["txt", "md", "docx", "pdf", "templates", "recovery"]),
  filename: z.string().min(1).max(160).refine(name => !/[<>:"/\\|?*\x00-\x1f\x7f]/.test(name) && !/^[.]|[. ]$/.test(name) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)),
  bytes: z.instanceof(Uint8Array).refine(bytes => bytes.byteLength <= MAX_EXPORT_BYTES),
}).strict().superRefine((request, context) => {
  if (!request.filename.endsWith(`.${exportExtensions[request.format]}`)) context.addIssue({ code: "custom", message: "导出格式与文件名不符" })
  if (request.format === "templates" && request.bytes.byteLength > MAX_TEMPLATE_EXPORT_BYTES) context.addIssue({ code: "custom", message: "模板导出超过4MiB" })
})
export type FileExportRequest = z.infer<typeof fileExportRequestSchema>
export type FileExportFailure = "EXPORT_INPUT_INVALID" | "EXPORT_BUSY" | "EXPORT_REPLAY" | "EXPORT_TARGET_INVALID" | "EXPORT_TARGET_CHANGED" | "EXPORT_TARGET_PROTECTED" | "EXPORT_WRITE_FAILED" | "EXPORT_DURABILITY_UNCONFIRMED"
export type FileExportResult =
  | { id: string; status: "saved"; bytesWritten: number; sha256: string }
  | { id: string | null; status: "cancelled" }
  | { id: string | null; status: "failed"; code: FileExportFailure }
export interface FileExportBridge {
  exportFile(request: FileExportRequest): Promise<FileExportResult>
  cancelFileExport(id: string): Promise<void>
}

export const fileExportFailureMessages = {
  EXPORT_INPUT_INVALID: "导出文件格式无效或超过大小限制",
  EXPORT_BUSY: "已有文件正在保存，请稍后重试",
  EXPORT_REPLAY: "导出请求已处理，请重新导出",
  EXPORT_TARGET_INVALID: "请选择同格式的普通文件",
  EXPORT_TARGET_CHANGED: "所选文件或目录已变化，请重新选择",
  EXPORT_TARGET_PROTECTED: "不能覆盖应用内部数据，请选择其它文件",
  EXPORT_WRITE_FAILED: "本地文件保存失败，请重新选择位置",
  EXPORT_DURABILITY_UNCONFIRMED: "无法确认保存完成，请检查所选文件后再导出",
} as const
