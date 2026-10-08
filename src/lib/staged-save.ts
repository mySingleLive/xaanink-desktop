import { z } from "zod"

/**
 * 三阶段保存 · 共享核心（客户端暂存仓 / apiSend 拦截 / 服务端落库执行器 / 测试共用）。
 * 纯 TS 模块：不依赖 React / prisma / next，客户端与服务端都可 import。
 * 设计契约：docs/staged-save/technical-design.md；UI：design/staged-save-preview.html。
 */

/** 特性开关：false 时 apiSend 拦截短路，全站回到直连保存（无残留分支） */
export const STAGED_SAVE_ENABLED = true

/* ============================== 类型 ============================== */

export type StagedOp = "modify" | "delete" | "create"

export type StagedTargetKind =
  | "THEME"
  | "WORLD"
  | "SETTING"
  | "CHARACTER"
  | "ITEM"
  | "SCENE"
  | "TROPE"
  | "ATTRIBUTE"
  | "FORESHADOW"
  | "CHAPTER_CONTENT"
  | "CHAPTER_OUTLINE"
  | "VOLUME_OUTLINE"

/** 字段级修改明细（N 的计数单位；悬停卡逐项展示） */
export interface StagedChangeItem {
  /** 字段级去重键：kind:targetId:field */
  key: string
  field: string
  fieldLabel: string
  summary: string
  before?: string
  after?: string
}

/** 一次被拦截的写请求对应的结构化修改（上行落库载荷） */
export interface StagedChange {
  targetKind: StagedTargetKind
  /** 实体 id；THEME 用 novelId；create 拦截时为 staged- 前缀占位 id */
  targetId: string
  targetLabel: string
  novelId: string
  op: StagedOp
  /** 拦截时的原始请求（服务端按 kind+op 映射服务层，只取数据字段与首帧控制字段） */
  request: { url: string; method: "PATCH" | "POST" | "DELETE"; body?: unknown }
  items: StagedChangeItem[]
  updatedAt: number
}

/** 对话请求中一批（一个面板）的暂存修改 */
export interface StagedBatchPayload {
  batchKey: string
  novelId: string
  label: string
  changes: StagedChange[]
}

/* ============================== zod ============================== */

const itemSchema = z.object({
  key: z.string().min(1).max(400),
  field: z.string().min(1).max(80),
  fieldLabel: z.string().min(1).max(40),
  summary: z.string().min(1).max(300),
  before: z.string().max(400).optional(),
  after: z.string().max(400).optional(),
})

const TARGET_KINDS = [
  "THEME", "WORLD", "SETTING", "CHARACTER", "ITEM", "SCENE", "TROPE", "ATTRIBUTE",
  "FORESHADOW", "CHAPTER_CONTENT", "CHAPTER_OUTLINE", "VOLUME_OUTLINE",
] as const

export const stagedChangeSchema = z.object({
  targetKind: z.enum(TARGET_KINDS),
  targetId: z.string().min(1).max(80),
  targetLabel: z.string().min(1).max(160),
  novelId: z.string().min(1).max(80),
  op: z.enum(["modify", "delete", "create"]),
  request: z.object({
    url: z.string().min(1).max(400),
    method: z.enum(["PATCH", "POST", "DELETE"]),
    body: z.unknown().optional(),
  }),
  items: z.array(itemSchema).min(1).max(60),
  updatedAt: z.number().int().nonnegative(),
})

export const stagedBatchPayloadSchema = z.object({
  batchKey: z.string().min(1).max(200),
  novelId: z.string().min(1).max(80),
  label: z.string().min(1).max(160),
  changes: z.array(stagedChangeSchema).min(1).max(40),
})

/** turn.action 中暂存批次的形状（重试/恢复可复原） */
export interface StagedSaveTurnAction {
  kind: "stagedSave"
  batches: StagedBatchPayload[]
}

export function parseStagedSaveAction(raw: unknown): StagedSaveTurnAction | null {
  if (!raw || typeof raw !== "object" || (raw as { kind?: unknown }).kind !== "stagedSave") return null
  const parsed = z.object({ kind: z.literal("stagedSave"), batches: z.array(stagedBatchPayloadSchema).min(1).max(8) }).safeParse(raw)
  return parsed.success ? parsed.data : null
}

/* ============================== 字段标签 ============================== */

