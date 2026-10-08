/**
 * 情景试验场：共享常量、类型与规整/渲染函数（纯 TS，客户端组件与服务端服务层共用，零依赖）。
 *
 * 一个试验场 = 配置（角色 cast + 场景 sceneIds + 可选开场 premise）后由 AI 多代理推演剧情：
 * 每个 control:"ai" 的角色一个独立 actor agent，导演 agent 汇总裁定，check agent 一致性把关。
 * ScenarioTurn（聊天回合）是唯一事实来源；主干节点/分镜卡/样文均为派生。
 *
 * cast/beats/checks 均为 Json 快照（含 name，角色改名不回溯、删除后仍可显示）。
 */

/** 参演角色上限（与路由 schema 一致） */
export const SCENARIO_CAST_MAX = 8
/** 参演场景上限（与路由 schema 一致） */
export const SCENARIO_SCENES_MAX = 6
/** 单条言行（say/act/think）字数上限 */
export const SCENARIO_BEAT_TEXT_MAX = 600
/** 单回合 beats 上限（= cast 上限，一人一 beat） */
export const SCENARIO_BEATS_PER_TURN_MAX = SCENARIO_CAST_MAX
/** 单回合时序流水（flow）条目上限 */
export const SCENARIO_FLOW_ITEMS_MAX = 48
/** 流水渲染：最近多少个回合给全文（更早的回合压缩为一句话摘要） */
export const FLOW_RECENT_TURNS = 6
/** 流水渲染总长硬截断（防上下文膨胀） */
export const FLOW_TEXT_MAX = 4000
/** 开场剧情字数上限（与路由 schema 一致） */
export const SCENARIO_PREMISE_MAX = 2000
/** 一致性检查不通过时的最大重演轮数（含首轮） */
export const SCENARIO_CHECK_MAX_ROUNDS = 2

export type ScenarioControl = "ai" | "user"

/** 参演名单成员（ScenarioLab.cast 快照元素） */
export interface ScenarioCastMember {
  characterId: string
  /** 角色名快照 */
  name: string
  /** ai=AI 代理扮演 / user=用户本人扮演（全组至多一人） */
  control: ScenarioControl
}

/** 单条角色言行（ScenarioTurn.beats 元素）：say/act/think 至少其一 */
export interface ScenarioBeat {
  characterId: string
  name: string
  control: ScenarioControl
  /** 说出口的对白 */
  say?: string
  /** 公开的行为动作 */
  act?: string
  /** 内心活动（仅本人与导演可见，其他角色 agent 的流水里被隐藏） */
  think?: string
  /** 此刻情绪（自由短词，如「警惕」「愠怒」） */
  emotion?: string
  source: "ai" | "user"
}

/** 一致性检查记录（ScenarioTurn.checks 元素） */
export interface ScenarioCheckRecord {
  round: number
  ok: boolean
  score: number
  issues: string[]
}

/** 时序流水条目类型：narrative=旁白/场景/情节描述；say/act/think=角色对话/行为/内心 */
export type ScenarioFlowItemKind = "narrative" | "say" | "act" | "think"

/**
 * 时序流水条目（ScenarioTurn.flow 元素）：一个回合的全部内容按发生先后穿插排列——
 * 旁白段与角色言行/内心混排，数组顺序即剧情时间顺序（由导演 agent 编排）。
 * 角色项带 characterId/name 快照；narrative 项不带。角色的情绪标注仍在 beats 上（emotion）。
 */
export interface ScenarioFlowItem {
  kind: ScenarioFlowItemKind
  /** 角色项必带；narrative 项为空 */
  characterId?: string
  /** 角色名快照（角色改名不回溯） */
  name?: string
  content: string
}

const FLOW_ITEM_KINDS = new Set<ScenarioFlowItemKind>(["narrative", "say", "act", "think"])

/** DB Json → 规整后的参演名单：按 characterId 去重（先到先留），至多一个 user（多余的降级 ai），超长截断 */
export function normalizeScenarioCast(json: unknown): ScenarioCastMember[] {
  if (!Array.isArray(json)) return []
  const cast: ScenarioCastMember[] = []
  const seen = new Set<string>()
  let hasUser = false
  for (const raw of json) {
    if (typeof raw !== "object" || raw === null) continue
    const r = raw as Record<string, unknown>
    if (typeof r.characterId !== "string" || !r.characterId) continue
    if (typeof r.name !== "string" || !r.name.trim()) continue
    if (seen.has(r.characterId)) continue
    seen.add(r.characterId)
    let control: ScenarioControl = r.control === "user" ? "user" : "ai"
    if (control === "user") {
      if (hasUser) control = "ai"
      else hasUser = true
    }
    cast.push({ characterId: r.characterId, name: r.name.trim(), control })
    if (cast.length >= SCENARIO_CAST_MAX) break
  }
  return cast
}

