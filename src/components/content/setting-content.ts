import type { SettingType } from "@/generated/prisma/enums"

/** 纯文本类设定内容（力量体系/世界地图/社会环境/人文环境/地理环境等） */
export interface TextContent {
  text: string
}
/** 等级体系中的能力项 */
export interface LevelAbility {
  name: string
  description: string
}
/** 等级体系中的单个等级节点：children 可无限嵌套子等级（如 炼气 → 炼气一层） */
export interface LevelNode {
  name: string
  /** 别名：同一等级在不同体系/语境下的叫法 */
  aliases: string[]
  /** 标签：标识等级特殊性（如 低序列/中序列/高序列/天使序列） */
  tags: string[]
  /** 进阶条件 */
  condition: string
  description: string
  /** 能力表现 */
  abilities: LevelAbility[]
  children: LevelNode[]
}
/** 等级类型：体系的使用对象（仅标识与引导，不改变数据结构） */
export const LEVEL_SCOPES = ["CHARACTER", "ITEM", "GENERAL"] as const
export type LevelScope = (typeof LEVEL_SCOPES)[number]
/** 等级形态：单途径一条等级阶梯；多途径多条途径各自一套等级序列。创建时确定，之后不可更改 */
export const LEVEL_FORMS = ["SINGLE", "MULTI_PATHWAY"] as const
export type LevelForm = (typeof LEVEL_FORMS)[number]

export const LEVEL_SCOPE_LABELS: Record<LevelScope, string> = {
  CHARACTER: "角色",
  ITEM: "物品",
  GENERAL: "通用",
}
export const LEVEL_FORM_LABELS: Record<LevelForm, string> = {
  SINGLE: "单途径",
  MULTI_PATHWAY: "多途径",
}

/** 多途径形态下的一条途径：levels 顺序即从低到高；pathways 数组顺序仅为展示顺序（途径无高低之分） */
export interface LevelPathway {
  name: string
  aliases: string[]
  tags: string[]
  description: string
  levels: LevelNode[]
}

/** 等级体系 */
export interface LevelSystemContent {
  scope: LevelScope
  form: LevelForm
  /** 体系介绍 */
  description: string
  /** 等级规则（晋升 / 互斥 / 代价等适用于整套体系的通用规则） */
  rules: string
  /** SINGLE 形态的等级序列 */
  levels: LevelNode[]
  /** MULTI_PATHWAY 形态的途径列表 */
  pathways: LevelPathway[]
}
/** 概念体系 */
export interface ConceptContent {
  concepts: { term: string; explanation: string }[]
}
/** 金手指 */
export interface GoldFingerContent {
  trigger: string
  ability: string
  limitation: string
}
/** 对话符号选项：正文对话的包裹符号，value 落库、label 展示 */
export const DIALOGUE_MARK_OPTIONS = [
  { value: "DOUBLE_QUOTE", label: "“xxx”" },
  { value: "SQUARE_BRACKET", label: "[xxx]" },
  { value: "CORNER_BRACKET", label: "「xxx」" },
  { value: "DOUBLE_CORNER_BRACKET", label: "『xxx』" },
] as const
export type DialogueMark = (typeof DIALOGUE_MARK_OPTIONS)[number]["value"]
export const DEFAULT_DIALOGUE_MARK: DialogueMark = "DOUBLE_QUOTE"

/** 心理对话符号选项：角色内心独白/心理活动的包裹符号，value 落库、label 展示 */
export const INNER_DIALOGUE_MARK_OPTIONS = [
  { value: "NONE", label: "无符号" },
  { value: "PARENTHESES", label: "(xxx)" },
  { value: "LENTICULAR_BRACKET", label: "【xxx】" },
] as const
export type InnerDialogueMark = (typeof INNER_DIALOGUE_MARK_OPTIONS)[number]["value"]
export const DEFAULT_INNER_DIALOGUE_MARK: InnerDialogueMark = "NONE"

export function dialogueMarkLabel(value: DialogueMark): string {
  return DIALOGUE_MARK_OPTIONS.find((o) => o.value === value)?.label ?? value
}

export function innerDialogueMarkLabel(value: InnerDialogueMark): string {
  return INNER_DIALOGUE_MARK_OPTIONS.find((o) => o.value === value)?.label ?? value
}

/** 文风设定 */
export interface StyleContent {
  style: string
  referenceCases: string
  dialogueMark: DialogueMark
  innerDialogueMark: InnerDialogueMark
}
/** 势力分布 */
export interface FactionContent {
  factions: { id?: string; [key: string]: unknown; name: string; description: string; relations: string }[]
}