const FIELD_LABELS: Record<string, string> = {
  name: "名称",
  title: "标题",
  description: "介绍",
  parentId: "上级场景",
  coordinates: "坐标",
  backstory: "背景故事",
  entryMethod: "进入方式",
  exteriorDescription: "外部描写",
  interiorDescription: "内部描写",
  factionSettingId: "势力来源",
  factionId: "所属势力",
  content: "内容",
  outline: "大纲",
  text: "文本",
  detail: "详细描述",
  personality: "人物描述",
  appearance: "外貌",
  background: "背景",
  abilities: "能力",
  arc: "角色弧",
  relationships: "关系",
  dialogueStyle: "对话风格",
  note: "备注",
  expectation: "读者期待",
  plannedChapter: "计划章节",
  status: "状态",
  selected: "选中",
  sampleProse: "样文",
  sampleOutline: "样纲",
  premise: "故事前提",
  genre: "题材",
  length: "篇幅",
  style: "文风",
  tone: "基调",
  hooks: "钩子",
  audience: "目标读者",
  sellingPoints: "卖点",
  values: "属性值",
  withEnding: "含结局",
  foreshadowIds: "关联伏笔",
  emotions: "情绪点",
  characterIds: "关联角色",
  sceneIds: "关联场景",
  chapterIds: "关联章节",
  stage: "叙事阶段",
}

export function stagedFieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field
}

/** 请求体里的控制字段：不进数据合并、不计修改项（首帧值由服务端执行器单独提取） */
export const STAGED_CONTROL_FIELDS = new Set([
  "operationId",
  "expectedVersion",
  "baseline",
  "expectedUpdatedAt",
])

/** 剥离控制字段后的数据字段（用于影子合并与 items 推导） */
export function stagedDataFields(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return {}
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (!STAGED_CONTROL_FIELDS.has(key)) out[key] = value
  }
  return out
}

const CLIP = 160

function clip(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  // 结构化字段（设定 content 等）优先取 text 呈现，避免悬停卡出现 JSON 原文
  const unwrapped =
    typeof value === "object" && !Array.isArray(value) && typeof (value as { text?: unknown }).text === "string"
      ? (value as { text: string }).text
      : value
  const text = typeof unwrapped === "string" ? unwrapped : JSON.stringify(unwrapped)
  if (!text) return undefined
  return text.length > CLIP ? `${text.slice(0, CLIP)}…` : text
}

/* ============================== 端点模式表 ============================== */

export interface StagedPattern {
  kind: StagedTargetKind
  op: StagedOp
  method: "PATCH" | "POST" | "DELETE"
  /** /api/novels/[novelId] 之后的路径段；":x" 为参数段 */
  segments: string[]
  /** GET 快照与合成回执使用的包络键；create/delete 无快照 */
  envelope?: string
  /** 目标类型展示名（悬停卡/报告用） */
  kindLabel: string
  /** tab 推导（与 buildTabId 同构） */
  tab: (p: Record<string, string>, novelId: string) => { type: string; refId?: string }
}

const P = (pattern: StagedPattern) => pattern

/**
 * 拦截白名单（与技术设计 §3.1 一致）。匹配按 segments 长度降序，先深后浅。
 * 不在表内的写请求（生成/候选/级联/评论/图像/版本/布局/试验场/章卷结构）直接放行。
 */
