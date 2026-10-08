/**
 * 角色弧线阶段卡片（ArcStage）：类型、zod 校验、规范化、字段词表与 AI 渲染辅助的单一来源。
 * 纯 TS 模块（不依赖 prisma / React），服务层、AI 工具与前端三处共用。
 *
 * 存储为 Character.arcStages Json：数组顺序 = 时间先后（不需要 sortKey，整单读写）；
 * 空数组时弧线页与 AI 渲染回退旧字段 backstory/growthArc。
 * 出场语义：全链最多一张 isDebut=true（normalize 兜底只保留第一张），
 * 出场卡之前的卡片自动视为出场前经历；无出场卡 → 整链视为登场后。
 */
import { z } from "zod"

import { normalizeBigFive, renderBigFive } from "@/lib/big-five"
import { normalizeBeliefs, renderBeliefs } from "@/lib/beliefs"
import {
  MOTIVATION_IMPORTANCE_MAX,
  MOTIVATION_ITEMS_MAX,
  MOTIVATION_LAYERS_MAX,
  MOTIVATION_TEXT_MAX,
  normalizeMotivations,
  renderMotivations,
} from "@/lib/motivation"

/* ------------------------------- 上限常量 ------------------------------- */

/** 单角色阶段卡片数上限（与路由 schema 一致） */
export const ARC_STAGES_MAX = 50
/** 阶段名长度上限 */
export const ARC_STAGE_NAME_MAX = 50
/** 每张卡阶段定位条数上限 */
export const ARC_STAGE_MARKERS_MAX = 6
/** 单条定位文本长度上限 */
export const ARC_STAGE_MARKER_TEXT_MAX = 50
/** 每张卡属性变化条数上限 */
export const ARC_STAGE_CHANGES_MAX = 12
/** 阶段描述长度上限 */
export const ARC_STAGE_DESCRIPTION_MAX = 2000
/** 每张卡标签数上限 */
export const ARC_STAGE_TAGS_MAX = 8
/** 单个标签长度上限 */
export const ARC_STAGE_TAG_MAX = 20
/** 起始章节 label 快照长度上限 */
export const ARC_STAGE_CHAPTER_LABEL_MAX = 100
/** 卡片简介截断长度（取描述首行） */
export const ARC_STAGE_SUMMARY_MAX = 60

/* ------------------------------- 类型 ------------------------------- */

/** 阶段定位类别：年龄 / 事件 / 自定义（自定义展示时不带类别前缀） */
export type ArcStageMarkerKind = "age" | "event" | "custom"

export interface ArcStageMarker {
  kind: ArcStageMarkerKind
  /** 如「16 岁」「练气一层」「父母被陷害后」 */
  text: string
}

/** 角色资料板块（弧线除外）：changes 的 section 取值 */
export type ArcStageSection = "identity" | "psyche" | "ability" | "relation"

export interface ArcStageChange {
  section: ArcStageSection
  /** 本板块内真实存在的属性字段 key（必须存在于 PROFILE_FIELD_SECTIONS[section]） */
  field: string
  /** 此阶段该属性的新状态，类型与字段本体同构（见 PROFILE_FIELD_SECTIONS 的 kind） */
  value: unknown
}

/** 起始章节快照：章节删除后按 label 兜底展示 */
export interface ArcStageChapterRef {
  chapterId: string
  volumeId: string
  /** 快照文案，如「第 1 卷 风起青萍 · 第 3 章 退婚」 */
  label: string
}

export interface ArcStage {
  /** 生成时引用的剧情版本；缺省兼容手工阶段。 */
  sources?: { key: string; hash: string }[]
  id: string
  name: string
  markers: ArcStageMarker[]
  startChapter: ArcStageChapterRef | null
  changes: ArcStageChange[]
  description: string
  tags: string[]
  /** 出场阶段（全链最多一张；其前卡片自动视为出场前经历） */
  isDebut: boolean
}

/* ------------------------------- 字段词表 ------------------------------- */

/** 属性变化值的控件/校验类型（决定 zod 校验与前端录入控件） */
export type ProfileFieldKind =
  | "text"
  | "textarea"
  | "tags"
  | "bigfive"
  | "beliefs"
  | "motivations"
  | "relationships"
  | "attributes"

export interface ProfileFieldDef {
  key: string
  /** 与 services/character.ts 的 CHARACTER_FIELD_LABELS 对齐（attributes 除外：自定义属性不进变更描述名单） */
  label: string
  kind: ProfileFieldKind
}

