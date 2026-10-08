/**
 * SOP 分层 DAG 单一事实来源（2026-08 graph-engineering SOP）。
 *
 * 本文件是小说创作流程图的唯一权威定义，三处消费、永不漂移：
 *   1. 服务层执行（runner.ts 按 checkpoint 配置跑收敛 loop）
 *   2. admin DAG 线框图（/api/admin/sop 原样输出）
 *   3. chat.system 行为契约（prisma/seed.ts 摘写，注明以本文件为准）
 *
 * 图分三层：L0 整书 loop（novel）⊃ L1 环节 loop（theme…content）⊃ L2 实例 loop
 * （复合节点的 iterate 维度：perCharacter/perSetting/perVolume/perChapter）。
 * 每个带 checkpoint 的节点构成一个收敛 loop：产出 → 检查点 → 达标或达 maxIterations 收敛，
 * 未收敛一律升级作者裁决（上限 + 人工兜底保证收敛，绝无死循环）。
 */

/** 子代理角色（SubAgentRun.agentKind 的取值集合） */
export type SopRoleKind = "editor" | "playwright" | "writer" | "judge" | "reader"

export const SOP_ROLE_LABELS: Record<SopRoleKind, string> = {
  editor: "平台编辑",
  playwright: "剧作家",
  writer: "写手",
  judge: "审稿人",
  reader: "读者",
}

export type SopNodeId =
  | "theme"
  | "world"
  | "character"
  | "setting"
  | "worldline"
  | "narrative"
  | "outline"
  | "content"
  | "novel"

/** loop 驱动方式：auto=服务层单次调用内自动循环；chat=墨影逐轮驱动；author=作者闸门 */
export type SopLoopDriver = "auto" | "chat" | "author"

export interface SopCheckpoint {
  /** 检查点角色（多个为并行 fan-out，分数聚合） */
  roles: SopRoleKind[]
  /** 收敛分数阈值（0-100） */
  threshold: number
  /** 自动 loop 硬上限 */
  maxIterations: number
  driver: SopLoopDriver
  /** 检查点一句话说明（DAG 图注） */
  label: string
}

export interface SopEntryInput {
  key: string
  label: string
  /** false = 可默认（缺失不提问，用合理默认继续） */
  required: boolean
}

export interface SopNode {
  id: SopNodeId
  label: string
  /** 产出物说明（DAG 图注） */
  artifact: string
  /** 产出者：子代理角色 / coBuild 墨影与作者共建 / pipeline 由全部子图产出（L0） */
  producer: SopRoleKind | "coBuild" | "pipeline"
  checkpoint?: SopCheckpoint
  /** 复合节点的 L2 迭代维度；非复合节点为空 */
  iterate?: "perCharacter" | "perSetting" | "perVolume" | "perChapter"
  /** L2 子 loop 一句话（DAG 嵌套子框图注） */
  childrenLabel?: string
  dependsOn: SopNodeId[]
  /** 进入本环节所需的关键信息（规划与持续澄清的依据） */
  entryInputs: SopEntryInput[]
  /** admin DAG 手工布局（网格坐标，客户端换算像素） */
  layout: { x: number; y: number }
}

export interface SopEdge {
  from: SopNodeId
  to: SopNodeId
  /** forward 实线 / revision 修订回边虚线 / escalation 升级点线 */
  type: "forward" | "revision" | "escalation"
  label?: string
}

