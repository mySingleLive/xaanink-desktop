import { splitMarkdownBlocks, type TextAnchor } from "./comment-anchor"
import { resolveReferenceAnchor } from "./foreshadow-reference"

export interface TouchReferenceEvidence {
  summary: string
  foreshadowTitle?: string
  foreshadowContent?: string
}

const segmenter = new Intl.Segmenter("zh-CN", { granularity: "word" })
// 叙事功能词不构成伏笔证据；不能仅因人称、时间或“发现/没有”就标注整段。
const STOP_WORDS = new Set("自己 他们 她们 我们 这个 那个 这里 那里 此刻 此时 当时 现在 之前 之后 里面 外面 当中 一个 一次 一下 一些 只有 没有 不是 不能 不会 不再 仍然 已经 依然 开始 继续 发现 知道 看见 看到 想起 觉得 认为 告诉 说明 解释 结论 原因 用途 父亲 母亲 孩子 老人 众人 一起 随后 最后 第一 第二 第三 第四 本章 首章 末章".split(" "))

function terms(text: string) {
  const words = [...segmenter.segment(text.toLocaleLowerCase())]
    .filter(part => part.isWordLike)
    .map(part => part.segment)
  // 虚构名词常被分词器拆成单字（蓝盐、柜底、末横等），在功能词边界内补词片段。
  for (const run of text.split(/[的地得了是在有把被与和及将就都又只仍也而却从到给让着过为对里上下不未已无要才很个这那他她我你它们\s\p{P}\p{S}]+/u)) {
    if (!/^[\p{Script=Han}]+$/u.test(run)) continue
    for (let size = 2; size <= Math.min(8, run.length); size++) {
      for (let start = 0; start + size <= run.length; start++) words.push(run.slice(start, start + size))
    }
  }
  const filtered = words.filter(term => term.length >= 2 && !STOP_WORDS.has(term) && !/^[\d一二三四五六七八九十百千万第章节卷]+$/u.test(term))
  // 引号中的单字可以是明确的物证符号，但仍必须与同段其他证据共同命中。
  for (const match of text.matchAll(/[“「『"]([^”」』"\n]{1,20})[”」』"]/gu)) filtered.push(match[1])
  return [...new Set(filtered)]
}

function quotedSymbols(text: string) {
  return [...text.matchAll(/[“「『"]([^”」』"\n]{1,8})[”」』"]/gu)].map(match => match[1])
}

function containsSymbol(text: string, symbol: string) {
  if (symbol.length > 1) return text.includes(symbol)
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  // 单字物证须独立出现，不能把“画正字”的正匹配到“正对门”。
  return new RegExp(`(?:^|[\\s\\p{P}\\p{S}]|画|写)${escaped}(?:$|[\\s\\p{P}\\p{S}]|字)`, "u").test(text)
}

/**
 * 仅用于已登记关系、没有原文快照的触点。先匹配真实摘录，否则在段落内汇合
 * 触点摘要与档案的多项词语证据；标题/人物单独命中不足以定位。手工摘录不走此分支。
 */
export function inferTouchReferenceAnchor(text: string, evidence: TouchReferenceEvidence): TextAnchor | null {
  if (!evidence.summary.trim()) return null
  const exact = resolveReferenceAnchor(text, { quote: evidence.summary.trim() })
  if (exact) return exact

  const blocks = splitMarkdownBlocks(text).filter(block => !/^\s*(?:```|~~~|#{1,6}\s)/.test(block.text))
  const summary = new Set(terms(evidence.summary))
  const title = new Set(terms(evidence.foreshadowTitle ?? ""))
  const content = new Set(terms(evidence.foreshadowContent ?? ""))
  const vocabulary = [...new Set([...summary, ...title, ...content])]
  const plain = blocks.map(block => block.text.toLocaleLowerCase())
  const counts = new Map(vocabulary.map(term => [term, plain.filter(block => block.includes(term)).length]))
  const symbols = quotedSymbols(evidence.summary)
  const candidates = blocks.flatMap((block, index) => {
    // 同一词的长短形式只算一次，避免“十三号绳/十三号”虚增证据。
    const matched = vocabulary.filter(term => term.length === 1 ? containsSymbol(plain[index], term) : plain[index].includes(term))
    const found = matched.filter(term => !matched.some(other => other !== term && other.includes(term)))
    const summaryHits = found.filter(term => summary.has(term)).length
    if (found.length < 3 || summaryHits < 2) return []
    const weight = (term: string) => 1 + Math.log((blocks.length + 1) / ((counts.get(term) ?? 0) + 1))
    const primary = found.filter(term => summary.has(term)).reduce((sum, term) => sum + 3 * weight(term), 0)
    // 档案可能包含全书后续发展，只能佐证当前触点，不能靠堆积档案词压过本次事件。
    const support = found.filter(term => !summary.has(term)).reduce((sum, term) => sum + weight(term), 0)
    const score = primary + Math.min(2, support) + (found.some(term => title.has(term)) ? 2 : 0)
    if (score < 12) return []
    return [{ start: block.start, end: block.end, score, symbol: symbols.some(symbol => containsSymbol(block.text, symbol)) }]
  }).sort((a, b) => b.score - a.score)
  // 摘要点名了字样且正文确有该字样时，优先定位该描写，而非只出现同一物件的另一段。
  const supported = candidates.some(candidate => candidate.symbol) ? candidates.filter(candidate => candidate.symbol) : candidates
  const best = supported[0], next = supported[1]
  if (!best || (next && best.score - next.score < 1)) return null
  return { start: best.start, end: best.end }
}