export const STAGED_PATTERNS: StagedPattern[] = [
  // ---- 修改（PATCH）----
  P({ kind: "CHAPTER_OUTLINE", op: "modify", method: "PATCH", segments: ["outline", "chapters", ":chapterId"], envelope: "chapter", kindLabel: "章大纲", tab: p => ({ type: "chapter-outline", refId: p.chapterId }) }),
  P({ kind: "VOLUME_OUTLINE", op: "modify", method: "PATCH", segments: ["outline", "volumes", ":volumeId"], envelope: "volume", kindLabel: "卷大纲", tab: () => ({ type: "outline" }) }),
  P({ kind: "CHAPTER_CONTENT", op: "modify", method: "PATCH", segments: ["chapters", ":chapterId"], envelope: "chapter", kindLabel: "章节正文", tab: p => ({ type: "chapter-content", refId: p.chapterId }) }),
  P({ kind: "WORLD", op: "modify", method: "PATCH", segments: ["worlds", ":worldId"], envelope: "world", kindLabel: "世界", tab: p => ({ type: "world", refId: p.worldId }) }),
  P({ kind: "SETTING", op: "modify", method: "PATCH", segments: ["settings", ":settingId"], envelope: "setting", kindLabel: "设定", tab: () => ({ type: "setting" }) }),
  P({ kind: "CHARACTER", op: "modify", method: "PATCH", segments: ["characters", ":characterId"], envelope: "character", kindLabel: "角色", tab: p => ({ type: "character", refId: p.characterId }) }),
  P({ kind: "ITEM", op: "modify", method: "PATCH", segments: ["items", ":itemId"], envelope: "item", kindLabel: "物品", tab: p => ({ type: "item", refId: p.itemId }) }),
  P({ kind: "SCENE", op: "modify", method: "PATCH", segments: ["scenes", ":sceneId"], envelope: "scene", kindLabel: "场景", tab: p => ({ type: "scene", refId: p.sceneId }) }),
  P({ kind: "TROPE", op: "modify", method: "PATCH", segments: ["tropes", ":tropeId"], envelope: "trope", kindLabel: "爽点", tab: () => ({ type: "trope" }) }),
  P({ kind: "ATTRIBUTE", op: "modify", method: "PATCH", segments: ["attributes", ":attributeId"], envelope: "attribute", kindLabel: "属性", tab: () => ({ type: "attributes" }) }),
  P({ kind: "FORESHADOW", op: "modify", method: "PATCH", segments: ["foreshadows", ":fid"], envelope: "foreshadow", kindLabel: "伏笔", tab: () => ({ type: "foreshadow" }) }),
  P({ kind: "THEME", op: "modify", method: "PATCH", segments: ["theme"], envelope: "theme", kindLabel: "题材", tab: () => ({ type: "theme" }) }),
  // ---- 删除实体（DELETE）----
  P({ kind: "WORLD", op: "delete", method: "DELETE", segments: ["worlds", ":worldId"], kindLabel: "世界", tab: p => ({ type: "world", refId: p.worldId }) }),
  P({ kind: "SETTING", op: "delete", method: "DELETE", segments: ["settings", ":settingId"], kindLabel: "设定", tab: () => ({ type: "setting" }) }),
  P({ kind: "CHARACTER", op: "delete", method: "DELETE", segments: ["characters", ":characterId"], kindLabel: "角色", tab: p => ({ type: "character", refId: p.characterId }) }),
  P({ kind: "ITEM", op: "delete", method: "DELETE", segments: ["items", ":itemId"], kindLabel: "物品", tab: p => ({ type: "item", refId: p.itemId }) }),
  P({ kind: "SCENE", op: "delete", method: "DELETE", segments: ["scenes", ":sceneId"], kindLabel: "场景", tab: p => ({ type: "scene", refId: p.sceneId }) }),
  P({ kind: "TROPE", op: "delete", method: "DELETE", segments: ["tropes", ":tropeId"], kindLabel: "爽点", tab: () => ({ type: "trope" }) }),
  P({ kind: "ATTRIBUTE", op: "delete", method: "DELETE", segments: ["attributes", ":attributeId"], kindLabel: "属性", tab: () => ({ type: "attributes" }) }),
  P({ kind: "FORESHADOW", op: "delete", method: "DELETE", segments: ["foreshadows", ":fid"], kindLabel: "伏笔", tab: () => ({ type: "foreshadow" }) }),
  // ---- 世界观中的实体创建（POST）----
  P({ kind: "WORLD", op: "create", method: "POST", segments: ["worlds"], envelope: "world", kindLabel: "世界", tab: () => ({ type: "world" }) }),
  P({ kind: "SETTING", op: "create", method: "POST", segments: ["settings"], envelope: "setting", kindLabel: "设定", tab: () => ({ type: "setting" }) }),
]

const NOVELS_PREFIX = "/api/novels/"

export interface StagedMatch {
  pattern: StagedPattern
  novelId: string
  params: Record<string, string>
}

/** 匹配拦截白名单；未命中返回 null（直接放行） */
export function matchStagedPattern(url: string, method: string): StagedMatch | null {
  if (!url.startsWith(NOVELS_PREFIX)) return null
  const rest = url.slice(NOVELS_PREFIX.length)
  const parts = rest.split("/").filter(Boolean)
  if (parts.length < 2) return null
  const [novelId, ...segs] = parts
  const candidates = [...STAGED_PATTERNS]
    .filter(p => p.method === method && p.segments.length === segs.length)
    .sort((a, b) => b.segments.length - a.segments.length)
  for (const pattern of candidates) {
    const params: Record<string, string> = {}
    let ok = true
    for (let i = 0; i < segs.length; i++) {
      const want = pattern.segments[i]
      if (want.startsWith(":")) params[want.slice(1)] = decodeURIComponent(segs[i])
      else if (want !== segs[i]) { ok = false; break }
    }
    if (ok) return { pattern, novelId, params }
  }
  return null
}