export type SettingContent =
  | TextContent
  | LevelSystemContent
  | ConceptContent
  | GoldFingerContent
  | StyleContent
  | FactionContent

function asString(v: unknown): string {
  return typeof v === "string" ? v : ""
}

function asArray(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as Record<string, unknown>[]) : []
}

function asDialogueMark(v: unknown): DialogueMark {
  return DIALOGUE_MARK_OPTIONS.some((o) => o.value === v) ? (v as DialogueMark) : DEFAULT_DIALOGUE_MARK
}

function asInnerDialogueMark(v: unknown): InnerDialogueMark {
  return INNER_DIALOGUE_MARK_OPTIONS.some((o) => o.value === v)
    ? (v as InnerDialogueMark)
    : DEFAULT_INNER_DIALOGUE_MARK
}

/** 结构化（非纯文本）内容的设定类型；其余类型 content 均为 { text } */
const STRUCTURED_TYPES: readonly SettingType[] = [
  "LEVEL_SYSTEM",
  "CONCEPT",
  "GOLD_FINGER",
  "STYLE",
  "FACTION",
]

/** 该类型是否为纯文本内容（{ text }），AI 结果可直接按原文采用 */
export function isTextSettingType(type: SettingType): boolean {
  return !STRUCTURED_TYPES.includes(type)
}

/** 新建设定时的默认 content 结构 */
export function defaultContent(type: SettingType): SettingContent {
  switch (type) {
    case "LEVEL_SYSTEM":
      return {
        scope: "CHARACTER",
        form: "SINGLE",
        description: "",
        rules: "",
        levels: [],
        pathways: [],
      }
    case "CONCEPT":
      return { concepts: [] }
    case "GOLD_FINGER":
      return { trigger: "", ability: "", limitation: "" }
    case "STYLE":
      return {
        style: "",
        referenceCases: "",
        dialogueMark: DEFAULT_DIALOGUE_MARK,
        innerDialogueMark: DEFAULT_INNER_DIALOGUE_MARK,
      }
    case "FACTION":
      return { factions: [] }
    default:
      return { text: "" }
  }
}

/** 字符串数组规整：去空白、去重 */
function asStringList(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  const out: string[] = []
  for (const item of v) {
    const s = asString(item).trim()
    if (s && !out.includes(s)) out.push(s)
  }
  return out
}

/** 能力数组规整：字符串项视为名称（兼容旧 AI 输出），对象项缺省补空 */
function asAbilities(v: unknown): LevelAbility[] {
  if (!Array.isArray(v)) return []
  const out: LevelAbility[] = []
  for (const item of v) {
    if (typeof item === "string") {
      if (item.trim()) out.push({ name: item.trim(), description: "" })
    } else if (item && typeof item === "object") {
      const o = item as Record<string, unknown>
      out.push({ name: asString(o.name), description: asString(o.description) })
    }
  }
  return out
}

/** 递归规整等级节点：旧数据（仅 name/description/children）新字段补空 */
function normalizeLevel(raw: Record<string, unknown>): LevelNode {
  return {
    name: asString(raw.name),
    aliases: asStringList(raw.aliases),
    tags: asStringList(raw.tags),
    condition: asString(raw.condition),
    description: asString(raw.description),
    abilities: asAbilities(raw.abilities),
    children: asArray(raw.children).map(normalizeLevel),
  }
}

function asLevelScope(v: unknown): LevelScope {
  return (LEVEL_SCOPES as readonly unknown[]).includes(v) ? (v as LevelScope) : "GENERAL"
}

function asLevelForm(v: unknown): LevelForm {
  return (LEVEL_FORMS as readonly unknown[]).includes(v) ? (v as LevelForm) : "SINGLE"
}

/** 规整途径：旧数据缺字段补空；levels 递归 normalizeLevel */
function normalizePathway(raw: Record<string, unknown>): LevelPathway {
  return {
    name: asString(raw.name),
    aliases: asStringList(raw.aliases),
    tags: asStringList(raw.tags),
    description: asString(raw.description),
    levels: asArray(raw.levels).map(normalizeLevel),
  }
}