export const SOP_NODES: SopNode[] = [
  {
    id: "theme",
    label: "主题",
    artifact: "Theme（书名/简介/频道题材/卖点/目标受众）",
    producer: "coBuild",
    checkpoint: {
      roles: ["editor"],
      threshold: 70,
      maxIterations: 3,
      driver: "chat",
      label: "平台编辑市场评估",
    },
    dependsOn: [],
    entryInputs: [
      { key: "genre", label: "频道与题材方向", required: true },
      { key: "targetAudience", label: "目标读者", required: true },
      { key: "sellingPoints", label: "核心卖点/爽点方向", required: true },
      { key: "referenceCases", label: "对标作品", required: false },
    ],
    layout: { x: 0, y: 1 },
  },
  {
    id: "world",
    label: "世界观",
    artifact: "World 树 + description（可多级子世界）",
    producer: "playwright",
    checkpoint: {
      roles: ["judge"],
      threshold: 75,
      maxIterations: 2,
      driver: "auto",
      label: "审稿人·世界一致性",
    },
    dependsOn: ["theme"],
    entryInputs: [
      { key: "worldCount", label: "世界数量与层级意向", required: false },
    ],
    layout: { x: 1, y: 1 },
  },
  {
    id: "character",
    label: "角色",
    artifact: "Character 集合（主角团/配角/反派）",
    producer: "playwright",
    checkpoint: {
      roles: ["judge"],
      threshold: 75,
      maxIterations: 2,
      driver: "auto",
      label: "审稿人·阵容整体",
    },
    iterate: "perCharacter",
    childrenLabel: "每个角色：剧作家产出 → 审稿人检查 ↺≤2",
    dependsOn: ["world"],
    entryInputs: [
      { key: "castSize", label: "角色数量", required: false },
      { key: "protagonist", label: "主角配置（人设方向/金手指意向）", required: true },
    ],
    layout: { x: 2, y: 0 },
  },
  {
    id: "setting",
    label: "设定",
    artifact: "Setting 集合（体系/概念/势力/地图/金手指/文风）",
    producer: "playwright",
    checkpoint: {
      roles: ["judge"],
      threshold: 75,
      maxIterations: 2,
      driver: "auto",
      label: "审稿人·设定自洽",
    },
    iterate: "perSetting",
    childrenLabel: "每条设定：剧作家产出 → 审稿人检查 ↺≤2",
    dependsOn: ["world"],
    entryInputs: [
      { key: "categories", label: "需要哪些设定类目", required: false },
    ],
    layout: { x: 2, y: 2 },
  },
  {
    id: "worldline",
    label: "世界线",
    artifact: "PlanningDocument 世界线与事件",
    producer: "playwright",
    checkpoint: {
      roles: ["judge"],
      threshold: 75,
      maxIterations: 2,
      driver: "chat",
      label: "审稿人·世界线覆盖",
    },
    dependsOn: ["setting"],
    entryInputs: [],
    layout: { x: 3, y: 0 },
  },
  {
    id: "narrative",
    label: "叙事线",
    artifact: "主叙事线卡片树",
    producer: "playwright",
    checkpoint: {
      roles: ["judge"],
      threshold: 75,
      maxIterations: 2,
      driver: "chat",
      label: "审稿人·叙事线覆盖",
    },
    dependsOn: ["setting"],
    entryInputs: [],
    layout: { x: 3, y: 2 },
  },
  {
    id: "outline",
    label: "大纲",
    artifact: "Volume.summary + Chapter.outline",
    producer: "playwright",
    checkpoint: {
      roles: ["judge"],
      threshold: 75,
      maxIterations: 3,
      driver: "chat",
      label: "审稿人·大纲（复用现有评审链路）",
    },
    iterate: "perVolume",
    childrenLabel: "每卷：框架 → 卷级评审 ↺",
    dependsOn: ["character", "setting"],
    entryInputs: [
      { key: "volumePlan", label: "卷数/每卷章数/单章字数意向", required: false },
    ],
    layout: { x: 3, y: 1 },
  },
  {
    id: "content",
    label: "正文",
    artifact: "Chapter.content（按章循环）",
    producer: "writer",
    checkpoint: {
      roles: ["judge", "reader"],
      threshold: 75,
      maxIterations: 2,
      driver: "author",
      label: "审稿人 + 读者团×3 并行（聚合均分）",
    },
    iterate: "perChapter",
    childrenLabel: "每章：写手 → 审稿人 + 读者×3 → 汇报，作者点头才修订",
    dependsOn: ["outline"],
    entryInputs: [
      { key: "outlineApproved", label: "本章大纲已经作者确认（正文闸门）", required: true },
      { key: "wordCount", label: "目标字数", required: false },
    ],
    layout: { x: 4, y: 1 },
  },
  {
    id: "novel",
    label: "整书",
    artifact: "整书效果（L0 最外层 loop）",
    producer: "pipeline",
    checkpoint: {
      roles: ["editor", "judge"],
      threshold: 75,
      maxIterations: 1,
      driver: "author",
      label: "总编面板（市场 + 整体质量）",
    },
    dependsOn: ["content"],
    entryInputs: [],
    layout: { x: 5, y: 1 },
  },
]

