/** 书名留空时的兜底命名：未命名作品 / 未命名作品 2 / 未命名作品 3 … */
export function fallbackTitle(novels: { id: string; title: string }[]): string {
  let max = 0
  for (const n of novels) {
    const m = /^未命名作品(?: (\d+))?$/.exec(n.title.trim())
    if (m) max = Math.max(max, m[1] ? Number(m[1]) : 1)
  }
  return max === 0 ? "未命名作品" : `未命名作品 ${max + 1}`
}
