import { sceneForest, type SceneNode } from "./scene-tree"
export interface SceneContextRow extends SceneNode {
  novelId?: string; version?: number; description: string; coordinates?: string; backstory?: string; entryMethod?: string;
  exteriorDescription?: string; interiorDescription?: string; attributes?: unknown;
  factionSettingId?: string | null; factionId?: string | null; factionNameSnapshot?: string | null;
  exteriorImageUrl?: string | null; interiorImageUrl?: string | null;
}
export type SceneFaction = {settingId: string; id: string; name: string; path?: string}
export function sceneFactionLabel(scene: SceneContextRow, factions: readonly SceneFaction[]) {
  const faction = factions.find(f => f.settingId === scene.factionSettingId && f.id === scene.factionId)
  return faction ? `${faction.name}${faction.path ? `（${faction.path}）` : ""}` : scene.factionId ? `${scene.factionNameSnapshot || "原势力"}（已失效）` : "未指定"
}
export function renderSceneDetails(scene: SceneContextRow, factions: readonly SceneFaction[] = []) {
  return [`### 场景 ${scene.name}（${scene.id}，v${scene.version ?? 1}）`, ...([
    ["坐标", scene.coordinates], ["介绍", scene.description], ["背景故事", scene.backstory], ["进入方式", scene.entryMethod], ["外部描写", scene.exteriorDescription], ["内部描写", scene.interiorDescription],
  ] as const).filter(([, value]) => value?.trim()).map(([label, value]) => `- ${label}：${value}`), `- 所属势力：${sceneFactionLabel(scene, factions)}`, `- 自定义属性：${JSON.stringify(scene.attributes ?? [])}`, `- 示意图：外部${scene.exteriorImageUrl ? "已设置" : "未设置"}，内部${scene.interiorImageUrl ? "已设置" : "未设置"}（仅知道有无，未读取图片像素）`].join("\n")
}
export function renderSceneDirectory(rows: readonly SceneContextRow[]) {
  const tree = sceneForest(rows)
  return "【场景目录：包含关系以 parentId 为准；完整资料用 getSceneContext 读取】\n" + (tree.ordered.map(s => `- ${s.id} v${s.version ?? 1} · ${tree.path(s.id)} · parentId=${s.parentId ?? "根场景"} · ${s.description.slice(0, 160)}`).join("\n") || "（暂无场景）")
}
export function renderSceneContext(rows: readonly SceneContextRow[], id: string, factions: readonly SceneFaction[] = []) {
  const tree = sceneForest(rows); const scene = tree.byId.get(id)
  if (!scene) return "场景不存在或不属于当前作品"
  const ancestors = (tree.paths.get(id) ?? []).slice(0, -1)
  return [`【选定场景路径】${tree.path(id)}`, renderSceneDetails(scene, factions), "【祖先环境摘要；仅作环境/进入条件，不覆盖本场景资料】", ...ancestors.map(s => `${s.name}（${s.id}）：介绍=${s.description}; 进入方式=${s.entryMethod ?? ""}; 势力=${sceneFactionLabel(s, factions)}`), "【直接子场景】", ...(tree.children.get(id) ?? []).map(s => `${s.name}（${s.id}）：${s.description.slice(0, 200)}`)].join("\n")
}
/** Stable identity payload in the existing atomic mention syntax. */
export function sceneMention(scene: Pick<SceneContextRow, "id" | "name">, novelId: string) {
  return `@[场景/${scene.name.replace(/[\[\]\n]/g, " ")}](scene:${encodeURIComponent(novelId)}:${encodeURIComponent(scene.id)})`
}
export function parseSceneIdentity(payload: string | undefined | null) {
  if (!payload?.startsWith("scene:")) return null
  const parts = payload.split(":"); if (parts.length !== 3) return null
  try { const novelId = decodeURIComponent(parts[1]); const sceneId = decodeURIComponent(parts[2]); return novelId && sceneId ? {novelId, sceneId} : null } catch {return null}
}
export function sceneIdentities(text: string) { return [...text.matchAll(/@\[[^\]\n]+\]\((scene:[^\s)]+)\)/g)].map(m => parseSceneIdentity(m[1])).filter((v): v is {novelId: string; sceneId: string} => !!v) }
export function selectedSceneIds(rows: readonly SceneContextRow[], task: string, novelId: string, targetId?: string) {
  const references = sceneIdentities(task)
  if (references.some(ref => ref.novelId !== novelId || !rows.some(s => s.id === ref.sceneId))) throw new Error("引用场景已删除或不属于当前作品，请重新选择")
  const explicit = new Set(references.map(ref => ref.sceneId)); if (targetId && rows.some(s => s.id === targetId)) explicit.add(targetId)
  for (const row of rows) if (row.name.length >= 2 && task.includes(row.name) && rows.filter(s => s.name === row.name).length === 1) explicit.add(row.id)
  return [...explicit]
}
export function sceneHasText(s: SceneContextRow) { return [s.description, s.backstory, s.entryMethod, s.exteriorDescription, s.interiorDescription].some(value => value?.trim()) }