export const SOP_EDGES: SopEdge[] = [
  { from: "theme", to: "world", type: "forward" },
  { from: "world", to: "character", type: "forward" },
  { from: "world", to: "setting", type: "forward" },
  { from: "character", to: "outline", type: "forward" },
  { from: "setting", to: "worldline", type: "forward" },
  { from: "worldline", to: "narrative", type: "forward" },
  { from: "narrative", to: "outline", type: "forward" },
  { from: "setting", to: "outline", type: "forward" },
  { from: "outline", to: "content", type: "forward" },
  { from: "content", to: "novel", type: "forward" },
  // 修订回边（虚线）：检查点 → 产出节点，收敛条件 = ≥阈值 ∨ 达上限 ∨ 作者拍板
  { from: "theme", to: "theme", type: "revision", label: "≥70 ∨ 3轮 ∨ 拍板" },
  { from: "world", to: "world", type: "revision", label: "≥75 ∨ 2轮 ∨ 拍板" },
  { from: "character", to: "character", type: "revision", label: "≥75 ∨ 2轮 ∨ 拍板" },
  { from: "setting", to: "setting", type: "revision", label: "≥75 ∨ 2轮 ∨ 拍板" },
  { from: "worldline", to: "worldline", type: "revision", label: "≥75 ∨ 2轮 ∨ 拍板" },
  { from: "narrative", to: "narrative", type: "revision", label: "≥75 ∨ 2轮 ∨ 拍板" },
  { from: "outline", to: "outline", type: "revision", label: "≥75 ∨ 3轮 ∨ 拍板" },
  { from: "content", to: "content", type: "revision", label: "≥75 ∨ 2轮 ∨ 拍板" },
  // L0 反馈路由：整书评审 findings 按 targetNode 路由回内层环节
  { from: "novel", to: "theme", type: "revision", label: "按 findings 路由" },
  { from: "novel", to: "world", type: "revision", label: "按 findings 路由" },
  { from: "novel", to: "character", type: "revision", label: "按 findings 路由" },
  { from: "novel", to: "setting", type: "revision", label: "按 findings 路由" },
  { from: "novel", to: "outline", type: "revision", label: "按 findings 路由" },
  { from: "novel", to: "content", type: "revision", label: "按 findings 路由" },
]

// ---------------------------------------------------------------------------
// 意图路由表：用户大白话 → SOP 环节/实例 / 直接修改旁路 / 自由应答。
// 路由执行者是墨影（chat.system 意图路由纪律摘写本表），本表是唯一来源。
// ---------------------------------------------------------------------------

export type IntentRouteTarget =
  | { type: "node"; nodeId: SopNodeId; granularity: "stage" | "instance" }
  | { type: "direct-edit" }
  | { type: "free" }

export interface IntentRoute {
  intent: string
  examples: string[]
  route: IntentRouteTarget
  note?: string
}

export const INTENT_ROUTES: IntentRoute[] = [
  {
    intent: "开新书/主题共创",
    examples: ["我想写一本……", "帮我构思个故事", "写一本类似《XX》的书"],
    route: { type: "node", nodeId: "theme", granularity: "stage" },
    note: "进入规划阶段：查 entryInputs → 缺信息先问 → 建 ToDo List",
  },
  {
    intent: "市场评估/方向把关",
    examples: ["这个题材有市场吗", "帮我看看这个方向值不值得写"],
    route: { type: "node", nodeId: "theme", granularity: "stage" },
    note: "召唤平台编辑（assessThemeMarket）",
  },
  {
    intent: "搭建/重做世界观",
    examples: ["帮我搭世界观", "设计一下世界背景", "世界观重写"],
    route: { type: "node", nodeId: "world", granularity: "stage" },
  },
  {
    intent: "搭建角色阵容",
    examples: ["帮我设计几个角色", "把主角团建起来"],
    route: { type: "node", nodeId: "character", granularity: "stage" },
  },
  {
    intent: "重做单个角色",
    examples: ["这个角色太扁平了", "把XX重做一下"],
    route: { type: "node", nodeId: "character", granularity: "instance" },
  },
  {
    intent: "搭建/重做设定",
    examples: ["设计力量体系", "完善一下设定", "金手指重新想一个"],
    route: { type: "node", nodeId: "setting", granularity: "stage" },
  },
  {
    intent: "搭建/重做大纲",
    examples: ["帮我列大纲", "规划第一卷", "这一卷大纲重来"],
    route: { type: "node", nodeId: "outline", granularity: "stage" },
  },
  {
    intent: "写/重写正文",
    examples: ["写第3章", "开始写正文", "这一章重写"],
    route: { type: "node", nodeId: "content", granularity: "instance" },
    note: "受正文闸门约束：大纲未经作者确认不可生成",
  },
  {
    intent: "评审/试读正文",
    examples: ["帮我评审这一章", "读者会喜欢这段吗"],
    route: { type: "node", nodeId: "content", granularity: "instance" },
    note: "召唤审稿人/读者团（requestAIReview/requestReaderReview）",
  },
  {
    intent: "整书审视",
    examples: ["整体看看这本书怎么样", "帮我从市场角度把这本书把把关"],
    route: { type: "node", nodeId: "novel", granularity: "stage" },
    note: "L0 整书面板（reviewWholeNovel），高成本须作者点头",
  },
  {
    intent: "指明的小改动（旁路）",
    examples: ["把XX的名字改一下", "设定里的年龄改成18", "这句话删掉"],
    route: { type: "direct-edit" },
    note: "现有写工具直改，不进 loop，不建计划",
  },
  {
    intent: "闲聊/问答/进度咨询（不进 SOP）",
    examples: ["聊聊", "这个角色现在是怎么设定的？", "我这本书进行到哪了？"],
    route: { type: "free" },
    note: "读工具应答，不强行拉入 SOP",
  },
]

