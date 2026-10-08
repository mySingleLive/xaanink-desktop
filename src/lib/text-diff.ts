export interface TextDiffPart { kind: "equal" | "added" | "removed"; text: string }
function paragraphs(text: string) {
  const tokens = text.split(/(\r?\n[\t ]*\r?\n)/)
  const blocks: string[] = []
  for (let i = 0; i < tokens.length; i += 2) {
    const block = tokens[i] + (tokens[i + 1] ?? "")
    if (block) blocks.push(block)
  }
  return blocks
}
/** 保留原始换行/Unicode；大段数降为整块对比，避免浏览器二次方内存增长。 */
export function paragraphDiff(before: string, after: string): TextDiffPart[] {
  if (before === after) return before ? [{ kind: "equal", text: before }] : []
  const a = paragraphs(before), b = paragraphs(after)
  if ((a.length + 1) * (b.length + 1) > 250000) return [{ kind: "removed", text: before }, { kind: "added", text: after }]
  const rows = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1))
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) rows[i][j] = a[i] === b[j] ? 1 + rows[i + 1][j + 1] : Math.max(rows[i + 1][j], rows[i][j + 1])
  let i = 0, j = 0
  const result: TextDiffPart[] = []
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { result.push({ kind: "equal", text: a[i++] }); j++ }
    else if (i < a.length && (j === b.length || rows[i + 1][j] >= rows[i][j + 1])) result.push({ kind: "removed", text: a[i++] })
    else result.push({ kind: "added", text: b[j++] })
  }
  return result
}
