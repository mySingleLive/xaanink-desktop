import {
  WIZARD_GENRES_BY_CHANNEL,
  WIZARD_GENRE_UNION,
  WIZARD_STYLES_BY_CHANNEL,
  WIZARD_TAG_GROUP_VOCABS,
  type WizardCategory,
  type WizardTagGroup,
  type WizardTemplate,
} from "./taxonomy"
import { WIZARD_TEMPLATES } from "./templates"

export interface WizardFilters {
  channel: string
  length: string
  genre: string
  tags: Record<WizardTagGroup, ReadonlySet<string>>
}

/** 已选模板 id（"blank" = 空白模板） */
export type WizardPicks = Record<WizardCategory, string>

export const DEFAULT_FILTERS: WizardFilters = {
  channel: "不限",
  length: "不限",
  genre: "全部",
  tags: { sub: new Set(), bg: new Set(), style: new Set(), flow: new Set() },
}

export const WIZARD_CATEGORIES = ["theme", "world", "character", "plot"] as const

export function genresForChannel(channel: string): readonly string[] {
  return channel === "男频" || channel === "女频" ? WIZARD_GENRES_BY_CHANNEL[channel] : WIZARD_GENRE_UNION
}

export function stylesForChannel(channel: string): readonly string[] {
  return channel === "男频" || channel === "女频" ? WIZARD_STYLES_BY_CHANNEL[channel] : WIZARD_STYLES_BY_CHANNEL.default
}

export function tagGroupOf(tag: string): WizardTagGroup | null {
  for (const group of ["sub", "bg", "style", "flow"] as const) {
    if (WIZARD_TAG_GROUP_VOCABS[group].includes(tag)) return group
  }
  return null
}

/**
 * 过滤语义（产品 §4.2）：频道/篇幅/题材任一不匹配即隐藏；
 * 标签组组内 OR、组间 AND，模板在某组无标签时该组兜底通过。
 */
export function isTemplateVisible(t: WizardTemplate, f: WizardFilters): boolean {
  if (f.channel !== "不限" && t.channels.length > 0 && !t.channels.includes(f.channel)) return false
  if (f.length !== "不限" && t.lengths != null && t.lengths.length > 0 && !t.lengths.includes(f.length)) return false
  if (f.genre !== "全部" && t.genres.length > 0 && !t.genres.includes(f.genre)) return false
  for (const group of ["sub", "bg", "style", "flow"] as const) {
    const sel = f.tags[group]
    if (sel.size === 0) continue
    const mine = t.tags.filter((x) => WIZARD_TAG_GROUP_VOCABS[group].includes(x))
    if (mine.length > 0 && !mine.some((x) => sel.has(x))) return false
  }
  return true
}

/** 所选标签 ∩ 模板 tags 命中数（排序用；通用模板 tags 空，自然为 0 排尾） */
export function tagHitScore(t: WizardTemplate, f: WizardFilters): number {
  let score = 0
  for (const tag of t.tags) {
    const group = tagGroupOf(tag)
    if (group != null && f.tags[group].has(tag)) score++
  }
  return score
}

export function visibleTemplates(
  cat: WizardCategory,
  f: WizardFilters,
  corpus: readonly WizardTemplate[] = WIZARD_TEMPLATES,
): WizardTemplate[] {
  return corpus
    .filter((t) => t.cat === cat && isTemplateVisible(t, f))
    .sort((a, b) => tagHitScore(b, f) - tagHitScore(a, f) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** 频道切换：题材不在新频道列表 → 回「全部」且清空 sub；风格已选项裁剪到新频道词表 */
export function onChannelChange(f: WizardFilters, next: string): WizardFilters {
  if (next === f.channel) return f
  const genreValid = f.genre === "全部" || genresForChannel(next).includes(f.genre)
  const styles = stylesForChannel(next)
  return {
    ...f,
    channel: next,
    genre: genreValid ? f.genre : "全部",
    tags: {
      ...f.tags,
      sub: genreValid ? f.tags.sub : new Set(),
      style: new Set([...f.tags.style].filter((x) => styles.includes(x))),
    },
  }
}

/** 题材切换：清空已选子类 */
export function onGenreChange(f: WizardFilters, next: string): WizardFilters {
  if (next === f.genre) return f
  return { ...f, genre: next, tags: { ...f.tags, sub: new Set() } }
}

/** 已选模板在新条件下不可见 → 回「blank」（产品 §4.3） */
export function pruneInvisiblePicks(
  picks: WizardPicks,
  f: WizardFilters,
  corpus: readonly WizardTemplate[] = WIZARD_TEMPLATES,
): WizardPicks {
  const next = { ...picks }
  for (const cat of WIZARD_CATEGORIES) {
    const id = picks[cat]
    if (id === "blank") continue
    const t = corpus.find((x) => x.id === id)
    if (!t || t.cat !== cat || !isTemplateVisible(t, f)) next[cat] = "blank"
  }
  return next
}
