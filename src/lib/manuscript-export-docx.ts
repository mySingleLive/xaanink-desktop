import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Footer, Header, PageNumber, ImageRun, SectionType, LineRuleType, type ISectionOptions } from "docx"
import type { ExportBlock } from "./manuscript-export"
import { coverPlacement, readingBlocks, readingStyle, readingText, READING_THEME as theme, type ExportBook, type ReadingBlock } from "./manuscript-export-layout"

// A page-sized header drawing prints the paper color even when Word's optional
// "Print background colors" setting is off. This single pixel is lossless RGB.
const paperPixel = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4+vEFAAWtAs+P9YeZAAAAAElFTkSuQmCC"
const font = { ascii: "Georgia", hAnsi: "Georgia", eastAsia: "宋体" }
const page = {
  size: { width: Math.round(theme.width * 20), height: Math.round(theme.height * 20) },
  margin: { top: theme.top * 20, bottom: theme.bottom * 20, left: theme.margin * 20, right: theme.margin * 20, header: 0, footer: 640 },
}
const paper = () => new Header({ children: [new Paragraph({ spacing: { before: 0, after: 0 }, children: [new ImageRun({
  type: "png", data: paperPixel,
  transformation: { width: theme.width * 4 / 3, height: theme.height * 4 / 3 },
  floating: { horizontalPosition: { relative: "page", offset: 0 }, verticalPosition: { relative: "page", offset: 0 }, behindDocument: true, allowOverlap: true, lockAnchor: true },
  altText: { name: "淡黄纸色", title: "", description: "" },
})] })] })

function paragraph(block: ReadingBlock, firstInSection: boolean) {
  const style = readingStyle(block)
  const heading = block.style === "chapter" ? HeadingLevel.HEADING_1 : block.style === "heading"
    ? [HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6][Math.min(4, (block.heading ?? 1) - 1)]
    : block.style === "title" ? HeadingLevel.TITLE : undefined
  return new Paragraph({
    heading,
    alignment: style.center ? AlignmentType.CENTER : block.code ? AlignmentType.LEFT : AlignmentType.JUSTIFIED,
    pageBreakBefore: !firstInSection && block.pageBreakBefore,
    keepNext: ["title", "label", "chapter", "heading"].includes(block.style), widowControl: true,
    indent: { left: Math.min(block.indent ?? 0, 8) * 360,
      firstLine: block.style === "body" && !block.code && !block.indent && !/^\s/u.test(readingText(block)) ? style.size * 40 : 0 },
    spacing: { before: style.before * 20, after: style.after * 20, line: style.line * 20, lineRule: LineRuleType.EXACT },
    children: block.runs.flatMap(run => run.text.split(/\r\n?|\n/).map((text, index) => new TextRun({
      text, break: index ? 1 : undefined, bold: style.bold || run.bold, italics: run.italics, strike: run.strike,
      color: style.color, size: style.size * 2, font: block.code ? { ...font, ascii: "Consolas", hAnsi: "Consolas" } : font,
    }))),
  })
}

export function createManuscriptDocx(title: string, blocks: ExportBlock[], book?: ExportBook): Promise<Blob> {
  const content = readingBlocks(title, blocks, book)
  const sections: ISectionOptions[] = []
  if (book?.cover) {
    const cover = book.cover, placement = coverPlacement(cover)
    sections.push({ properties: { page, type: SectionType.NEXT_PAGE }, headers: { default: paper() },
      footers: { default: new Footer({ children: [] }) },
      children: [new Paragraph({ spacing: { before: 0, after: 0, line: 20, lineRule: LineRuleType.EXACT }, children: [new ImageRun({
        type: "png", data: cover.data, transformation: { width: placement.width * 4 / 3, height: placement.height * 4 / 3 },
        floating: { horizontalPosition: { relative: "page", offset: Math.round(placement.x * 12700) }, verticalPosition: { relative: "page", offset: Math.round(placement.y * 12700) }, allowOverlap: true },
        altText: { name: "小说封面", title: book.title, description: "小说封面" },
      })] })],
    })
  }
  const bodyStart = book ? content.findIndex(block => block.pageBreakBefore) : 0
  if (book) sections.push({ properties: { page, type: SectionType.NEXT_PAGE }, headers: { default: paper() },
    footers: { default: new Footer({ children: [] }) },
    children: content.slice(0, bodyStart < 0 ? undefined : bodyStart).map((block, index) => paragraph(block, index === 0)),
  })
  if (bodyStart >= 0) sections.push({
    properties: { page: { ...page, pageNumbers: { start: 1 } }, type: SectionType.NEXT_PAGE },
    headers: { default: paper() },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 0 },
      children: [new TextRun({ children: [PageNumber.CURRENT], font, size: 18, color: theme.muted })] })] }) },
    children: content.slice(bodyStart).map((block, index) => paragraph(block, index === 0)),
  })
  return Packer.toBlob(new Document({
    title: book?.title ?? title, creator: book?.author || "玄印写作", background: { color: theme.paper },
    styles: { default: {
      document: { run: { font, size: theme.bodySize * 2, color: theme.text } },
      title: { run: { font, color: "000000" } },
      ...Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`heading${i + 1}`, { run: { font, color: "000000" } }])),
    } }, sections,
  }))
}