/** DB Json → 规整后的回合言行：缺 id/name 或 say/act/think 全空的项丢弃；文本截断；保序 */
export function normalizeScenarioBeats(json: unknown): ScenarioBeat[] {
  if (!Array.isArray(json)) return []
  const beats: ScenarioBeat[] = []
  for (const raw of json) {
    if (typeof raw !== "object" || raw === null) continue
    const r = raw as Record<string, unknown>
    if (typeof r.characterId !== "string" || !r.characterId) continue
    if (typeof r.name !== "string" || !r.name.trim()) continue
    const clip = (v: unknown) =>
      typeof v === "string" && v.trim() ? v.trim().slice(0, SCENARIO_BEAT_TEXT_MAX) : undefined
    const say = clip(r.say)
    const act = clip(r.act)
    const think = clip(r.think)
    if (!say && !act && !think) continue
    beats.push({
      characterId: r.characterId,
      name: r.name.trim(),
      control: r.control === "user" ? "user" : "ai",
      say,
      act,
      think,
      emotion: clip(r.emotion),
      source: r.source === "user" ? "user" : "ai",
    })
    if (beats.length >= SCENARIO_BEATS_PER_TURN_MAX) break
  }
  return beats
}

/** DB Json → 规整后的时序流水：非法 kind/空内容丢弃；narrative 项剥掉角色字段；文本截断；保序 */
export function normalizeScenarioFlow(json: unknown): ScenarioFlowItem[] {
  if (!Array.isArray(json)) return []
  const items: ScenarioFlowItem[] = []
  for (const raw of json) {
    if (typeof raw !== "object" || raw === null) continue
    const r = raw as Record<string, unknown>
    const kind = r.kind as ScenarioFlowItemKind
    if (!FLOW_ITEM_KINDS.has(kind)) continue
    const content = typeof r.content === "string" ? r.content.trim() : ""
    if (!content) continue
    const item: ScenarioFlowItem = { kind, content: content.slice(0, SCENARIO_BEAT_TEXT_MAX) }
    if (kind !== "narrative") {
      if (typeof r.characterId === "string" && r.characterId) item.characterId = r.characterId
      if (typeof r.name === "string" && r.name.trim()) item.name = r.name.trim()
      if (!item.name) continue // 角色项至少要有名字快照，否则无法归属
    }
    items.push(item)
    if (items.length >= SCENARIO_FLOW_ITEMS_MAX) break
  }
  return items
}

/**
 * 导演输出的 flow（角色项用 name 引用）→ 落库形状：
 * 按本回合 beats 的名字快照解析 characterId；名单外的角色项丢弃（宁缺毋假），narrative 项全保留。
 */
export function resolveScenarioFlowNames(
  json: unknown,
  nameToId: ReadonlyMap<string, string>
): ScenarioFlowItem[] {
  const items = normalizeScenarioFlow(json)
  const resolved: ScenarioFlowItem[] = []
  for (const item of items) {
    if (item.kind === "narrative") {
      resolved.push(item)
      continue
    }
    const characterId = item.name ? nameToId.get(item.name) : undefined
    if (!characterId) continue
    resolved.push({ ...item, characterId })
  }
  return resolved
}

/** 从时序流水派生导演叙述全文（narrative 段按序拼接；落 narrative 列供摘要/旧渲染兜底） */
export function scenarioFlowNarrative(flow: ScenarioFlowItem[]): string {
  return flow
    .filter((i) => i.kind === "narrative")
    .map((i) => i.content)
    .join("\n\n")
}

