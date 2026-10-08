import { z } from "zod"
import {
  WIZARD_BACKGROUNDS, WIZARD_CHANNELS, WIZARD_FLOWS, WIZARD_LENGTHS,
  WIZARD_LENGTH_META, WIZARD_SUBGENRES, WIZARD_TAG_GROUP_VOCABS,
  type WizardLength, type WizardTagGroup,
} from "./taxonomy"
import { genresForChannel, stylesForChannel, type WizardFilters } from "./filter"

export const POSITION_CHANNELS = ["不限", ...WIZARD_CHANNELS] as const
export const POSITION_TAG_LIMIT = 20
export const POSITION_TAG_LENGTH = 30
export const POSITION_TAG_GROUPS = ["sub", "bg", "style", "flow"] as const
export const POSITION_GROUP_LABELS: Record<WizardTagGroup, string> = { sub: "子类", bg: "背景", style: "风格", flow: "情节" }

/** 存量作者定位也能读回；新建时另校验当前分类。 */
export const savedPositionSchema = z.object({
  channel: z.string(), genre: z.string(), length: z.string(), tags: z.array(z.string()),
})
export type NovelPosition = z.infer<typeof savedPositionSchema>
export const emptyPosition = (): NovelPosition => ({ channel: "不限", genre: "全部", length: "", tags: [] })

export function positionTagGroups(channel: string, genre: string) {
  return [
    { key: "sub" as const, label: "子类", tags: genre === "全部" || !genre ? [] : (WIZARD_SUBGENRES[genre] ?? []) },
    { key: "bg" as const, label: "背景", tags: WIZARD_BACKGROUNDS },
    { key: "style" as const, label: "风格", tags: stylesForChannel(channel) },
    { key: "flow" as const, label: "情节", tags: WIZARD_FLOWS },
  ]
}

export function positionFromFilters(f: WizardFilters): NovelPosition {
  return { channel: f.channel, genre: f.genre, length: f.length === "不限" ? "" : f.length,
    tags: [...new Set(POSITION_TAG_GROUPS.flatMap(g => [...f.tags[g]]))] }
}

export function tagAllowed(position: Pick<NovelPosition, "channel" | "genre">, tag: string): boolean {
  const known = Object.values(WIZARD_TAG_GROUP_VOCABS).some(tags => tags.includes(tag))
  return !known || positionTagGroups(position.channel, position.genre).some(g => g.tags.includes(tag))
}

export function positionError(p: NovelPosition, previous?: NovelPosition): string | null {
  if ((!previous || p.channel !== previous.channel) && !POSITION_CHANNELS.includes(p.channel as typeof POSITION_CHANNELS[number])) return "请选择不限、男频或女频"
  if ((!previous || p.channel !== previous.channel || p.genre !== previous.genre) && p.genre !== "全部" && !genresForChannel(p.channel).includes(p.genre)) return "题材不适用于当前频道，请重新选择"
  if ((!previous || p.length !== previous.length) && p.length !== "" && !(WIZARD_LENGTHS as readonly string[]).includes(p.length)) return "请选择微型、短篇、中篇或长篇"
  const unchangedTags = previous && JSON.stringify(p.tags) === JSON.stringify(previous.tags)
  const shrinking = previous && p.tags.length < previous.tags.length && p.tags.every(t => previous.tags.includes(t))
  if (!unchangedTags && !shrinking && p.tags.length > POSITION_TAG_LIMIT) return `最多选择 ${POSITION_TAG_LIMIT} 个标签`
  for (const tag of p.tags) {
    const old = previous?.tags.includes(tag)
    if (!old && (!tag.trim() || tag.length > POSITION_TAG_LENGTH)) return `标签须为 1 至 ${POSITION_TAG_LENGTH} 字`
    const relatedChanged = previous && ((p.genre !== previous.genre && WIZARD_TAG_GROUP_VOCABS.sub.includes(tag)) || (p.channel !== previous.channel && (WIZARD_TAG_GROUP_VOCABS.sub.includes(tag) || WIZARD_TAG_GROUP_VOCABS.style.includes(tag))))
    if ((!old || relatedChanged) && !tagAllowed(p, tag)) return `标签“${tag}”不适用于当前频道或题材`
  }
  return null
}