/** 把 DB 中的 Json content 规整为对应类型的结构（宽容处理历史/异常数据） */
export function normalizeContent(type: SettingType, raw: unknown): SettingContent {
  const obj = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  switch (type) {
    case "LEVEL_SYSTEM":
      return {
        ...obj,
        scope: asLevelScope(obj.scope),
        form: asLevelForm(obj.form),
        description: asString(obj.description),
        rules: asString(obj.rules),
        levels: asArray(obj.levels).map(normalizeLevel),
        pathways: asArray(obj.pathways).map(normalizePathway),
      }
    case "CONCEPT":
      return {
        ...obj,
        concepts: asArray(obj.concepts).map((c) => ({
          ...c,
          term: asString(c.term ?? c.name),
          explanation: asString(c.explanation ?? c.description),
        })),
      }
    case "GOLD_FINGER":
      return {
        ...obj,
        trigger: asString(obj.trigger),
        ability: asString(obj.ability),
        limitation: asString(obj.limitation),
      }
    case "STYLE":
      return {
        ...obj,
        style: asString(obj.style),
        referenceCases: asString(obj.referenceCases),
        dialogueMark: asDialogueMark(obj.dialogueMark),
        innerDialogueMark: asInnerDialogueMark(obj.innerDialogueMark),
      }
    case "FACTION":
      return {
        ...obj,
        factions: asArray(obj.factions).map((f) => ({
          ...f,
          id: asString(f.id) || undefined,
          name: asString(f.name),
          description: asString(f.description),
          relations: asString(f.relations),
        })),
      }
    default:
      return { ...obj, text: asString(obj.text) }
  }
}

/** 按名称/别名定位等级路径（实体芯片 focusConcept 与悬停卡反查共用口径） */
export function findLevelPath(list: LevelNode[], name: string, base: number[] = []): number[] | null {
  for (let i = 0; i < list.length; i++) {
    const p = [...base, i]
    if (list[i].name === name || list[i].aliases.includes(name)) return p
    const sub = findLevelPath(list[i].children, name, p)
    if (sub) return sub
  }
  return null
}

/** 子概念名最大长度：过滤描述性文本，只保留短概念词 */
const CONCEPT_NAME_MAX = 12

function collectLevelNames(levels: LevelNode[], out: string[]) {
  for (const level of levels) {
    if (level.name) out.push(level.name)
    for (const alias of level.aliases) if (alias) out.push(alias)
    collectLevelNames(level.children, out)
  }
}

/**
 * 从纯文本（markdown）设定中提取表格首列作为子概念词：
 * 如力量体系表格的「灵根」「功法」；跳过表头与分隔行。
 */
function collectTableConcepts(text: string, out: string[]) {
  let prevWasTableRow = false
  for (const line of text.split("\n")) {
    const t = line.trim()
    if (!t.startsWith("|")) {
      prevWasTableRow = false
      continue
    }
    const cells = t.split("|").slice(1, -1).map((c) => c.trim())
    if (cells.length === 0) {
      prevWasTableRow = false
      continue
    }
    // 分隔行（|---|---）
    if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue
    // 每个表格的首行是表头，跳过
    if (!prevWasTableRow) {
      prevWasTableRow = true
      continue
    }
    prevWasTableRow = true
    const name = cells[0].replace(/\*\*/g, "").trim()
    if (name) out.push(name)
  }
}

/**
 * 提取设定内容中的二级/子孙概念名（对话区实体芯片索引用）：
 * 等级体系取全部等级与子等级名，概念体系取术语，势力分布取势力名，
 * 纯文本类设定取 markdown 表格首列；固定字段结构（金手指/文风）无子概念。
 */
export function extractSettingConcepts(type: SettingType, raw: unknown): string[] {
  const content = normalizeContent(type, raw)
  const out: string[] = []
  switch (type) {
    case "LEVEL_SYSTEM": {
      const c = content as LevelSystemContent
      collectLevelNames(c.levels, out)
      for (const p of c.pathways) {
        if (p.name) out.push(p.name)
        for (const alias of p.aliases) if (alias) out.push(alias)
        collectLevelNames(p.levels, out)
      }
      break
    }
    case "CONCEPT":
      for (const c of (content as ConceptContent).concepts) if (c.term) out.push(c.term)
      break
    case "FACTION":
      for (const f of (content as FactionContent).factions) if (f.name) out.push(f.name)
      break
    case "GOLD_FINGER":
    case "STYLE":
      break
    default:
      collectTableConcepts((content as TextContent).text, out)
      break
  }
  // 去重 + 过滤过短/过长的词（单字与长描述句不适合做芯片）
  return [...new Set(out.map((n) => n.trim()))].filter(
    (n) => n.length >= 2 && n.length <= CONCEPT_NAME_MAX
  )
}
