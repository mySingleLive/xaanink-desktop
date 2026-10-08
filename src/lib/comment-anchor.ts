/**
 * 行内评论锚点工具(纯函数,服务端/客户端同构)。
 * 锚点 = quote(原文照抄) + startOffset/endOffset(创建时偏移) + prefix/suffix(前后文)。
 * 文本变动后先校验偏移,偏移失配则按 quote + 前后文打分重定位;仍失败视为孤儿评论。
 */

export interface AnchorLike {
  quote: string | null
  prefix?: string | null
  suffix?: string | null
  startOffset?: number | null
  endOffset?: number | null
}

export interface TextAnchor {
  start: number
  end: number
}

/** 重定位时截取的前后文长度 */
export const ANCHOR_CONTEXT_LEN = 32

/** a 与 b 的最长公共前缀长度 */
function commonPrefixLen(a: string, b: string): number {
  const n = Math.min(a.length, b.length)
  let i = 0
  while (i < n && a[i] === b[i]) i++
  return i
}

/** a 与 b 的最长公共后缀长度 */
function commonSuffixLen(a: string, b: string): number {
  const n = Math.min(a.length, b.length)
  let i = 0
  while (i < n && a[a.length - 1 - i] === b[b.length - 1 - i]) i++
  return i
}

/**
 * 在 text 中定位 quote。多处出现时按 prefix/suffix 匹配度打分取最优(并列取首个)。
 * 找不到返回 null。
 */
export function locateQuote(
  text: string,
  quote: string,
  prefix?: string | null,
  suffix?: string | null
): TextAnchor | null {
  if (!quote) return null
  let best: TextAnchor | null = null
  let bestScore = -1
  let from = 0
  for (;;) {
    const idx = text.indexOf(quote, from)
    if (idx === -1) break
    let score = 0
    if (prefix) {
      score += commonSuffixLen(prefix, text.slice(Math.max(0, idx - prefix.length), idx))
    }
    if (suffix) {
      const after = idx + quote.length
      score += commonPrefixLen(suffix, text.slice(after, after + suffix.length))
    }
    if (score > bestScore) {
      bestScore = score
      best = { start: idx, end: idx + quote.length }
    }
    from = idx + 1
  }
  return best
}

/**
 * 解析评论在当前文本中的锚点:
 * 1) 偏移处文本与 quote 一致 → 直接用偏移;
 * 2) 否则 locateQuote 重定位;
 * 3) 失败 → null(孤儿评论)。
 */
export function resolveAnchor(value: string, anchor: AnchorLike): TextAnchor | null {
  const { quote, prefix, suffix, startOffset, endOffset } = anchor
  if (!quote) return null
  if (
    typeof startOffset === "number" &&
    typeof endOffset === "number" &&
    startOffset >= 0 &&
    endOffset <= value.length &&
    startOffset < endOffset &&
    value.slice(startOffset, endOffset) === quote
  ) {
    return { start: startOffset, end: endOffset }
  }
  return locateQuote(value, quote, prefix, suffix)
}

export type WriteAnchor =
  | ({ kind: "exact" | "relocatedUnique" } & TextAnchor)
  | { kind: "ambiguous" | "missing" }

/** 写入定位与展示分离。只有已验证基线才信任旧偏移；重复句要求足够且唯一的完整上下文。 */
export function resolveWriteAnchor(text: string, anchor: AnchorLike, baselineMatches = false): WriteAnchor {
  const { quote, prefix, suffix, startOffset, endOffset } = anchor
  if (!quote) return { kind: "missing" }
  if (baselineMatches && typeof startOffset === "number" && typeof endOffset === "number" && startOffset >= 0 && endOffset <= text.length && text.slice(startOffset, endOffset) === quote) {
    return { kind: "exact", start: startOffset, end: endOffset }
  }
  const matches: TextAnchor[] = []
  for (let from = 0; from <= text.length;) {
    const start = text.indexOf(quote, from)
    if (start < 0) break
    matches.push({ start, end: start + quote.length }); from = start + 1
  }
  if (matches.length === 0) return { kind: "missing" }
  if (matches.length === 1) return { kind: "relocatedUnique", ...matches[0] }
  if ((prefix?.length ?? 0) + (suffix?.length ?? 0) < 8) return { kind: "ambiguous" }
  const contextual = matches.filter(({ start, end }) =>
    (!prefix || text.slice(Math.max(0, start - prefix.length), start) === prefix) &&
    (!suffix || text.slice(end, end + suffix.length) === suffix))
  return contextual.length === 1 ? { kind: "relocatedUnique", ...contextual[0] } : { kind: "ambiguous" }
}

/** 摘取锚点前后文(创建评论时调用) */
export function anchorContext(
  text: string,
  start: number,
  end: number
): { prefix: string; suffix: string } {
  return {
    prefix: text.slice(Math.max(0, start - ANCHOR_CONTEXT_LEN), start),
    suffix: text.slice(end, end + ANCHOR_CONTEXT_LEN),
  }
}

export interface MarkdownBlock {
  /** 块首字符在 source 中的偏移 */
  start: number
  /** 块末字符之后的位置(exclusive) */
  end: number
  text: string
}

const FENCE_RE = /^\s*(```|~~~)/

/**
 * 把 markdown 源按空行切成顶层块,记录每块在源文中的偏移。
 * 围栏代码块内的空行不切分。用于预览态分块渲染与评论气泡插入。
 */
export function splitMarkdownBlocks(source: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = []
  let offset = 0
  let blockStart = -1
  let blockEnd = -1
  let inFence = false

  const flush = () => {
    if (blockStart >= 0) {
      blocks.push({ start: blockStart, end: blockEnd, text: source.slice(blockStart, blockEnd) })
      blockStart = -1
      blockEnd = -1
    }
  }

  for (const line of source.split("\n")) {
    const lineStart = offset
    const lineEnd = offset + line.length
    offset = lineEnd + 1 // + "\n"

    if (FENCE_RE.test(line)) inFence = !inFence

    if (!inFence && line.trim() === "") {
      flush()
      continue
    }
    if (blockStart < 0) blockStart = lineStart
    blockEnd = lineEnd
  }
  flush()
  return blocks
}

/** 找到包含 offset 的块下标;落在块间空白时归到前一个块;找不到返回 -1 */
export function blockIndexAt(blocks: MarkdownBlock[], offset: number): number {
  let prev = -1
  for (let i = 0; i < blocks.length; i++) {
    if (offset < blocks[i].start) return prev
    if (offset < blocks[i].end) return i
    prev = i
  }
  return prev
}
