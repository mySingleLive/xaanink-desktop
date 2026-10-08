/**
 * 情景试验场面板共享类型：与服务层 DTO 对齐；
 * cast/beats/checks 的规整逻辑转引自 @/lib/scenario-lab（单一来源，勿写第二份）。
 */

import type {
  ScenarioBeat,
  ScenarioCastMember,
  ScenarioCheckRecord,
  ScenarioFlowItem,
} from "@/lib/scenario-lab"

export type { ScenarioBeat, ScenarioCastMember, ScenarioCheckRecord, ScenarioFlowItem }

export interface ScenarioLabRecord {
  id: string
  novelId: string
  title: string
  cast: ScenarioCastMember[]
  sceneIds: string[]
  premise: string
  prose: string
  proseAt: string | null
  /** draft=配置中 / active=已开局 */
  status: string
  createdAt: string
  updatedAt: string
}

export interface ScenarioTurnRecord {
  id: string
  labId: string
  index: number
  /** opening=开局叙述 / beat=推演回合 */
  kind: string
  narrative: string
  beats: ScenarioBeat[]
  /** 时序流水：旁白与角色言/行/内心按发生先后穿插；空数组=旧回合（按 narrative+beats 固定顺序渲染） */
  flow: ScenarioFlowItem[]
  direction: string | null
  checks: ScenarioCheckRecord[]
  createdAt: string
}

export interface ScenarioNodeRecord {
  id: string
  labId: string
  index: number
  text: string
  /** 溯源 ScenarioTurn.id */
  turnId: string | null
  createdAt: string
  updatedAt: string
}

export interface ScenarioCardRecord {
  id: string
  labId: string
  index: number
  /** 溯源 ScenarioNode.id */
  nodeId: string | null
  text: string
  characterIds: string[]
  sceneIds: string[]
  createdAt: string
  updatedAt: string
}

/** GET /api/novels/[id]/scenarios/[labId] 的响应形状 */
export interface ScenarioDetail {
  scenario: ScenarioLabRecord
  turns: ScenarioTurnRecord[]
  nodes: ScenarioNodeRecord[]
  cards: ScenarioCardRecord[]
}

/** GET .../runs 的子代理运行条目（推进过程展开面板用） */
export interface ScenarioRunRecord {
  id: string
  agentKind: string
  task: string
  /** 展示名（扮演者 · X / 导演裁定 / 一致性检查…） */
  label: string
  status: string
  result: unknown
  tokenUsage: { input: number; output: number } | null
  errorMessage: string | null
  createdAt: string
  updatedAt: string
}