/**
 * 角色资料板块词表（阶段卡片 changes 的 section/field 唯一合法来源）。
 * 分组成 panel 子 tab 同序：身份·外在 / 心理 / 能力 / 关系；
 * 不含 roleType（枚举非文本）与 backstory/growthArc（弧线本身不是变化项）。
 */
export const PROFILE_FIELD_SECTIONS: { key: ArcStageSection; label: string; fields: ProfileFieldDef[] }[] = [
  {
    key: "identity",
    label: "身份·外在",
    fields: [
      { key: "name", label: "姓名", kind: "text" },
      { key: "aliases", label: "别名", kind: "tags" },
      { key: "age", label: "年龄", kind: "text" },
      { key: "gender", label: "性别", kind: "text" },
      { key: "occupation", label: "职业", kind: "text" },
      { key: "bio", label: "角色简介", kind: "textarea" },
      { key: "personality", label: "人物描述", kind: "textarea" },
      { key: "appearance", label: "外貌", kind: "textarea" },
      { key: "height", label: "身高", kind: "text" },
      { key: "weight", label: "体重", kind: "text" },
      { key: "build", label: "身材", kind: "text" },
      { key: "faceShape", label: "脸型", kind: "text" },
      { key: "clothing", label: "穿衣风格", kind: "textarea" },
      { key: "tastes", label: "品味偏好", kind: "textarea" },
      { key: "habits", label: "行为习惯", kind: "textarea" },
      { key: "catchphrase", label: "口头禅", kind: "text" },
      { key: "dialogueStyle", label: "对话风格", kind: "text" },
      { key: "sampleDialogue", label: "示例对话", kind: "textarea" },
    ],
  },
  {
    key: "psyche",
    label: "心理",
    fields: [
      { key: "personalityTags", label: "性格标签", kind: "tags" },
      { key: "motivations", label: "核心动机", kind: "motivations" },
      { key: "desires", label: "核心欲望", kind: "textarea" },
      { key: "fears", label: "核心恐惧", kind: "textarea" },
      { key: "beliefs", label: "观念", kind: "beliefs" },
      { key: "bigFive", label: "性格五维", kind: "bigfive" },
    ],
  },
  {
    key: "ability",
    label: "能力",
    fields: [
      { key: "abilities", label: "能力", kind: "textarea" },
      { key: "attributes", label: "自定义属性", kind: "attributes" },
    ],
  },
  {
    key: "relation",
    label: "关系",
    fields: [
      { key: "relationships", label: "人物关系", kind: "relationships" },
    ],
  },
]

const PROFILE_FIELD_INDEX: Map<string, ProfileFieldDef> = new Map(
  PROFILE_FIELD_SECTIONS.flatMap((section) =>
    section.fields.map((field) => [`${section.key}.${field.key}`, field] as const)
  )
)

/** 按 section + field 查字段定义；不存在的组合返回 null */
export function profileFieldDef(section: string, field: string): ProfileFieldDef | null {
  return PROFILE_FIELD_INDEX.get(`${section}.${field}`) ?? null
}

/* ------------------------------- zod 校验 ------------------------------- */

/** 各 kind 的 value 校验（上限与路由 character-schema 同口径） */
const CHANGE_VALUE_SCHEMAS: Record<ProfileFieldKind, z.ZodTypeAny> = {
  text: z.string().max(200),
  textarea: z.string().max(2000),
  tags: z.array(z.string().max(30)).max(12),
  bigfive: z.object({
    openness: z.number().int().min(0).max(100),
    conscientiousness: z.number().int().min(0).max(100),
    extraversion: z.number().int().min(0).max(100),
    agreeableness: z.number().int().min(0).max(100),
    neuroticism: z.number().int().min(0).max(100),
  }),
  beliefs: z.object({
    worldview: z.string().max(1000).optional(),
    values: z.string().max(1000).optional(),
    outlook: z.string().max(1000).optional(),
    other: z.string().max(1000).optional(),
  }),
  // 层结构上限复用 motivation.ts 常量（与路由 motivationLayerSchema 一致）
  motivations: z
    .array(
      z.object({
        items: z
          .array(
            z.object({
              text: z.string().trim().min(1).max(MOTIVATION_TEXT_MAX),
              importance: z.number().int().min(1).max(MOTIVATION_IMPORTANCE_MAX).default(3),
            })
          )
          .min(1)
          .max(MOTIVATION_ITEMS_MAX),
      })
    )
    .max(MOTIVATION_LAYERS_MAX),
  relationships: z
    .array(
      z.object({
        target: z.string().max(100),
        description: z.string().max(500),
        characterId: z.string().max(50).nullish(),
      })
    )
    .max(50),
  attributes: z.array(z.object({ definitionId: z.string().min(1), value: z.string().max(500) })).max(100),
}

