import { createManuscriptExport, manuscriptBlocks, manuscriptTitle, type ExportBlock, type ManuscriptExportFormat } from "./manuscript-export"
import type { OutlineCollection } from "./outline-collection"

const markdownTitle = (text: string) => text.replace(/[\r\n]+/g, " ").replace(/([\\`*_{}\[\]<>#+.!|~\-])/g, "\\$1")

/** Parse chapters separately so a chapter's Markdown cannot consume the following chapter. */
export function collectionDocument(collection: OutlineCollection) {
  const volumes = [...collection.volumes].sort((a, b) => a.index - b.index)
  if (!volumes.length) throw new Error("暂无卷章可导出，请先添加卷或章节")
  const selected = collection.volumeId ? volumes.find(volume => volume.id === collection.volumeId) : undefined
  if (collection.volumeId && !selected) throw new Error("待导出的卷不存在")
  const scope = selected ? [selected] : volumes
  const title = [collection.title, selected && manuscriptTitle(selected.index, selected.title, "卷"), collection.kind === "content" ? "正文" : "大纲"].filter(Boolean).join(" · ")
  const blocks: ExportBlock[] = []
  const markdown: string[] = []
  const heading = (text: string, level: number) => {
    blocks.push({ runs: [{ text }], heading: level, role: level === 1 ? "volume" : "chapter" })
    markdown.push(`${"#".repeat(level + 1)} ${markdownTitle(text)}`)
  }
  const body = (source: string, depth: number) => {
    blocks.push(...manuscriptBlocks(source).map(block => ({ ...block, ...(block.heading && { heading: Math.min(6, block.heading + depth) }) })))
    // Close an unterminated fenced block before the next generated section.
    const tokens = source.match(/^ {0,3}(`{3,}|~{3,}).*$/gm) ?? []
    let fence = ""
    for (const line of tokens) {
      const match = line.trimStart().match(/^(`{3,}|~{3,})(.*)$/)!
      if (!fence) fence = match[1]
      else if (match[1][0] === fence[0] && match[1].length >= fence.length && !match[2].trim()) fence = ""
    }
    markdown.push(source + (fence ? `\n${fence}` : ""))
  }
  for (const volume of scope) {
    heading(manuscriptTitle(volume.index, volume.title, "卷"), 1)
    if (collection.kind === "outline" && volume.summary.trim()) body(volume.summary, 1)
    for (const chapter of [...volume.chapters].sort((a, b) => a.index - b.index)) {
      heading(manuscriptTitle(chapter.index, chapter.title), 2)
      body(chapter.text, 2)
    }
  }
  return { title, blocks, markdown: `# ${markdownTitle(title)}\n\n${markdown.join("\n\n")}\n` }
}

export async function createCollectionExport(format: ManuscriptExportFormat, collection: OutlineCollection) {
  const document = collectionDocument(collection)
  const blocks = format === "txt" ? [{ runs: [{ text: document.title }] }, ...document.blocks] : document.blocks
  return { title: document.title, blob: await createManuscriptExport(format, document.title, document.markdown, blocks, collection) }
}
