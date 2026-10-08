import type { StoryArtifact } from "@/lib/story-workflow"

/**
 * 单章任务沿依赖图取得了实际卡片/事件后，容器不再重复展开整条规划。
 * 不改原图、不截断事实；普通评审仍可读取完整容器。
 */
export function chapterTaskSourceText(source: StoryArtifact, sources: StoryArtifact[]): string {
  if (source.kind !== "narrative" && source.kind !== "worldline") return source.text
  let value: unknown
  try { value = JSON.parse(source.text) } catch { return source.text }
  if (!value || typeof value !== "object" || Array.isArray(value)) return source.text
  const container = value as Record<string, unknown>
  if (source.kind === "narrative") {
    if (!Array.isArray(container.cards)) return source.text
    if (container.cards.some(card => !card || typeof card !== "object" || Array.isArray(card) || typeof (card as { id?: unknown }).id !== "string")) return source.text
    const ids = new Set(sources.filter(item => item.kind === "narrative-card").map(item => item.id))
    return JSON.stringify({ ...container, cards: container.cards.filter(card => card && typeof card === "object" && ids.has((card as { id?: string }).id ?? "")) })
  }
  if (!Array.isArray(container.events)) return source.text
  const events = container.events as Array<Record<string, unknown>>
  if (events.some(event => !event || typeof event !== "object" || Array.isArray(event) || typeof event.id !== "string")) return source.text
  const ids = new Set(sources.filter(item => item.kind === "world-event" && item.id.startsWith(`${source.id}/`)).map(item => item.id.slice(source.id.length + 1)))
  const byId = new Map(events.filter(event => typeof event.id === "string").map(event => [event.id as string, event]))
  // 相对时间与层级必须保留所依赖的事件，不把缺少时间锚点的片段当完整事实。
  const pending = [...ids]
  for (let index = 0; index < pending.length; index++) {
    const event = byId.get(pending[index])
    const time = event?.time
    const anchor = time && typeof time === "object" && !Array.isArray(time) ? (time as Record<string, unknown>).anchor : null
    for (const id of [event?.parent, anchor]) if (typeof id === "string" && byId.has(id) && !ids.has(id)) { ids.add(id); pending.push(id) }
  }
  return JSON.stringify({ ...container, events: events.filter(event => typeof event.id === "string" && ids.has(event.id)) })
}
