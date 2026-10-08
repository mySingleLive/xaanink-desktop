/** Pure, iterative view of scene containment. Corrupt legacy edges are displayed, never rewritten. */
export interface SceneNode { id: string; name: string; parentId?: string | null }
export function sceneForest<T extends SceneNode>(rows: readonly T[]) {
  const byId = new Map(rows.map(row => [row.id, row]))
  const parents = new Map<string, string | null>()
  const anomalies = new Set<string>()
  for (const row of rows) {
    const seen = new Set([row.id]); let id = row.parentId; let invalid = false
    while (id) { if (seen.has(id) || !byId.has(id)) { invalid = true; break }; seen.add(id); id = byId.get(id)?.parentId }
    parents.set(row.id, invalid ? null : row.parentId ?? null)
    if (invalid) anomalies.add(row.id)
  }
  const children = new Map<string | null, T[]>()
  for (const row of rows) { const parent = parents.get(row.id)!; const list = children.get(parent) ?? []; list.push(row); children.set(parent, list) }
  const roots = children.get(null) ?? []
  const ordered: T[] = []; const depths = new Map<string, number>(); const paths = new Map<string, T[]>()
  const stack = roots.slice().reverse().map(row => ({row, depth: 0, path: [] as T[]}))
  while (stack.length) { const {row, depth, path} = stack.pop()!; const next = [...path, row]; ordered.push(row); depths.set(row.id, depth); paths.set(row.id, next); for (const child of (children.get(row.id) ?? []).slice().reverse()) stack.push({row: child, depth: depth + 1, path: next}) }
  return {byId, children, roots, ordered, depths, paths, anomalies,
    cards: [...roots, ...ordered.filter(row => parents.get(row.id) !== null)],
    descendants(id: string) { const result = new Set<string>(); const pending = [...(children.get(id) ?? [])]; while (pending.length) { const row = pending.pop()!; if (result.has(row.id)) continue; result.add(row.id); pending.push(...(children.get(row.id) ?? [])) }; return result },
    visible(expanded: ReadonlySet<string>) { return ordered.filter(row => (paths.get(row.id) ?? []).slice(0, -1).every(parent => expanded.has(parent.id))) },
    path(id: string) { return (paths.get(id) ?? []).map(row => row.name).join(" / ") },
  }
}
