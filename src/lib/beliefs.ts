/**
 * 角色观念：世界观（如何看待这个世界中的事物）/ 价值观（如何判断对错、该不该做、值不值得做）/
 * 人生观（如何看待自己和别人的人生）/ 其他思想观念。
 * 存储为 Character.beliefs Json（{ worldview?, values?, outlook?, other? }，均为可选字符串），
 * 本模块是规整逻辑的唯一来源（纯 TS，客户端组件与服务端服务层共用，零依赖）。
 */

/** 单条观念字数上限（与路由 schema 一致） */
export const BELIEF_TEXT_MAX = 1000

export interface Beliefs {
  worldview?: string
  values?: string
  outlook?: string
  other?: string
}

export type BeliefKey = keyof Beliefs

/** 观念键定义（顺序即面板与渲染顺序） */
export const BELIEF_KEYS: { key: BeliefKey; label: string; placeholder: string }[] = [
  { key: "worldview", label: "世界观", placeholder: "他如何看待这个世界中的事物：世界是怎样的、运转规律是什么……" },
  { key: "values", label: "价值观", placeholder: "他如何判断对错、该不该做、值不值得做……" },
  { key: "outlook", label: "人生观", placeholder: "他如何看待自己和别人的人生：活着的意义、命运的看法……" },
  { key: "other", label: "其他观念", placeholder: "其他重要思想、信条、偏见……" },
]

/** DB Json / AI 输出 → 规整后的观念对象（非字符串丢弃、空白丢弃、超长截断；全空 → {}） */
export function normalizeBeliefs(raw: unknown): Beliefs {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {}
  const r = raw as Record<string, unknown>
  const out: Beliefs = {}
  for (const { key } of BELIEF_KEYS) {
    const v = r[key]
    if (typeof v !== "string") continue
    const t = v.trim()
    if (t) out[key] = t.slice(0, BELIEF_TEXT_MAX)
  }
  return out
}

/** 供 AI 上下文的一行渲染：「世界观：…｜价值观：…」；全空 → 空串 */
export function renderBeliefs(raw: unknown): string {
  const beliefs = normalizeBeliefs(raw)
  return BELIEF_KEYS.filter(({ key }) => beliefs[key])
    .map(({ key, label }) => `${label}：${beliefs[key]}`)
    .join("｜")
}