/** 兜底：flow 为空时按 beats 合成固定顺序流水（一人一段：say→act→think），保证回合可渲染 */
export function scenarioFlowFromBeats(beats: ScenarioBeat[]): ScenarioFlowItem[] {
  const items: ScenarioFlowItem[] = []
  for (const b of beats) {
    const base = { characterId: b.characterId, name: b.name }
    if (b.say) items.push({ ...base, kind: "say", content: b.say })
    if (b.act) items.push({ ...base, kind: "act", content: b.act })
    if (b.think) items.push({ ...base, kind: "think", content: b.think })
  }
  return items
}
export function normalizeScenarioChecks(json: unknown): ScenarioCheckRecord[] {
  if (!Array.isArray(json)) return []
  const records: ScenarioCheckRecord[] = []
  for (const raw of json) {
    if (typeof raw !== "object" || raw === null) continue
    const r = raw as Record<string, unknown>
    const issues = Array.isArray(r.issues)
      ? r.issues.filter((i): i is string => typeof i === "string" && i.trim().length > 0)
      : []
    records.push({
      round: typeof r.round === "number" ? r.round : records.length + 1,
      ok: r.ok === true,
      score: typeof r.score === "number" ? r.score : 0,
      issues,
    })
  }
  return records
}

/** 渲染流水所需的最小回合形状（服务层 DTO 与 DB 行都可传入）；id 供节点摘要溯源用 */
export interface ScenarioFlowTurn {
  id?: string
  index: number
  kind: string
  narrative: string
  beats: ScenarioBeat[]
  /** 时序流水（有内容即按序渲染，narrative/beats 退为兜底）；旧回合为空 */
  flow?: ScenarioFlowItem[]
  direction?: string | null
}

/**
 * 渲染共享剧情流水（actor/director/check/prose 四个模板共用）：
 * 最近 recentTurns（默认 FLOW_RECENT_TURNS）回合给全文（导演叙述 + 各角色言行），
 * 更早的回合压缩为一句话（优先用主干节点摘要，否则取叙述前 40 字）；
 * 总长超 maxLength（默认 FLOW_TEXT_MAX）时从最早处截断。
 *
 * viewerCharacterId：actor agent 视角——传入该角色 id 时，**其他角色的内心（think）被隐藏**
 * （信息共享边界：说/做公开，想私有）；不传 = 全知视角（导演/检查/样文用）。
 */
export function renderTurnFlow(
  turns: ScenarioFlowTurn[],
  opts?: {
    viewerCharacterId?: string
    nodeSummaryByTurnId?: ReadonlyMap<string, string>
    recentTurns?: number
    maxLength?: number
  },
): string {
  if (turns.length === 0) return "（尚无剧情）"
  const recentCount = opts?.recentTurns ?? FLOW_RECENT_TURNS
  const maxLength = opts?.maxLength ?? FLOW_TEXT_MAX
  const sorted = [...turns].sort((a, b) => a.index - b.index)
  const recentStart = Math.max(0, sorted.length - recentCount)
  const lines: string[] = []

  for (let i = 0; i < sorted.length; i++) {
    const t = sorted[i]
    if (i < recentStart) {
      const summary = (t.id && opts?.nodeSummaryByTurnId?.get(t.id)) ||
        (t.narrative.trim() ? t.narrative.trim().slice(0, 40) : "（空回合）")
      lines.push(`第${t.index}回合：${summary}`)
      continue
    }
    lines.push(t.kind === "opening" ? `【开场】` : `【第${t.index}回合】`)
    if (t.direction?.trim()) lines.push(`旁白指示：${t.direction.trim()}`)
    if (t.flow && t.flow.length > 0) {
      // 时序流水：旁白段与角色言行/内心按发生先后穿插；他人内心对 viewer 隐藏
      for (const item of t.flow) {
        if (item.kind === "narrative") {
          lines.push(`导演：${item.content}`)
          continue
        }
        if (
          item.kind === "think" &&
          opts?.viewerCharacterId &&
          opts.viewerCharacterId !== item.characterId
        )
          continue
        const label =
          item.kind === "say"
            ? `说：「${item.content}」`
            : item.kind === "act"
              ? `行为：${item.content}`
              : `内心：${item.content}`
        lines.push(`${item.name ?? "？"}　${label}`)
      }
      continue
    }
    // 旧回合兜底：导演叙述在前，角色言行按固定顺序
    if (t.narrative.trim()) lines.push(`导演：${t.narrative.trim()}`)
    for (const b of t.beats) {
      const parts: string[] = []
      if (b.say) parts.push(`说：「${b.say}」`)
      if (b.act) parts.push(`行为：${b.act}`)
      if (b.think && (!opts?.viewerCharacterId || opts.viewerCharacterId === b.characterId))
        parts.push(`内心：${b.think}`)
      if (parts.length > 0) lines.push(`${b.name}　${parts.join("　")}`)
    }
  }

  const text = lines.join("\n")
  if (text.length <= maxLength) return text
  return `……（更早剧情略）\n${text.slice(text.length - maxLength)}`
}
