export interface ExportCover {
  data: Uint8Array
  width: number
  height: number
}

/** Normalize uploaded PNG/JPEG/WebP/GIF covers locally; no conversion service. */
export async function loadExportCover(url: string | null): Promise<ExportCover | undefined> {
  if (!url) return undefined
  let bitmap: ImageBitmap | undefined
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) })
    if (!response.ok) throw new Error("cover unavailable")
    const blob = await response.blob()
    if (blob.size > 10 * 1024 * 1024) throw new Error("cover too large")
    bitmap = await createImageBitmap(blob)
    const scale = Math.min(1, 1800 / bitmap.width, 2600 / bitmap.height)
    const canvas = document.createElement("canvas")
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext("2d")
    if (!context) throw new Error("canvas unavailable")
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new Error("cover encoding failed")), "image/png"))
    return { data: new Uint8Array(await png.arrayBuffer()), width: canvas.width, height: canvas.height }
  } catch {
    throw new Error("小说封面加载失败，请检查封面后重试")
  } finally { bitmap?.close() }
}