/**
 * 属性变化校验：按 field 判别（字段全词表唯一），section 必须与词表中的所属板块一致。
 * 非法 section/field 或 value 类型不符整条拒绝（路由/工具层）；
 * 读库乱数据的防御性丢弃见 normalizeArcStages。
 */
export const arcStageChangeSchema = z.discriminatedUnion(
  "field",
  PROFILE_FIELD_SECTIONS.flatMap((section) =>
    section.fields.map((field) =>
      z.object({
        section: z.literal(section.key),
        field: z.literal(field.key),
        value: CHANGE_VALUE_SCHEMAS[field.kind],
      })
    )
  ) as [
    z.ZodObject<{ section: z.ZodLiteral<ArcStageSection>; field: z.ZodLiteral<string>; value: z.ZodTypeAny }>,
    ...z.ZodObject<{ section: z.ZodLiteral<ArcStageSection>; field: z.ZodLiteral<string>; value: z.ZodTypeAny }>[],
  ]
)

export const arcStageMarkerSchema = z.object({
  kind: z.enum(["age", "event", "custom"]).describe("定位类别：age 年龄 / event 事件 / custom 自定义"),
  text: z.string().trim().min(1).max(ARC_STAGE_MARKER_TEXT_MAX),
})

export const arcStageChapterRefSchema = z.object({
  chapterId: z.string().min(1),
  volumeId: z.string().min(1),
  label: z.string().min(1).max(ARC_STAGE_CHAPTER_LABEL_MAX),
})

export const arcStageSourceSchema = z.object({ key: z.string().min(3).max(160), hash: z.string().min(1).max(128) })

export const arcStageSchema = z.object({
  sources: z.array(arcStageSourceSchema).max(12).optional(),
  id: z.string().trim().min(1).max(50),
  name: z.string().trim().min(1).max(ARC_STAGE_NAME_MAX),
  markers: z.array(arcStageMarkerSchema).max(ARC_STAGE_MARKERS_MAX).default([]),
  startChapter: arcStageChapterRefSchema.nullable().default(null),
  changes: z.array(arcStageChangeSchema).max(ARC_STAGE_CHANGES_MAX).default([]),
  description: z.string().max(ARC_STAGE_DESCRIPTION_MAX).default(""),
  tags: z.array(z.string().trim().min(1).max(ARC_STAGE_TAG_MAX)).max(ARC_STAGE_TAGS_MAX).default([]),
  isDebut: z.boolean().default(false),
})

/** 阶段卡片链（数组顺序 = 时间先后，≤50 张） */
export const arcStageListSchema = z.array(arcStageSchema).max(ARC_STAGES_MAX)

/* ------------------------------- 规范化 ------------------------------- */

function normalizeMarkers(raw: unknown): ArcStageMarker[] {
  if (!Array.isArray(raw)) return []
  const markers: ArcStageMarker[] = []
  for (const x of raw) {
    if (!x || typeof x !== "object") continue
    const { kind, text } = x as Record<string, unknown>
    if (kind !== "age" && kind !== "event" && kind !== "custom") continue
    if (typeof text !== "string") continue
    const t = text.trim().slice(0, ARC_STAGE_MARKER_TEXT_MAX)
    if (!t) continue
    markers.push({ kind, text: t })
    if (markers.length >= ARC_STAGE_MARKERS_MAX) break
  }
  return markers
}

function normalizeChapterRef(raw: unknown): ArcStageChapterRef | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  if (typeof r.chapterId !== "string" || !r.chapterId) return null
  if (typeof r.volumeId !== "string" || !r.volumeId) return null
  const label = typeof r.label === "string" ? r.label.trim() : ""
  return { chapterId: r.chapterId, volumeId: r.volumeId, label: label.slice(0, ARC_STAGE_CHAPTER_LABEL_MAX) }
}

function normalizeStringList(raw: unknown, { max, itemMax }: { max: number; itemMax: number }): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const x of raw) {
    if (typeof x !== "string") continue
    const t = x.trim().slice(0, itemMax)
    if (t && !out.includes(t)) out.push(t)
    if (out.length >= max) break
  }
  return out
}

