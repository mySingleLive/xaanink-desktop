/**
 * 角色核心动机：共享常量、类型与工具函数（纯 TS，客户端组件与服务端服务层共用，零依赖）。
 * 核心动机 = 角色所有言行、决策与成长的内在根本驱动力。
 *
 * Character.motivations Json 存有序层数组：第 1 层最表面、末层最根本（洋葱式真相链，
 * 如 打伤警察 → 实为卧底隐藏身份 → 实为双面间谍 → 根本是为父母复仇）；
 * 每层可并列多个动机（生存/赚钱/复仇可同层），每条动机带重要性 importance（1~5，默认 3）。
 * 简单人物一层一条即可。
 */

/** 动机层数上限（与路由 schema 一致） */
export const MOTIVATION_LAYERS_MAX = 6
/** 每层并列动机条数上限（与路由 schema 一致） */
export const MOTIVATION_ITEMS_MAX = 10
/** 单条动机字数上限（与路由 schema 一致） */
export const MOTIVATION_TEXT_MAX = 200
/** 重要性上限（1~5） */
export const MOTIVATION_IMPORTANCE_MAX = 5
/** 重要性默认值（不强制作者摆弄，缺省即中档） */
export const MOTIVATION_IMPORTANCE_DEFAULT = 3

export interface MotivationEntry {
  text: string
  /** 重要性 1~5，默认 3 */
  importance: number
}

export interface MotivationLayer {
  /** 同层并列的多个动机 */
  items: MotivationEntry[]
}

function clampImportance(raw: unknown): number {
  const n = typeof raw === "number" && Number.isFinite(raw) ? Math.round(raw) : MOTIVATION_IMPORTANCE_DEFAULT
  return Math.min(MOTIVATION_IMPORTANCE_MAX, Math.max(1, n))
}

function normalizeEntry(raw: unknown): MotivationEntry | null {
  // 容错：纯字符串条目按单条动机处理（AI 草稿/旧数据）
  if (typeof raw === "string") {
    const text = raw.trim()
    return text ? { text: text.slice(0, MOTIVATION_TEXT_MAX), importance: MOTIVATION_IMPORTANCE_DEFAULT } : null
  }
  if (typeof raw !== "object" || raw === null) return null
  const r = raw as Record<string, unknown>
  if (typeof r.text !== "string" || !r.text.trim()) return null
  return { text: r.text.trim().slice(0, MOTIVATION_TEXT_MAX), importance: clampImportance(r.importance) }
}

/** DB Json / AI 输出 → 规整后的动机层数组（脏数据兜底：空条、空层丢弃；保序） */
export function normalizeMotivations(raw: unknown): MotivationLayer[] {
  if (!Array.isArray(raw)) return []
  const layers: MotivationLayer[] = []
  for (const rawLayer of raw) {
    // 容错：层直接给条目数组时自动包 { items }
    const itemsRaw = Array.isArray(rawLayer)
      ? rawLayer
      : typeof rawLayer === "object" && rawLayer !== null && Array.isArray((rawLayer as Record<string, unknown>).items)
        ? ((rawLayer as Record<string, unknown>).items as unknown[])
        : null
    if (!itemsRaw) continue
    const items = itemsRaw
      .map(normalizeEntry)
      .filter((e): e is MotivationEntry => e !== null)
      .slice(0, MOTIVATION_ITEMS_MAX)
    if (items.length === 0) continue
    layers.push({ items })
    if (layers.length >= MOTIVATION_LAYERS_MAX) break
  }
  return layers
}

/** 层标签：total=1 →「表面」；首层→「第 1 层 · 表面」；末层→「第 N 层 · 根本」；中间→「第 N 层」 */
export function motivationLayerLabel(index: number, total: number): string {
  if (total <= 1) return "表面"
  if (index === 0) return "第 1 层 · 表面"
  if (index === total - 1) return `第 ${total} 层 · 根本`
  return `第 ${index + 1} 层`
}

function renderEntry(e: MotivationEntry): string {
  return e.importance === MOTIVATION_IMPORTANCE_DEFAULT ? e.text : `${e.text}(重要${e.importance})`
}

/**
 * 供 AI 上下文的一行渲染：
 * 「表面：生存(重要5)、赚钱 → 第2层：隐藏卧底身份(重要4) → 根本：为父母复仇(重要5)」
 * 层间「 → 」连接（洋葱式逐层深入），层内多条「、」分隔，importance 仅非常态（≠3）时标注。
 */
export function renderMotivations(raw: unknown): string {
  const layers = normalizeMotivations(raw)
  return layers
    .map((layer, i) => {
      const head = layers.length === 1 ? "表面" : i === 0 ? "表面" : i === layers.length - 1 ? "根本" : `第${i + 1}层`
      return `${head}：${layer.items.map(renderEntry).join("、")}`
    })
    .join(" → ")
}