/* ============================== 修改项推导 ============================== */

/** 目标展示名：优先名字字段，其次标题，兜底类型名 */
export function stagedTargetName(snapshot: unknown, fallback: string): string {
  if (snapshot && typeof snapshot === "object") {
    const row = snapshot as Record<string, unknown>
    const name = row.name ?? row.title
    if (typeof name === "string" && name.trim()) return name.trim()
  }
  return fallback
}

/**
 * 快照解析：白名单路由多数无 GET（characters/items/scenes 等只有 PATCH/DELETE），
 * 从查询缓存条目（React Query getQueryCache().getAll() 的形状）按 URL 末段 id 找面板已加载的实体
 * （即服务端已存稿）作 diff 基座；同 id 可能在多条缓存里出现（列表行/详情行），取字段最多的一条。
 * 找不到返回 undefined，由调用方回退 GET 直取。
 */
export function snapshotFromQueryEntries(
  entries: Iterable<{ state: { data: unknown } }>,
  url: string
): unknown {
  if (!url.startsWith(NOVELS_PREFIX)) return undefined
  const parts = url.slice(NOVELS_PREFIX.length).split("/").filter(Boolean)
  if (parts.length < 3) return undefined // theme 等无 id 端点，走 GET 回退
  const targetId = decodeURIComponent(parts[parts.length - 1]!)
  // 同一 id 可能命中多类缓存行（真实实体行 vs 故事产物/索引行）：实体行带 version/name/updatedAt，
  // 产物行（{key, kind, id, title, hash…}）键数可能相同——按实体特征加权，避免选到无 name/content 的产物行导致修改明细虚计
  const scoreOf = (row: Record<string, unknown>) =>
    Object.keys(row).length +
    (typeof row.version === "number" ? 100 : 0) +
    (typeof row.name === "string" ? 50 : 0) +
    (typeof row.updatedAt === "string" ? 25 : 0)
  let best: Record<string, unknown> | undefined
  const visit = (node: unknown, depth: number, seen: Set<unknown>) => {
    if (depth > 8 || !node || typeof node !== "object" || seen.has(node)) return
    seen.add(node)
    if (!Array.isArray(node) && (node as { id?: unknown }).id === targetId) {
      const row = node as Record<string, unknown>
      if (!best || scoreOf(row) > scoreOf(best)) best = row
    }
    for (const value of Object.values(node)) {
      if (value && typeof value === "object") visit(value, depth + 1, seen)
    }
  }
  for (const entry of entries) {
    visit(entry?.state?.data, 0, new Set())
  }
  return best
}

/** 键序无关深度相等：对象按键递归（DB Json 与规整后对象的 key 序常不同，如 bigFive），数组仍按序 */
function stagedDeepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((v, i) => stagedDeepEqual(v, b[i]))
    )
  }
  const aRow = a as Record<string, unknown>
  const bRow = b as Record<string, unknown>
  const keys = Object.keys(aRow)
  return (
    keys.length === Object.keys(bRow).length &&
    keys.every(k => Object.prototype.hasOwnProperty.call(bRow, k) && stagedDeepEqual(aRow[k], bRow[k]))
  )
}

/** 暂存展示用的宽松相等：空值（null/undefined/""）互通，标量按字符串比较，结构按键序无关深度比较 */
function sameStagedValue(before: unknown, after: unknown): boolean {
  if (before === after) return true
  const emptyish = (v: unknown) => v === undefined || v === null || v === ""
  if (emptyish(before) || emptyish(after)) return emptyish(before) && emptyish(after)
  if (typeof before === "object" || typeof after === "object") {
    return stagedDeepEqual(before, after)
  }
  return String(before) === String(after)
}

/**
 * 由数据字段推导字段级修改项（同字段反复改记 1 处）。
 * 面板自动保存常整对象上行：只记与快照实际不同的字段（如仅改身高则只计 1 处）；
 * 无快照（GET 失败）时无法比对，名称字段不计（恒携带、无法证明被改），其余字段全量计入 —— 明细仅供计数/展示，落库以请求体为准。
 */