/** 按字段 kind 规整 value；结构不符返回 undefined（调用方丢弃该条变化） */
function normalizeChangeValue(kind: ProfileFieldKind, raw: unknown): unknown {
  switch (kind) {
    case "text":
      return typeof raw === "string" ? raw.slice(0, 200) : undefined
    case "textarea":
      return typeof raw === "string" ? raw.slice(0, 2000) : undefined
    case "tags":
      return Array.isArray(raw) ? normalizeStringList(raw, { max: 12, itemMax: 30 }) : undefined
    case "bigfive":
      return normalizeBigFive(raw) ?? undefined
    case "beliefs":
      return raw && typeof raw === "object" ? normalizeBeliefs(raw) : undefined
    case "motivations":
      return normalizeMotivations(raw)
    case "relationships": {
      if (!Array.isArray(raw)) return undefined
      return raw
        .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
        .map((x) => ({
          target: typeof x.target === "string" ? x.target.slice(0, 100) : "",
          description: typeof x.description === "string" ? x.description.slice(0, 500) : "",
          characterId: typeof x.characterId === "string" && x.characterId ? x.characterId : null,
        }))
        .filter((x) => x.target !== "")
        .slice(0, 50)
    }
    case "attributes": {
      if (!Array.isArray(raw)) return undefined
      return raw
        .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
        .map((x) => ({
          definitionId: typeof x.definitionId === "string" ? x.definitionId : "",
          value: typeof x.value === "string" ? x.value.slice(0, 500) : "",
        }))
        .filter((x) => x.definitionId !== "")
        .slice(0, 100)
    }
  }
}

function normalizeChanges(raw: unknown): ArcStageChange[] {
  if (!Array.isArray(raw)) return []
  const changes: ArcStageChange[] = []
  for (const x of raw) {
    if (!x || typeof x !== "object") continue
    const { section, field, value } = x as Record<string, unknown>
    if (typeof section !== "string" || typeof field !== "string" || value === undefined) continue
    const def = profileFieldDef(section, field)
    if (!def) continue
    const normalized = normalizeChangeValue(def.kind, value)
    if (normalized === undefined) continue
    changes.push({ section: section as ArcStageSection, field: def.key, value: normalized })
    if (changes.length >= ARC_STAGE_CHANGES_MAX) break
  }
  return changes
}

/**
 * DB Json / AI 草稿 → 规整后的阶段卡片链：
 * 剔除非对象项、字段缺失补默认、非法 kind/section/field 项丢弃、超长按规则截断、
 * isDebut 排他（只保留链上第一张出场卡）。
 */
export function normalizeArcStages(raw: unknown): ArcStage[] {
  if (!Array.isArray(raw)) return []
  const stages: ArcStage[] = []
  for (const x of raw) {
    if (!x || typeof x !== "object" || Array.isArray(x)) continue
    const r = x as Record<string, unknown>
    stages.push({
      id: typeof r.id === "string" && r.id ? r.id.slice(0, 50) : crypto.randomUUID(),
      name: typeof r.name === "string" ? r.name.trim().slice(0, ARC_STAGE_NAME_MAX) : "",
      markers: normalizeMarkers(r.markers),
      startChapter: normalizeChapterRef(r.startChapter),
      changes: normalizeChanges(r.changes),
      description: typeof r.description === "string" ? r.description.slice(0, ARC_STAGE_DESCRIPTION_MAX) : "",
      tags: normalizeStringList(r.tags, { max: ARC_STAGE_TAGS_MAX, itemMax: ARC_STAGE_TAG_MAX }),
      isDebut: r.isDebut === true,
      ...(Array.isArray(r.sources) ? { sources: r.sources.flatMap(source => { const parsed = arcStageSourceSchema.safeParse(source); return parsed.success ? [parsed.data] : [] }).slice(0, 12) } : {}),
    })
    if (stages.length >= ARC_STAGES_MAX) break
  }
  const debut = stages.findIndex((s) => s.isDebut)
  if (debut >= 0) {
    for (let i = debut + 1; i < stages.length; i++) stages[i] = { ...stages[i], isDebut: false }
  }
  return stages
}

/** 出场卡在链上的下标；无出场卡返回 -1 */
export function debutIndex(stages: ArcStage[]): number {
  return stages.findIndex((s) => s.isDebut)
}

/** 卡片简介：取描述首个非空行，截 60 字 */
export function summarizeStage(stage: ArcStage): string {
  const line = stage.description.split("\n").map((l) => l.trim()).find(Boolean) ?? ""
  return line.length > ARC_STAGE_SUMMARY_MAX ? `${line.slice(0, ARC_STAGE_SUMMARY_MAX)}…` : line
}

/* ------------------------------- AI 渲染 ------------------------------- */

