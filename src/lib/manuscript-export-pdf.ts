import { PDFDocument, rgb, setTextRenderingMode, TextRenderingMode, setLineWidth, setStrokingColor,
  pushGraphicsState, popGraphicsState, beginText, endText, setFontAndSize, setCharacterSpacing,
  setFillingColor, showText, rotateAndSkewTextDegreesAndTranslate, type PDFPage, type PDFName } from "pdf-lib"
import fontkit from "@pdf-lib/fontkit"
import type { ExportBlock, ExportRun } from "./manuscript-export"
import { coverPlacement, readingBlocks, readingStyle, readingText, READING_THEME as theme, type ExportBook } from "./manuscript-export-layout"

const color = (hex: string) => rgb(parseInt(hex.slice(0, 2), 16) / 255, parseInt(hex.slice(2, 4), 16) / 255, parseInt(hex.slice(4, 6), 16) / 255)
type Glyph = ExportRun & { text: string; width: number }
const noStart = /^[，。！？；：、）》」』】〕〉”’…,.!?;:%）\]}]$/u
const noEnd = /^[（《「『【〔〈“‘(\[{]$/u
const word = /^[a-zA-Z0-9]$/

/** A4 with selectable CJK text, real cover images and book-like pagination. */
export async function createManuscriptPdf(title: string, blocks: ExportBlock[], fontBytes: ArrayBuffer | Uint8Array, book?: ExportBook): Promise<Blob> {
  const document = await PDFDocument.create()
  document.registerFontkit(fontkit)
  document.setTitle(book?.title ?? title)
  document.setAuthor(book?.author ?? "")
  document.setCreator("玄印写作")
  const font = await document.embedFont(fontBytes, { subset: true })
  const charset = new Set(font.getCharacterSet())
  const allBlocks = readingBlocks(title, blocks, book)
  const unsupported = Array.from(new Set(Array.from(allBlocks.map(readingText).join(""))
    .filter(char => !/\s/.test(char) && !charset.has(char.codePointAt(0)!))))
  if (unsupported.length) throw new Error(`PDF 字体暂不支持「${unsupported.slice(0, 5).join("")}」，请使用 Word 或 Markdown 导出以保留原文`)
  const { width, height, margin, bottom } = theme
  const fontKeys = new Map<PDFPage, PDFName>()
  const addPage = () => {
    const page = document.addPage([width, height])
    fontKeys.set(page, page.node.newFontDictionary("ReadingFont", font.ref))
    page.drawRectangle({ x: 0, y: 0, width, height, color: color(theme.paper) })
    return page
  }
  if (book?.cover) {
    const image = await document.embedPng(book.cover.data)
    addPage().drawImage(image, coverPlacement(book.cover))
  }
  let page = addPage(), y = height - theme.top, inBody = !book
  const bodyPages: PDFPage[] = inBody ? [page] : []
  const newPage = () => { page = addPage(); y = height - theme.top; if (inBody) bodyPages.push(page) }
  const widths = new Map<string, number>()
  const charWidth = (char: string) => {
    if (!widths.has(char)) widths.set(char, font.widthOfTextAtSize(char, 1))
    return widths.get(char)!
  }
  for (const [blockIndex, block] of allBlocks.entries()) {
    const style = readingStyle(block)
    if (block.pageBreakBefore) { inBody = true; newPage() }
    const left = margin + Math.min(block.indent ?? 0, 8) * 18
    const available = width - margin - left
    const indent = block.style === "body" && !block.code && !block.indent && !/^\s/u.test(readingText(block)) ? style.size * 2 : 0
    const paragraphs: Glyph[][] = [[]]
    for (const run of block.runs) for (const char of Array.from(run.text.replace(/\r\n?/g, "\n").replace(/\t/g, "    "))) {
      if (char === "\n") paragraphs.push([])
      else paragraphs.at(-1)!.push({ ...run, text: char, width: charWidth(char) * style.size })
    }
    const lines: { glyphs: Glyph[]; inset: number; last: boolean }[] = []
    for (const chars of paragraphs) {
      let start = 0, first = true
      do {
        const inset = first ? indent : 0
        let end = start, used = 0
        while (end < chars.length && (end === start || used + chars[end].width <= available - inset)) used += chars[end++].width
        if (end < chars.length) {
          // Move closing punctuation with the preceding character, and keep
          // opening brackets/ordinary Latin words with the following line.
          while (end > start + 1 && (noStart.test(chars[end].text) || noEnd.test(chars[end - 1].text))) end--
          if (word.test(chars[end]?.text ?? "") && word.test(chars[end - 1]?.text ?? "")) {
            let boundary = end
            while (boundary > start && word.test(chars[boundary - 1].text)) boundary--
            if (boundary > start) end = boundary
          }
        }
        lines.push({ glyphs: chars.slice(start, end), inset, last: end === chars.length })
        start = end; first = false
      } while (start < chars.length)
    }
    const next = allBlocks[blockIndex + 1]
    const keepNext = style.bold && next && !next.pageBreakBefore ? readingStyle(next).line * 2 : 0
    if (y < height - theme.top && y - style.before - Math.min(lines.length, 2) * style.line - style.after - keepNext < bottom) newPage()
    y -= style.before
    for (let index = 0; index < lines.length;) {
      let fit = Math.floor((y - bottom) / style.line)
      if (fit < 1) { newPage(); continue }
      if (lines.length - index > fit && lines.length - index - fit === 1 && fit > 1) fit--
      for (let count = 0; count < fit && index < lines.length; count++, index++) {
        const line = lines[index]
        const used = line.glyphs.reduce((sum, glyph) => sum + glyph.width, 0)
        const justify = block.style === "body" && !block.code && !line.last && line.glyphs.some(glyph => /\p{Script=Han}/u.test(glyph.text))
        const gap = justify && line.glyphs.length > 1 ? (available - line.inset - used) / (line.glyphs.length - 1) : 0
        let x = style.center ? (width - used) / 2 : left + line.inset
        // PDF character spacing justifies a whole styled run. One text object
        // per glyph would make full-novel exports unnecessarily expensive.
        for (let i = 0; i < line.glyphs.length;) {
          const first = line.glyphs[i]
          let end = i + 1, text = first.text, advance = first.width
          while (end < line.glyphs.length && line.glyphs[end].bold === first.bold && line.glyphs[end].italics === first.italics && line.glyphs[end].strike === first.strike) {
            text += line.glyphs[end].text; advance += line.glyphs[end++].width
          }
          const ink = color(style.color)
          page.pushOperators(pushGraphicsState(), beginText(), setFontAndSize(fontKeys.get(page)!, style.size),
            setFillingColor(ink), setStrokingColor(ink), setLineWidth(0.2), setCharacterSpacing(gap),
            setTextRenderingMode(first.bold || style.bold ? TextRenderingMode.FillAndOutline : TextRenderingMode.Fill),
            rotateAndSkewTextDegreesAndTranslate(0, first.italics ? 10 : 0, 0, x, y - style.size),
            showText(font.encodeText(text)), endText(), popGraphicsState())
          if (first.strike) page.drawLine({ start: { x, y: y - style.size * 0.65 }, end: { x: x + advance + gap * (end - i - 1), y: y - style.size * 0.65 }, thickness: 0.6, color: ink })
          x += advance + gap * (end - i); i = end
        }
        y -= style.line
      }
      if (index < lines.length) newPage()
    }
    y -= style.after
  }
  bodyPages.forEach((page, index) => {
    const label = String(index + 1)
    page.drawText(label, { x: (width - font.widthOfTextAtSize(label, 9)) / 2, y: 32, size: 9, font, color: color(theme.muted) })
  })
  return new Blob([new Uint8Array(await document.save())], { type: "application/pdf" })
}
