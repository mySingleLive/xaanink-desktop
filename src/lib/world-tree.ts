import { validWorldName } from "./world-schema"

export interface WorldNode { id: string; parentId: string | null; name: string | null }
/** 显示层按 ID 去重并切断异常父链，保留每个不同 ID；绝不写回修复数据库。 */
export function worldForest<T extends WorldNode>(rows: T[]) {
  const nodes = new Map<string, T>(), anomalies = new Set<string>()
  for (const row of rows) {
    if (nodes.has(row.id)) anomalies.add(row.id)
    else nodes.set(row.id, row)
  }
  const parents = new Map([...nodes].map(([id, row]) => [id, row.parentId]))
  for (const [id, node] of nodes) {
    if (!validWorldName(node.name)) anomalies.add(id)
    const seen = new Set<string>([id])
    let current = parents.get(id)
    while (current) {
      if (!nodes.has(current) || seen.has(current)) { parents.set(id, null); anomalies.add(id); break }
      seen.add(current); current = parents.get(current)
    }
  }
  const children = new Map<string | null, T[]>()
  for (const [id, node] of nodes) {
    const parent = parents.get(id) ?? null
    children.set(parent, [...(children.get(parent) ?? []), node])
  }
  return { roots: children.get(null) ?? [], children, anomalies, duplicateIds: rows.length - nodes.size }
}

export interface WorldAuditRow extends WorldNode { novelId: string; settingReferences: number; descriptionHash?: string }
export function auditWorlds(rows: WorldAuditRow[]) {
  const grouped = new Map<string, WorldAuditRow[]>(), names = new Map<string, WorldAuditRow[]>()
  for (const row of rows) {
    if (!validWorldName(row.name)) continue
    const name = row.name.trim()
    const key = JSON.stringify([row.novelId, row.parentId, name])
    grouped.set(key, [...(grouped.get(key) ?? []), row])
    const nameKey = JSON.stringify([row.novelId, name])
    names.set(nameKey, [...(names.get(nameKey) ?? []), row])
  }
  return {
    rows,
    invalidNames: rows.filter(row => !validWorldName(row.name)),
    duplicateIds: [...new Set(rows.filter((row, index) => rows.findIndex(other => other.id === row.id) !== index).map(row => row.id))],
    duplicateSiblings: [...grouped.values()].filter(group => group.length > 1),
    legitimateRepeatedNames: [...names.values()].filter(group => new Set(group.map(row => row.parentId)).size > 1),
    topologyWarnings: [...new Set([...worldForest(rows).anomalies, ...rows.filter(row => row.parentId && rows.some(parent => parent.id === row.parentId && parent.novelId !== row.novelId)).map(row => row.id)])],
  }
}