// ---------------------------------------------------------------------------

const NODE_IDS = new Set(SOP_NODES.map((n) => n.id))

/** 模块加载时校验图定义：坏图直接抛错，不许带伤运行 */
export function validateSopGraph(): void {
  if (NODE_IDS.size !== SOP_NODES.length) {
    throw new Error("[sop] 节点 id 重复")
  }
  for (const node of SOP_NODES) {
    for (const dep of node.dependsOn) {
      if (!NODE_IDS.has(dep)) throw new Error(`[sop] ${node.id} 依赖不存在的节点 ${dep}`)
      if (dep === node.id) throw new Error(`[sop] ${node.id} 自依赖`)
    }
    if (node.checkpoint) {
      if (node.checkpoint.threshold < 0 || node.checkpoint.threshold > 100) {
        throw new Error(`[sop] ${node.id} 阈值越界`)
      }
      if (node.checkpoint.maxIterations < 1) {
        throw new Error(`[sop] ${node.id} maxIterations 必须 ≥1（收敛硬保证）`)
      }
    }
  }
  // forward 边无环（拓扑排序）
  const indegree = new Map<SopNodeId, number>()
  for (const n of SOP_NODES) indegree.set(n.id, 0)
  for (const e of SOP_EDGES) {
    if (e.type !== "forward") continue
    if (!NODE_IDS.has(e.from) || !NODE_IDS.has(e.to)) {
      throw new Error(`[sop] 边 ${e.from}->${e.to} 引用了不存在的节点`)
    }
    indegree.set(e.to, (indegree.get(e.to) ?? 0) + 1)
  }
  const queue = SOP_NODES.map((n) => n.id).filter((id) => (indegree.get(id) ?? 0) === 0)
  let visited = 0
  while (queue.length > 0) {
    const id = queue.pop()!
    visited++
    for (const e of SOP_EDGES) {
      if (e.type !== "forward" || e.from !== id) continue
      const d = (indegree.get(e.to) ?? 0) - 1
      indegree.set(e.to, d)
      if (d === 0) queue.push(e.to)
    }
  }
  if (visited !== SOP_NODES.length) throw new Error("[sop] forward 边成环")
  // 路由表目标存在
  for (const r of INTENT_ROUTES) {
    if (r.route.type === "node" && !NODE_IDS.has(r.route.nodeId)) {
      throw new Error(`[sop] 意图「${r.intent}」路由到不存在的节点`)
    }
  }
  // 布局坐标唯一
  const coords = new Set(SOP_NODES.map((n) => `${n.layout.x},${n.layout.y}`))
  if (coords.size !== SOP_NODES.length) throw new Error("[sop] 布局坐标重复")
}

validateSopGraph()

export function getSopNode(id: SopNodeId): SopNode {
  const node = SOP_NODES.find((n) => n.id === id)
  if (!node) throw new Error(`[sop] 未知节点 ${id}`)
  return node
}

/** 环节评审策略：ai=检查点模型打分；structure-only=只做结构检查，达标即提交作者确认（2026-09 W3 评审精简） */
export type StoryReviewPolicy = "ai" | "structure-only"

/** 面向作者的六环节；可自由进入，完成证据由 story-workflow 服务验证。plot 挂世界线+叙事线双检查点。 */
export const STORY_PHASES = [
  { id: "brainstorm", label: "脑洞", checkpointNodes: ["theme"], dependsOn: [], reviewPolicy: "structure-only" },
  { id: "settings", label: "设定", checkpointNodes: ["setting"], dependsOn: ["brainstorm"], reviewPolicy: "ai" },
  { id: "plot", label: "剧情搭建", checkpointNodes: ["worldline", "narrative"], dependsOn: ["settings"], reviewPolicy: "ai" },
  { id: "outline", label: "卷章大纲", checkpointNodes: ["outline"], dependsOn: ["plot"], reviewPolicy: "ai" },
  { id: "writing", label: "生成正文", checkpointNodes: ["content"], dependsOn: ["outline"], reviewPolicy: "ai" },
  { id: "revision", label: "优化改进", checkpointNodes: ["novel"], dependsOn: ["writing"], reviewPolicy: "ai" },
] as const satisfies ReadonlyArray<{ id: string; label: string; checkpointNodes: readonly SopNodeId[]; dependsOn: readonly string[]; reviewPolicy: StoryReviewPolicy }>
export type StoryPhase = typeof STORY_PHASES[number]["id"]
export function storyPhaseDefinition(id: StoryPhase) {
  const phase = STORY_PHASES.find(p => p.id === id)!
  return { ...phase, checkpoints: phase.checkpointNodes.map(node => getSopNode(node).checkpoint!) }
}