/**
 * 属性变化值文本化（renderCharacter 的阶段行用）：
 * text/textarea 原样；tags 顿号连接；bigFive/beliefs/motivations 复用各自纯函数渲染；
 * relationships →「目标：描述；…」；attributes 需要 definitionId→名称映射，
 * 无映射或名称缺失时该项不渲染（与 renderCharacter 的属性行同口径）。
 */
export function renderChangeValue(field: string, value: unknown, attrNames?: ReadonlyMap<string, string>): string {
  const def = PROFILE_FIELD_SECTIONS.flatMap((s) => s.fields).find((f) => f.key === field)
  if (!def) return ""
  switch (def.kind) {
    case "text":
    case "textarea":
      return typeof value === "string" ? value.trim() : ""
    case "tags":
      return Array.isArray(value) ? normalizeStringList(value, { max: 12, itemMax: 30 }).join("、") : ""
    case "bigfive":
      return renderBigFive(value)
    case "beliefs":
      return renderBeliefs(value)
    case "motivations":
      return renderMotivations(value)
    case "relationships": {
      if (!Array.isArray(value)) return ""
      const parts: string[] = []
      for (const x of value) {
        if (!x || typeof x !== "object") continue
        const { target, description } = x as Record<string, unknown>
        if (typeof target !== "string" || !target.trim()) continue
        const desc = typeof description === "string" && description.trim() ? `：${description.trim()}` : ""
        parts.push(`${target.trim()}${desc}`)
      }
      return parts.join("；")
    }
    case "attributes": {
      if (!Array.isArray(value)) return ""
      const parts: string[] = []
      for (const x of value) {
        if (!x || typeof x !== "object") continue
        const { definitionId, value: v } = x as Record<string, unknown>
        if (typeof definitionId !== "string" || typeof v !== "string" || !v.trim()) continue
        const name = attrNames?.get(definitionId)
        if (!name) continue
        parts.push(`${name} ${v.trim()}`)
      }
      return parts.join(" · ")
    }
  }
}

/**
 * 阶段卡片链 → AI 上下文文本：
 * - backstory：有出场卡时，其前卡片的名称 + 描述逐条合成；无出场卡 → 空串（调用方可回退旧 backstory 字段）
 * - arc：逐阶段行「1.［出场前］旁支孤雏（8 岁 · 父母双亡后）：简介…」，
 *   出场卡带［出场］、起始章节并入括号（［出场·始自第 1 卷第 3 章］），
 *   属性变化摘要缀在简介后（「职业：金丹真人；性格标签：沉稳、谋定后动」）。
 */
export function renderArcStages(
  stages: ArcStage[],
  opts: { attrNames?: ReadonlyMap<string, string> } = {}
): { backstory: string; arc: string } {
  const debut = debutIndex(stages)
  const backstory =
    debut > 0
      ? stages
          .slice(0, debut)
          .map((s) => {
            const desc = s.description.trim()
            return desc ? `${s.name}：${desc}` : s.name
          })
          .join("\n")
      : ""
  const lines = stages.map((stage, i) => {
    const badges: string[] = []
    if (stage.isDebut) badges.push("出场")
    else if (debut > 0 && i < debut) badges.push("出场前")
    if (stage.startChapter) badges.push(`始自${stage.startChapter.label}`)
    const bracket = badges.length > 0 ? `［${badges.join("·")}］` : ""
    const markers = stage.markers.map((m) => m.text).join(" · ")
    const head = `${i + 1}.${bracket}${stage.name}${markers ? `（${markers}）` : ""}`
    const changes = stage.changes
      .map((c) => {
        const def = profileFieldDef(c.section, c.field)
        if (!def) return ""
        const text = renderChangeValue(c.field, c.value, opts.attrNames)
        return text ? `${def.label}：${text}` : ""
      })
      .filter(Boolean)
    const tail = [summarizeStage(stage), ...changes].filter(Boolean).join("；")
    return tail ? `${head}：${tail}` : head
  })
  return { backstory, arc: lines.join("\n") }
}

/** 本章之前明确生效的阶段。未定位的未来变化不能当成当前事实。 */
export function arcStagesAtChapter(stages: ArcStage[], chapterIds: string[], chapterId: string): ArcStage[] {
  const current = chapterIds.indexOf(chapterId)
  if (current < 0) return []
  const debut = stages.findIndex(stage => stage.isDebut)
  return stages.filter((stage, index) => {
    if (stage.startChapter) {
      const start = chapterIds.indexOf(stage.startChapter.chapterId)
      return start >= 0 && start <= current
    }
    return debut >= 0 && index <= debut
  })
}
