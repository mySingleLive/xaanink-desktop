import { Lexer, type Token } from "marked"
import { decodeHTML } from "entities"

export type ManuscriptExportFormat = "txt" | "md" | "docx" | "pdf"
export type ExportRun = { text: string; bold?: boolean; italics?: boolean; strike?: boolean }
export type ExportBlock = { runs: ExportRun[]; heading?: number; indent?: number; code?: boolean; role?: "volume" | "chapter" }
export interface NovelExportMetadata {
  title: string
  author: string
  synopsis: string
  coverUrl: string | null
}

const plainHtml = (html: string) => decodeHTML(html.replace(/<br\s*\/?\s*>/gi, "\n").replace(/<[^>]*>/g, ""))

function inline(tokens: Token[] = []): ExportRun[] {
  return tokens.flatMap((token): ExportRun[] => {
    switch (token.type) {
      case "strong": return inline(token.tokens).map(run => ({ ...run, bold: true }))
      case "em": return inline(token.tokens).map(run => ({ ...run, italics: true }))
      case "del": return inline(token.tokens).map(run => ({ ...run, strike: true }))
      case "link": return inline(token.tokens)
      case "br": return [{ text: "\n" }]
      case "html": return [{ text: plainHtml(token.text) }]
      case "codespan": return [{ text: token.text }]
      default: return "tokens" in token && token.tokens ? inline(token.tokens) : [{ text: decodeHTML("text" in token ? token.text : token.raw) }]
    }
  })
}

/** Text-only conversion: never execute HTML or fetch manuscript images/links. */
export function manuscriptBlocks(source: string): ExportBlock[] {
  const blocks = (tokens: Token[] = [], indent = 0): ExportBlock[] => tokens.flatMap((token): ExportBlock[] => {
    switch (token.type) {
      case "space": case "def": return []
      case "heading": return [{ runs: inline(token.tokens), heading: token.depth, indent }]
      case "paragraph": case "text": return [{ runs: token.tokens ? inline(token.tokens) : [{ text: token.text }], indent }]
      case "code": return [{ runs: [{ text: token.text }], code: true, indent }]
      case "blockquote": return blocks(token.tokens, indent + 1)
      case "list": return token.items.flatMap((item: { tokens: Token[]; task: boolean; checked?: boolean }, index: number) => {
        const children = blocks(item.tokens, indent + 1)
        const prefix = item.task ? (item.checked ? "[x] " : "[ ] ") : token.ordered ? `${Number(token.start) + index}. ` : "• "
        if (children[0]) children[0].runs.unshift({ text: prefix })
        return children
      })
      case "table": return [token.header, ...token.rows].map((row: { tokens: Token[] }[], index: number) => ({
        indent, runs: row.flatMap((cell, cellIndex) => [
          ...(cellIndex ? [{ text: "  |  " }] : []),
          ...inline(cell.tokens).map(run => ({ ...run, bold: index === 0 || run.bold })),
        ]),
      }))
      case "hr": return [{ runs: [{ text: "────────" }], indent }]
      case "html": return [{ runs: [{ text: plainHtml(token.text) }], indent }]
      default: return [{ runs: [{ text: token.raw }], indent }]
    }
  })
  return blocks(Lexer.lex(source, { gfm: true }))
}

export function manuscriptPlainText(source: string): string {
  return manuscriptBlocks(source).map(block => block.runs.map(run => run.text).join("")).join("\n\n")
}

/** Preserve an author's existing chapter number in both document titles and filenames. */
export function manuscriptTitle(index: number, chapterTitle: string, unit: "章" | "卷" = "章"): string {
  const title = chapterTitle.trim()
  if (new RegExp(`^第\\s*[0-9０-９零〇一二三四五六七八九十百千万萬亿億两兩壹贰貳叁參肆伍陆陸柒捌玖拾佰仟廿卅]+\\s*${unit}`, "u").test(title)) return title
  return title ? `第 ${index} ${unit} ${title}` : `第 ${index} ${unit}`
}

export function manuscriptFilename(title: string, format: ManuscriptExportFormat): string {
  // Keep filenames portable, including Windows reserved names and trailing dots.
  const cleaned = Array.from(title.replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, "_").trim()).slice(0, 80).join("").replace(/[. ]+$/g, "")
  const name = !cleaned ? "正文" : /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(cleaned) ? `正文_${cleaned}` : cleaned
  return `${name}.${format}`
}

export async function createManuscriptExport(format: ManuscriptExportFormat, title: string, source: string, blocks?: ExportBlock[], metadata?: NovelExportMetadata): Promise<Blob> {
  if (format === "md") return new Blob([source], { type: "text/markdown;charset=utf-8" })
  const documentBlocks = blocks ?? manuscriptBlocks(source)
  if (format === "txt") return new Blob(["\ufeff", documentBlocks.map(block => block.runs.map(run => run.text).join("")).join("\n\n")], { type: "text/plain;charset=utf-8" })
  const { loadExportCover } = await import("./manuscript-export-cover")
  const book = metadata ? { ...metadata, cover: await loadExportCover(metadata.coverUrl) } : undefined
  if (format === "docx") {
    const { createManuscriptDocx } = await import("./manuscript-export-docx")
    return createManuscriptDocx(title, documentBlocks, book)
  }
  const { createManuscriptPdf } = await import("./manuscript-export-pdf")
  const response = await fetch("/fonts/noto-sans-sc/NotoSansSC-Regular.ttf.gz")
  if (!response.ok || !response.body) throw new Error("PDF 中文字体加载失败，请稍后重试")
  // Inflate once: fontkit repeatedly inflates WOFF glyph tables during subsetting.
  const fontBytes = await new Response(response.body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer()
  return createManuscriptPdf(title, documentBlocks, fontBytes, book)
}

export async function downloadManuscript(blob: Blob, filename: string, options: { signal?: AbortSignal } = {}): Promise<boolean> {
  if (options.signal?.aborted) return false
  if (typeof window !== "undefined" && (window.desktop || window.location?.protocol === "xaanink:")) {
    const { saveDesktopExport } = await import("./desktop/export")
    return saveDesktopExport(blob, filename, options)
  }
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Leave time for browsers to consume the object URL, including larger PDF files.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return true
}
