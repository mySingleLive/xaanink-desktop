import { manuscriptBlocks, type ExportBlock, type NovelExportMetadata } from "./manuscript-export"
import type { ExportCover } from "./manuscript-export-cover"

export type ExportBook = Omit<NovelExportMetadata, "coverUrl"> & { cover?: ExportCover }
export type ReadingBlock = ExportBlock & {
  style: "title" | "author" | "label" | "chapter" | "heading" | "body"
  pageBreakBefore?: boolean
}

// Qidian's current reading surface: rgb(245, 241, 232), independent of editor theme.
export const READING_THEME = {
  paper: "F5F1E8", text: "302C26", muted: "82796B",
  width: 595.3, height: 841.9, margin: 72, top: 72, bottom: 64,
  bodySize: 12, lineHeight: 23, paragraphAfter: 9,
} as const

export const readingText = (block: ExportBlock) => block.runs.map(run => run.text).join("")

/** Generated volume labels are omitted without removing anything the author wrote. */
export function readingBlocks(title: string, blocks: ExportBlock[], book?: ExportBook): ReadingBlock[] {
  const isCollection = blocks.some(block => block.role)
  const body = (isCollection ? blocks : [{ runs: [{ text: title }], role: "chapter" as const }, ...blocks])
    .filter(block => block.role !== "volume")
    .map((block): ReadingBlock => ({ ...block,
      style: block.role === "chapter" ? "chapter" : block.heading ? "heading" : "body",
      pageBreakBefore: block.role === "chapter",
    }))
  if (!book) return body.map((block, index) => ({ ...block, pageBreakBefore: index > 0 && block.pageBreakBefore }))
  return [
    { runs: [{ text: book.title }], style: "title" },
    { runs: [{ text: `${book.author.trim() || "佚名"} 著` }], style: "author" },
    { runs: [{ text: "内容简介" }], style: "label" },
    ...manuscriptBlocks(book.synopsis.trim() || "暂无简介").map((block): ReadingBlock => ({ ...block, style: block.heading ? "heading" : "body" })),
    ...body.map((block, index) => ({ ...block, pageBreakBefore: index === 0 || block.pageBreakBefore })),
  ]
}

export function readingStyle(block: ReadingBlock) {
  const base = { size: READING_THEME.bodySize as number, line: READING_THEME.lineHeight as number, before: 0, after: READING_THEME.paragraphAfter as number, center: false, bold: false, color: READING_THEME.text as string }
  switch (block.style) {
    case "title": return { ...base, size: 30, line: 45, before: 78, after: 24, center: true, bold: true, color: "000000" }
    case "author": return { ...base, size: 12, line: 22, after: 54, center: true, color: READING_THEME.muted }
    case "label": return { ...base, size: 12, line: 24, after: 20, center: true, bold: true, color: "000000" }
    case "chapter": return { ...base, size: 22, line: 34, after: 32, center: true, bold: true, color: "000000" }
    case "heading": return { ...base, size: Math.max(12, 18 - (block.heading ?? 1)), line: 27, before: 12, after: 12, bold: true, color: "000000" }
    default: return { ...base, ...(block.code && { size: 10.5, line: 19 }) }
  }
}

export function coverPlacement(cover: ExportCover) {
  const scale = Math.min(READING_THEME.width / cover.width, READING_THEME.height / cover.height)
  const width = cover.width * scale, height = cover.height * scale
  return { width, height, x: (READING_THEME.width - width) / 2, y: (READING_THEME.height - height) / 2 }
}