export const novelPositionSchema = z.object({
  channel: z.enum(POSITION_CHANNELS), genre: z.string().min(1).max(50),
  length: z.union([z.literal(""), z.enum(WIZARD_LENGTHS)]),
  tags: z.array(z.string().trim().min(1).max(POSITION_TAG_LENGTH)).max(100),
}).transform(p => ({ ...p, tags: [...new Set(p.tags)] })).superRefine((p, ctx) => {
  const message = positionError(p)
  if (message) ctx.addIssue({ code: "custom", message })
})

/** 与向导相同的联动，保留候选之外的历史自由标签。 */
export function changePosition(p: NovelPosition, field: "channel" | "genre", value: string): NovelPosition {
  if (p[field] === value) return p
  const next = { ...p, [field]: value, tags: [...p.tags] }
  const clearSub = field === "genre" || (p.genre !== "全部" && !genresForChannel(value).includes(p.genre))
  if (field === "channel" && clearSub) next.genre = "全部"
  if (clearSub) next.tags = next.tags.filter(t => !WIZARD_TAG_GROUP_VOCABS.sub.includes(t))
  if (field === "channel") next.tags = next.tags.filter(t => !WIZARD_TAG_GROUP_VOCABS.style.includes(t) || stylesForChannel(value).includes(t))
  return next
}

/** 固定三个定位字段，允许作者直接编辑；标签按四组稳定拼接。 */
export function composePositionBlock(f: WizardFilters): string {
  const lines = ["我的作品定位：", `・频道：${f.channel}`, `・篇幅：${f.length}${f.length !== "不限" ? `（${WIZARD_LENGTH_META[f.length as WizardLength]}）` : ""}`, `・题材：${f.genre}`]
  for (const g of POSITION_TAG_GROUPS) if (f.tags[g].size) lines.push(`・${g === "sub" ? "题材子类" : POSITION_GROUP_LABELS[g]}：${[...f.tags[g]].join("、")}`)
  return lines.join("\n")
}

/** 仅识别独立定位段；模板正文不能冒充定位。完整删除则清除，残缺则拒绝发送。 */
export function positionFromDraft(draft: string): NovelPosition {
  const lines = draft.replaceAll("\r\n", "\n").split("\n")
  const start = lines.findIndex(line => /^我的作品定位[：:]\s*$/.test(line.trim()))
  const orphan = (line: string) => /^\s*[・·*-]\s*(频道|篇幅|题材|题材子类|背景|风格|情节)[：:]/.test(line)
  if (start < 0) {
    if (lines.some(line => orphan(line) || line.includes("我的作品定位"))) throw new Error("作品定位格式不完整，请修正定位段或完整删除它")
    return emptyPosition()
  }
  const fields = new Map<string, string>()
  let end = start + 1
  for (; end < lines.length && lines[end].trim(); end++) {
    const match = lines[end].trim().match(/^[・·*-]\s*(频道|篇幅|题材|题材子类|背景|风格|情节)[：:]\s*(.*)$/)
    if (!match || fields.has(match[1]) || !match[2].trim()) throw new Error("作品定位含有残缺或重复字段，请修正后发送")
    fields.set(match[1], match[2].trim())
  }
  if (lines.slice(end).some(line => orphan(line) || line.includes("我的作品定位"))) throw new Error("作品定位须保留在同一个完整段落中")
  for (const field of ["频道", "篇幅", "题材"]) if (!fields.has(field)) throw new Error(`作品定位缺少${field}，请补齐或完整删除定位段`)
  const length = fields.get("篇幅")!.replace(/[（(].*[）)]$/, "").trim()
  const p: NovelPosition = { channel: fields.get("频道")!, genre: fields.get("题材")!, length: length === "不限" ? "" : length, tags: [] }
  for (const group of positionTagGroups(p.channel, p.genre)) {
    const raw = fields.get(group.key === "sub" ? "题材子类" : group.label)
    if (!raw) continue
    const tags = raw.split(/[、,，]/).map(t => t.trim())
    for (const tag of tags) {
      const known = Object.values(WIZARD_TAG_GROUP_VOCABS).some(v => v.includes(tag))
      if (known && !group.tags.includes(tag)) throw new Error(`“${tag}”不属于当前${group.label}候选`)
    }
    p.tags.push(...tags)
  }
  const parsed = novelPositionSchema.safeParse(p)
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "作品定位无效")
  return parsed.data
}

/** 普通延迟建书不额外锁定默认值；向导删除定位段仍明确清除定位。 */
export function positionForCreation(draft: string, fromWizard: boolean): NovelPosition | undefined {
  return fromWizard || /^我的作品定位[：:]\s*$/m.test(draft) ? positionFromDraft(draft) : undefined
}
