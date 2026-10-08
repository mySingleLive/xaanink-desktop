/**
 * Big Five 性格五维：人格主结构的数值化（开放性/尽责性/外向性/宜人性/神经质，各 0~100）。
 * 存储为 Character.bigFive Json（null = 未评估，不渲染进 AI 上下文），
 * 与 Character.personalityTags（离散短词）分工：五维是性格骨架（驱动角色言行基调，
 * 冲突时以五维为准），标签是具体风味的补充；滑杆给主结构强度，标签给具象词。
 * 本模块是规整逻辑的唯一来源（纯 TS，客户端组件与服务端服务层共用，零依赖）。
 */

/** 五维取值下限/上限 */
export const BIG_FIVE_MIN = 0
export const BIG_FIVE_MAX = 100
/** 未评估时滑杆的展示中值（不落库，首次拨动才持久化） */
export const BIG_FIVE_NEUTRAL = 50
/** 极性注解阈值：≤LOW 取低端描述、≥HIGH 取高端描述、中间不注解（避免噪音） */
export const BIG_FIVE_POLE_LOW = 35
export const BIG_FIVE_POLE_HIGH = 65

export interface BigFive {
  /** 开放性：低=务实守常，高=好奇求新 */
  openness: number
  /** 尽责性：低=随性散漫，高=自律有条理 */
  conscientiousness: number
  /** 外向性：低=孤僻安静，高=热情健谈 */
  extraversion: number
  /** 宜人性：低=多疑对抗，高=信任利他 */
  agreeableness: number
  /** 神经质：低=沉稳淡定，高=敏感焦虑 */
  neuroticism: number
}

export type BigFiveKey = keyof BigFive

/** 五维定义（顺序即面板与渲染顺序） */
export const BIG_FIVE_DIMENSIONS: { key: BigFiveKey; label: string; low: string; high: string }[] = [
  { key: "openness", label: "开放性", low: "务实守常", high: "好奇求新" },
  { key: "conscientiousness", label: "尽责性", low: "随性散漫", high: "自律条理" },
  { key: "extraversion", label: "外向性", low: "孤僻安静", high: "热情健谈" },
  { key: "agreeableness", label: "宜人性", low: "多疑对抗", high: "信任利他" },
  { key: "neuroticism", label: "神经质", low: "沉稳淡定", high: "敏感焦虑" },
]

function clampValue(raw: unknown): number | null {
  const n = typeof raw === "number" && Number.isFinite(raw) ? Math.round(raw) : null
  if (n === null) return null
  return Math.min(BIG_FIVE_MAX, Math.max(BIG_FIVE_MIN, n))
}

/** DB Json / AI 输出 → 规整后的五维对象（坏键丢弃、越界 clamp；无任何有效维度 → null） */
export function normalizeBigFive(raw: unknown): BigFive | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const out = {} as Record<BigFiveKey, number>
  let found = 0
  for (const { key } of BIG_FIVE_DIMENSIONS) {
    const v = clampValue(r[key])
    if (v !== null) {
      out[key] = v
      found++
    }
  }
  if (found === 0) return null
  // 缺维度补中值，保证五维完整（滑杆与渲染都按五项处理）
  for (const { key } of BIG_FIVE_DIMENSIONS) {
    if (out[key] === undefined) out[key] = BIG_FIVE_NEUTRAL
  }
  return out as BigFive
}

/**
 * 供 AI 上下文的一行渲染，带极性注解（数字后追加该极的端点描述，让模型拿到行为锚点）：
 * 「开放性 80（好奇求新） · 尽责性 50 · 外向性 30（孤僻安静）」；未评估 → 空串。
 * 注解追加在数字之后，消费方按前缀匹配「开放性 80」不受影响。
 */
export function renderBigFive(raw: unknown): string {
  const bigFive = normalizeBigFive(raw)
  if (!bigFive) return ""
  return BIG_FIVE_DIMENSIONS.map(({ key, label, low, high }) => {
    const v = bigFive[key]
    const pole = v <= BIG_FIVE_POLE_LOW ? low : v >= BIG_FIVE_POLE_HIGH ? high : ""
    return pole ? `${label} ${v}（${pole}）` : `${label} ${v}`
  }).join(" · ")
}