export function deriveStagedItems(input: {
  kind: StagedTargetKind
  targetId: string
  targetLabel: string
  kindLabel: string
  body: unknown
  before?: unknown
}): StagedChangeItem[] {
  const data = stagedDataFields(input.body)
  const hasBefore = !!input.before && typeof input.before === "object"
  const before = (hasBefore ? input.before : {}) as Record<string, unknown>
  const items: StagedChangeItem[] = []
  for (const [field, value] of Object.entries(data)) {
    if (hasBefore && sameStagedValue(before[field], value)) continue
    // 无快照可比对时无法证明名称被修改（面板 PATCH 恒携带名称），不计入，避免单字段编辑被虚计；
    // 仅剩名称时 items 为空，调用方回退直连保存（重命名立即落库，语义安全）
    if (!hasBefore && (field === "name" || field === "title")) continue
    const label = stagedFieldLabel(field)
    items.push({
      key: `${input.kind}:${input.targetId}:${field}`,
      field,
      fieldLabel: label,
      summary: `${input.targetLabel} · ${label}`,
      before: clip(before[field]),
      after: clip(value),
    })
  }
  return items
}

/** 删除/创建的单条修改项 */
export function deriveStagedOpItem(input: {
  kind: StagedTargetKind
  targetId: string
  targetLabel: string
  op: "delete" | "create"
  body?: unknown
}): StagedChangeItem {
  const isDelete = input.op === "delete"
  return {
    key: `${input.kind}:${input.targetId}:${input.op}`,
    field: input.op,
    fieldLabel: isDelete ? "删除" : "新增",
    summary: `${isDelete ? "删除" : "新增"}「${input.targetLabel}」`,
    ...(isDelete ? {} : { after: clip(stagedDataFields(input.body).name ?? stagedDataFields(input.body).title) }),
  }
}

/* ============================== 合成回执 ============================== */

/** 影子合并不代表落库；保留快照的真实版本令牌，正式提交回执才推进令牌。 */
export function buildSyntheticReceipt(input: {
  snapshot: unknown
  body: unknown
  envelope: string
}): Record<string, unknown> {
  const base = (input.snapshot && typeof input.snapshot === "object" ? { ...(input.snapshot as Record<string, unknown>) } : {}) as Record<string, unknown>
  const data = stagedDataFields(input.body)
  delete data.version
  delete data.updatedAt
  const merged: Record<string, unknown> = { ...base, ...data }
  return { [input.envelope]: merged }
}

/** create 拦截的合成回执：占位 id + 请求体字段 + 客户端时间戳 */
export function buildSyntheticCreated(input: {
  body: unknown
  envelope: string
  placeholderId: string
  extra?: Record<string, unknown>
}): Record<string, unknown> {
  const data = stagedDataFields(input.body)
  const now = new Date().toISOString()
  return {
    [input.envelope]: {
      id: input.placeholderId,
      version: 1,
      createdAt: now,
      updatedAt: now,
      ...input.extra,
      ...data,
    },
  }
}

/** delete 拦截的合成回执：与各 DELETE 路由现状一致 */
export const STAGED_DELETE_RECEIPT = { ok: true } as const

/* ============================== 服务端执行辅助 ============================== */

/** 首帧控制字段：暂存期间的多次保存只有第一次携带真实服务端版本 */
export function firstControl(body: unknown): { operationId?: string; expectedVersion?: number; baseline?: unknown; expectedUpdatedAt?: string } {
  if (!body || typeof body !== "object") return {}
  const row = body as Record<string, unknown>
  return {
    ...(typeof row.operationId === "string" ? { operationId: row.operationId } : {}),
    ...(typeof row.expectedVersion === "number" ? { expectedVersion: row.expectedVersion } : {}),
    ...(row.baseline !== undefined ? { baseline: row.baseline } : {}),
    ...(typeof row.expectedUpdatedAt === "string" ? { expectedUpdatedAt: row.expectedUpdatedAt } : {}),
  }
}

/** 用户消息首行的气泡摘要（历史可见当时发的是什么；不含大 payload） */
export function stagedMessageSummary(batches: StagedBatchPayload[]): string {
  return batches
    .map(b => `【修改】「${b.label}」${b.changes.reduce((n, c) => n + c.items.length, 0)} 处`)
    .join("、")
}
