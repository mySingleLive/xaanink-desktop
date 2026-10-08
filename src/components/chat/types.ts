import type { StoryTaskNavigation } from "@/lib/story-task"
/** 前端消息视图模型与工具展示元数据（与服务端 UI message stream / Message.toolCalls 结构对应） */

import {
  BookOpen,
  ClipboardCheck,
  Drama,
  FileText,
  Flag,
  GitBranch,
  HelpCircle,
  Image,
  Layers,
  ListChecks,
  ListTree,
  MessageSquare,
  PenLine,
  Radar,
  Save,
  Share2,
  Sparkles,
  Trash2,
  TrendingUp,
  Undo2,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react"

import { WRITE_TOOL_NAMES } from "@/lib/ai/tool-names"
import { isInternalToolErrorCode } from "@/lib/ai/error-classification"
import { SETTING_TYPE_LABELS } from "@/lib/setting-types"

import { toolOperationKey, type ChatPart } from "@/lib/chat-parts"
import type { StagedBatchPayload } from "@/lib/staged-save"
import type { CostEstimate } from "./cost-estimate"

export type ToolCallStatus = "running" | "done" | "error" | "unknown"

export interface ToolCallView {
  toolCallId: string
  toolName: string
  input: unknown
  output: unknown
  status: ToolCallStatus
}

/** 隐藏通用创作失败提示及已恢复的失败行；原始审计与回合终态不变。 */
export function visibleToolCalls(calls: ToolCallView[]): ToolCallView[] {
  const succeeded = new Set<string>()
  const hidden = new Set<string>()
  for (let i = calls.length - 1; i >= 0; i--) {
    const call = calls[i], key = toolOperationKey(call)
    const output = call.output as { ok?: boolean; committed?: boolean } | null
    if (call.status === "done" && output != null && output.ok !== false && output.committed !== false) succeeded.add(key)
    else if (call.status === "error" && succeeded.has(key)) hidden.add(call.toolCallId)
  }
  return calls.filter(call => !hidden.has(call.toolCallId) && !(call.status === "error" && toolOutcomeOf(call.output)?.code === "STORY_OPERATION_FAILED"))
}

export interface ChatMessageView {
  id: string
  role: "user" | "assistant"
  content: string
  toolCalls: ToolCallView[]
  interaction?: import("@/lib/chat-protocol").ChatInteraction | null
  liveRuns?: Array<{ runId: string; agentKind: string; task: string; stage: string; startedAt: string }>
  savedEffects?: Array<{ targetModel: string; targetId: string | null; operation: string; receipt: unknown }>
  canRetry?: boolean
  canResume?: boolean
  parts?: ChatPart[]
  stage?: string
  attemptId?: string
  turnId?: string
  streaming?: boolean
  /** 三阶段保存：本条用户消息携带的暂存批次（历史气泡芯片与悬停明细；由 turn.action 解析，不落库于消息体） */
  stagedBatches?: StagedBatchPayload[]
  startedAt?: number
  endedAt?: number
  workedSeconds?: number
  /** 同作品近期成功回合的时长均值（W4 进度卡估时；服务端 getChatTurn/回合起步事件给出，无数据缺省） */
  estimateMs?: number
  status?: "running" | "waiting_user" | "succeeded" | "failed" | "interrupted"
  errorCode?: string
  hasWriteEffects?: boolean
  /** 模型推理流（§7.2 思考行）：仅支持 reasoning 的 provider 会产生；会话内有效（不落库） */
  thinking?: ThinkingView
  /** 本轮各步累计消耗（input+output tokens = 墨滴；§4.2 Worked 行「约 N 墨滴」结算后缀）。仅会话内有效，不落库 */
  roundUsage?: number
  /** 本轮生成失败时的错误信息（仅前端会话内展示，toast 之外的持久标记） */
  error?: string
  /**
   * 网络重试状态（仅流式轮会话内存在，不落库）：服务端网络重试时（请求层=单次
   * 调用重发 / 整轮层=整轮流式重跑，见 lib/ai/network-retry.ts）经 data-network-retry
   * 置为 { attempt, maxRetries }，锚点行展示「网络重试 N/M」（Wifi 图标）；
   * 新一轮内容到达（text/reasoning/tool）或流结束时清除。
   */
  networkRetry?: NetworkRetryView
}

/** 网络重试状态：attempt=当前第几次重试（1 起），maxRetries=最大重试次数（后台配置） */
export interface NetworkRetryView {
  attempt: number
  maxRetries: number
}

/** 思考过程视图：text 为推理全文；active=仍在流出；durationSec 为定格后的思考时长 */
export interface ThinkingView {
  text: string
  startedAt: number | null
  durationSec: number | null
  active: boolean
}

/** 参谋发起的待回答问题（askUserQuestion 工具入参，前端问答面板据此渲染） */
export interface PendingQuestionItem {
  question: string
  options: string[]
}

/** 抽卡后的选稿问答定位（服务端在同轮检测到成功抽卡后附加，仅单问题）：面板据此注入换一批选项 */
export interface DrawRedrawContext {
  drawId: string
  chapterId: string
  chapterTitle: string
}

/** 选项序号风格：letters=A/B/C、numbers=1/2/3、stems=甲/乙/丙（由模型调用工具时选择） */
export type QuestionMarkerStyle = "letters" | "numbers" | "stems"

export interface PendingQuestion {
  storyNavigation?: StoryTaskNavigation;
  interaction?: { turnId: string; id: string; revision: number; action: "answer" }
  questions: PendingQuestionItem[]
  /** 选项序号风格；模型未指定时回退 letters */
  markerStyle: QuestionMarkerStyle
  /** 高成本操作确认的消耗预估（§2.6）；普通提问无此字段 */
  costEstimate?: CostEstimate
  /** 抽卡后的选稿问答定位（服务端附加）；存在且单问题后面板注入「直接换一批 / 根据要求换一批」 */
  drawRedraw?: DrawRedrawContext
}

/** 工具执行统一返回（服务端写工具）；部分工具附带结构化字段供前端拼量化摘要（§2.1/§4.1） */
export interface ToolOutcome {
  ok: boolean
  message: string
  /** wire 透传错误码（W6）：ChatProtocolError.code / TOOL_INPUT_INVALID / TOOL_FAILED 等 */
  code?: string
  /** 实现细节类失败（W6 受众分级）：默认视图只显中性文案，技术原文留在展开区 */
  internal?: boolean
  wordCount?: number
  volumeId?: string
  chapterId?: string
  commentId?: string
  reviewId?: string
}

/** 从工具返回识别 ToolOutcome（带 ok 字段的对象） */
export function toolOutcomeOf(output: unknown): ToolOutcome | null {
  return output && typeof output === "object" && "ok" in output ? (output as ToolOutcome) : null
}

/**
 * 内部摩擦失败判定（W6）：返回 internal:true 或 code 命中实现细节码集合的失败。
 * askUserQuestion 的入参失败（问题未能生成）是作者需知的业务反馈，不折叠降噪。
 */
export function isInternalToolCall(toolName: string, output: unknown): boolean {
  const outcome = toolOutcomeOf(output)
  if (!outcome || outcome.ok !== false || toolName === "askUserQuestion") return false
  return outcome.internal ?? isInternalToolErrorCode(outcome.code)
}

/** internal 失败的中性摘要（默认行；技术原文保留在展开区） */
export const INTERNAL_FAILURE_SUMMARY = "内部步骤未完成"

/** 工具行类型图标（§3.5）：与 TOOL_LABELS 并列，按工具类别取 lucide 图标 */
export const TOOL_ICONS: Record<string, LucideIcon> = {
  getNovelPlanning: ListTree, getNarrativeChapter: ListTree, proposeNovelPlanning: Sparkles,
  getStoryWorkflow: Workflow, updateStoryWorkflow: Workflow, reopenStoryPhase: GitBranch,
  reviewStoryCheckpoint: ClipboardCheck, requestStoryApproval: HelpCircle, completeStoryTask: HelpCircle, generateCharacterArc: GitBranch, requestContentApproval: HelpCircle, requestStoryRemoval: HelpCircle, listStoryRemovals: BookOpen, restoreStoryStructure: GitBranch, generateStoryChapters: PenLine, startNovelFromChat: BookOpen, getStoryArtifact: BookOpen,
  linkStoryArtifacts: GitBranch, unlinkStoryArtifacts: GitBranch, getStoryImpact: GitBranch, getStorySources: BookOpen,
  proposePlan: ListChecks,
  // 读取
  getNovelOverview: BookOpen,
  getNovelContext: BookOpen,
  getWorlds: BookOpen,
  getSetting: BookOpen,
  getCharacter: BookOpen,
  getOutline: BookOpen,
  getChapterContent: BookOpen,
  listCharacters: BookOpen,
  listReviews: BookOpen,
  getScoreReport: ClipboardCheck,
  listTropes: BookOpen,
  listItems: BookOpen,
  listScenes: BookOpen,
  getSceneContext: BookOpen,
  listAttributes: BookOpen,
  // 写入/更新
  upsertTheme: PenLine,
  updateWorld: PenLine,
  upsertSetting: PenLine,
  updateCharacter: PenLine,
  updateItem: PenLine,
  updateScene: PenLine,
  upsertAttribute: PenLine,
  selectTrope: PenLine,
  updateVolumeOutline: PenLine,
  updateChapterOutline: PenLine,
  writeChapterContent: PenLine,
  improveChapterContent: PenLine,
  getChapterFinalizationChecklist: ClipboardCheck,
  checkChapterNarrative: ListTree,
  getChapterCandidates: Layers,
  drawChapterCandidates: Layers,
  revertChapterReplacement: Undo2,
  generateChapterContent: FileText,
  // 创建
  createWorld: Sparkles,
  createCharacter: Sparkles,
  createItem: Sparkles,
  createScene: Sparkles,
  createCustomTrope: Sparkles,
  createVolume: Sparkles,
  createChapter: Sparkles,
  // 出图
  generateCharacterImage: Image,
  generateNovelCover: Image,
  // 评审/确认
  requestAIReview: ClipboardCheck,
  requestReaderReview: BookOpen,
  approveOutline: ClipboardCheck,
  finalizeChapter: ClipboardCheck,
  // 结构
  generateOutline: GitBranch,
  // 评论 / 提问
  addTextComment: MessageSquare,
  handleTextComment: MessageSquare,
  listTextComments: MessageSquare,
  askUserQuestion: HelpCircle,
  // SOP 编排（2026-08）
  getSopStatus: Workflow,
  createSopPlan: ListChecks,
  updateSopPlan: ListChecks,
  assessThemeMarket: TrendingUp,
  summonPlaywright: Drama,
  reviewWholeNovel: Users,
  // 伏笔
  createForeshadowCharacter: Sparkles,
  listForeshadows: Flag,
  getForeshadow: Flag,
  createForeshadow: Flag,
  updateForeshadow: PenLine,
  deleteForeshadow: Trash2,
  addForeshadowTouch: Flag,
  removeForeshadowTouch: Trash2,
  analyzeStagedImpact: Radar,
  commitStagedChanges: Save,
  triggerCascadeRevision: Share2,
  // 删除
  deleteCharacter: Trash2,
  deleteItem: Trash2,
  deleteScene: Trash2,
  deleteAttribute: Trash2,
  deleteCustomTrope: Trash2,
  deleteSetting: Trash2,
  deleteWorld: Trash2,
}

/** 工具行图标回退：TOOL_ICONS 未覆盖的工具用 Wrench（在 ToolCallCard 中查表） */

export const TOOL_LABELS: Record<string, string> = {
  getNovelPlanning: "读取世界线与叙事线", getNarrativeChapter: "读取卷章投影", proposeNovelPlanning: "提出剧情规划建议",
  loadCreationTools: "准备创作工具",
  getStoryWorkflow: "读取创作进度", updateStoryWorkflow: "保存创作进度", reopenStoryPhase: "重新设计",
  reviewStoryCheckpoint: "创作检查点评审", requestStoryApproval: "请作者审核", completeStoryTask: "选择下一步", generateCharacterArc: "生成角色弧线", requestContentApproval: "请作者确认正文", requestStoryRemoval: "确认移除范围", listStoryRemovals: "查看回收记录", restoreStoryStructure: "恢复创作内容", generateStoryChapters: "生成并评审章节", startNovelFromChat: "创建小说", getStoryArtifact: "读取创作内容",
  linkStoryArtifacts: "关联故事来源", unlinkStoryArtifacts: "解除来源关联", getStoryImpact: "分析关联影响", getStorySources: "查看故事来源",
  proposePlan: "准备计划提案",
  askUserQuestion: "询问用户",
  getNovelOverview: "查看小说概览",
  getNovelContext: "读取完整上下文",
  getWorlds: "查看世界树",
  getSetting: "读取设定",
  getCharacter: "读取角色",
  getOutline: "读取大纲",
  getChapterContent: "读取章节正文",
  listCharacters: "查看角色列表",
  listReviews: "查看评审记录",
  getScoreReport: "查看评分报告",
  listTropes: "查看爽点/泪点库",
  upsertTheme: "更新主题",
  createWorld: "创建世界",
  updateWorld: "更新世界",
  upsertSetting: "保存设定",
  createCharacter: "创建角色",
  updateCharacter: "更新角色",
  deleteCharacter: "删除角色",
  generateCharacterImage: "生成角色头像/立绘",
  generateNovelCover: "生成小说封面",
  selectTrope: "选中爽点/泪点",
  listItems: "查看物品",
  listScenes: "查看场景",
  getSceneContext: "读取场景层级与资料",
  listAttributes: "查看属性定义",
  createItem: "创建物品",
  updateItem: "更新物品",
  deleteItem: "删除物品",
  createScene: "创建场景",
  updateScene: "更新场景",
  deleteScene: "删除场景",
  upsertAttribute: "保存属性定义",
  deleteAttribute: "删除属性定义",
  createCustomTrope: "创建自定义爽点/泪点",
  deleteCustomTrope: "删除自定义爽点/泪点",
  deleteSetting: "删除设定",
  deleteWorld: "删除世界",
  generateOutline: "生成大纲",
  createVolume: "创建分卷",
  updateVolumeOutline: "更新卷大纲",
  createChapter: "创建章节",
  updateChapterOutline: "更新章大纲",
  approveOutline: "确认大纲通过",
  checkChapterNarrative: "检查叙事卡",
  getChapterCandidates: "读取候选稿",
  drawChapterCandidates: "正文抽卡",
  revertChapterReplacement: "撤回换用",
  generateChapterContent: "生成章节正文",
  writeChapterContent: "写入章节正文",
  improveChapterContent: "改进正文候选",
  getChapterFinalizationChecklist: "读取定稿检查",
  finalizeChapter: "确认正文定稿",
  requestAIReview: "AI 评审",
  requestReaderReview: "读者团试读",
  addTextComment: "添加行内评论",
  handleTextComment: "处理行内评论",
  listTextComments: "查看行内评论",
  getSopStatus: "查看 SOP 流程状态",
  createSopPlan: "建立创作计划",
  updateSopPlan: "更新创作计划",
  assessThemeMarket: "平台编辑评估",
  summonPlaywright: "召唤剧作家",
  reviewWholeNovel: "整书审视",
  createForeshadowCharacter: "登记伏笔角色",
  listForeshadows: "查看伏笔",
  getForeshadow: "读取伏笔",
  createForeshadow: "登记伏笔",
  updateForeshadow: "更新伏笔",
  deleteForeshadow: "删除伏笔",
  addForeshadowTouch: "挂伏笔触点",
  removeForeshadowTouch: "移除伏笔触点",
  analyzeStagedImpact: "分析修改影响面",
  commitStagedChanges: "落库面板修改",
  triggerCascadeRevision: "级联修订相关章节",
}

/** 会改动小说数据的写工具：成功后需刷新右侧内容区缓存（名单见 lib/ai/tool-names.ts） */
export const WRITE_TOOLS = WRITE_TOOL_NAMES

export function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? name
}

/** 工具详情展开区的字段名中文化（§3.11 字段化呈现：label 不展示英文参数名），未收录的键原样显示 */
export const FIELD_LABELS: Record<string, string> = {
  // 通用标识
  id: "ID",
  name: "名称",
  newName: "新名称",
  title: "标题",
  type: "类型",
  kind: "类型",
  index: "序号",
  status: "状态",
  code: "错误码",
  // 关联 id
  chapterId: "章节 ID",
  volumeId: "卷 ID",
  characterId: "角色 ID",
  itemId: "物品 ID",
  sceneId: "场景 ID",
  worldId: "世界 ID",
  commentId: "评论 ID",
  reviewId: "评审 ID",
  // 内容字段
  description: "描述",
  content: "内容",
  outline: "大纲",
  summary: "摘要",
  prompt: "提示词",
  genre: "流派",
  tags: "标签",
  wordCount: "字数",
  // 角色
  gender: "性别",
  age: "年龄",
  occupation: "身份",
  roleType: "定位",
  aliases: "别名",
  bio: "角色简介",
  personality: "人物描述",
  personalityTags: "性格",
  appearance: "外貌",
  height: "身高",
  weight: "体重",
  build: "身材",
  faceShape: "脸型",
  clothing: "穿衣风格",
  tastes: "品味偏好",
  habits: "行为习惯",
  background: "背景",
  catchphrase: "口头禅",
  dialogueStyle: "对话风格",
  sampleDialogue: "示例对话",
  desires: "核心欲望",
  fears: "核心恐惧",
  beliefs: "观念",
  bigFive: "性格五维",
  abilities: "能力",
  backstory: "出场前经历",
  arcStages: "阶段弧线",
  relationships: "关系",
  target: "对象角色",
  arc: "成长弧线",
  growthArc: "成长弧线",
  motivations: "核心动机",
  importance: "重要性",
  // 世界/设定
  world: "世界",
  parentName: "父世界",
  parentMap: "上级地图",
  category: "分类",
  coordinates: "坐标",
  // 主题/大纲规划
  synopsis: "简介",
  sellingPoints: "卖点",
  targetAudience: "目标读者",
  referenceCase: "参考案例",
  referenceCases: "参考案例",
  guidance: "写作指引",
  volumes: "卷数",
  chaptersPerVolume: "每卷章数",
  channel: "渠道",
  targets: "适用对象",
  // 评审/评论
  targetType: "对象类型",
  targetId: "对象 ID",
  quote: "引用原文",
  prefix: "前文",
  suffix: "后文",
  comment: "评论",
  // 问答面板
  questions: "问题",
  question: "问题",
  options: "选项",
  markerStyle: "序号风格",
  // 概览统计
  counts: "数量统计",
  stage: "阶段",
  theme: "主题",
  settings: "设定",
  characters: "角色",
  chapters: "章",
  tropes: "爽点/泪点",
}

export function fieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? key
}

/* ------------------------------------------------------------------ */
/* 批量工具归组（§2.2）与创作任务清单（§4.6）共用的事实源                */
/* ------------------------------------------------------------------ */

/** 归组工具 → 组名（工具类别中文名）；未登记的工具不参与归组 */
export const TOOL_GROUPS: Record<string, string> = {
  proposeNovelPlanning: "构思剧情规划",
  getStoryWorkflow: "创作流程", updateStoryWorkflow: "创作流程", reopenStoryPhase: "创作流程",
  reviewStoryCheckpoint: "阶段评审", requestStoryApproval: "作者审核", completeStoryTask: "任务收尾", generateCharacterArc: "角色弧线", requestContentApproval: "作者审核", requestStoryRemoval: "作者审核", listStoryRemovals: "回收记录", restoreStoryStructure: "恢复内容", generateStoryChapters: "撰写章节", getStoryArtifact: "读取创作内容",
  linkStoryArtifacts: "故事来源", unlinkStoryArtifacts: "故事来源", getStoryImpact: "关联修订", getStorySources: "故事来源",
  improveChapterContent: "正文改进",
  checkChapterNarrative: "叙事检查",
  getChapterCandidates: "正文抽卡",
  drawChapterCandidates: "正文抽卡",
  revertChapterReplacement: "正文抽卡",
  getChapterFinalizationChecklist: "定稿检查",
  proposePlan: "计划提案",
  generateCharacterImage: "生成角色图像",
  createCharacter: "创建角色",
  createChapter: "搭建章节大纲",
  createVolume: "搭建分卷",
  createItem: "登记物品设定",
  createScene: "登记场景设定",
  upsertSetting: "保存设定",
  addTextComment: "添加行内评论",
  handleTextComment: "处理行内评论",
  listTextComments: "查看行内评论",
  updateChapterOutline: "更新章大纲",
}

/** 归组阈值：连续同组调用达到此数才折叠为一行计数摘要 */
export const TOOL_GROUP_MIN = 4

export interface ToolCallGroup {
  kind: "group"
  key: string
  groupName: string
  calls: ToolCallView[]
}

export function isToolGroup(row: ToolCallView | ToolCallGroup): row is ToolCallGroup {
  return (row as ToolCallGroup).kind === "group"
}

/**
 * 把一轮工具调用折叠为行序列（§2.2）：同一助手轮内连续同组 ≥4 条的区段归为一组，
 * 其余调用原样保留；组边界由不同类别的调用天然分隔。
 */
export function groupToolCalls(calls: ToolCallView[]): (ToolCallView | ToolCallGroup)[] {
  const rows: (ToolCallView | ToolCallGroup)[] = []
  let i = 0
  while (i < calls.length) {
    const groupName = TOOL_GROUPS[calls[i].toolName]
    if (!groupName) {
      rows.push(calls[i])
      i += 1
      continue
    }
    let j = i
    while (j < calls.length && TOOL_GROUPS[calls[j].toolName] === groupName) j += 1
    const run = calls.slice(i, j)
    if (run.length >= TOOL_GROUP_MIN) {
      rows.push({ kind: "group", key: `group-${calls[i].toolCallId}`, groupName, calls: run })
    } else {
      rows.push(...run)
    }
    i = j
  }
  return rows
}

/**
 * 有序 parts 内连续内部失败归并（W6）：返回 首 partId → 同 run 调用列表（≥2 才成折），
 * 与被折叠行覆盖（不再单独渲染）的 partId 集合；单个内部失败仍走普通工具行。
 */
export function foldInternalFailureRuns(
  parts: ChatPart[] | undefined,
  toolCalls: ToolCallView[]
): { runs: Map<string, ToolCallView[]>; covered: Set<string> } {
  const runs = new Map<string, ToolCallView[]>()
  const covered = new Set<string>()
  if (!parts) return { runs, covered }
  let current: { firstId: string; memberIds: string[]; calls: ToolCallView[] } | null = null
  const flush = () => {
    if (current && current.calls.length >= 2) {
      runs.set(current.firstId, current.calls)
      for (const id of current.memberIds.slice(1)) covered.add(id)
    }
    current = null
  }
  for (const part of parts) {
    const call = part.type === "tool" ? toolCalls.find(c => c.toolCallId === part.toolCallId) : undefined
    if (call && call.status === "error" && isInternalToolCall(call.toolName, call.output)) {
      if (current) { current.calls.push(call); current.memberIds.push(part.id) }
      else current = { firstId: part.id, memberIds: [part.id], calls: [call] }
    } else flush()
  }
  flush()
  return { runs, covered }
}

/**
 * 工具行摘要（§2.1「动作 + 对象 + 量化」）：写工具返回 ToolOutcome（message 已是人话）直接采用；
 * 读工具按类别从返回数据拼摘要，不再统一显示「执行完成」。
 */
export function summarizeOutput(
  toolName: string,
  input: unknown,
  output: unknown
): { ok: boolean; summary: string } {
  if (output && typeof output === "object" && "ok" in output) {
    const outcome = output as ToolOutcome
    if (!outcome.ok && isInternalToolCall(toolName, output)) return { ok: false, summary: INTERNAL_FAILURE_SUMMARY }
    return { ok: outcome.ok, summary: outcome.message }
  }
  // 读工具的空态/未命中返回纯字符串提示（如「（暂无角色…）」）
  if (typeof output === "string") {
    return { ok: true, summary: output.replace(/^[（(]|[)）]$/g, "") }
  }
  const inObj = (input ?? {}) as Record<string, unknown>
  const arr = Array.isArray(output) ? output : null
  const obj = output && typeof output === "object" ? (output as Record<string, unknown>) : null
  const inName = typeof inObj.name === "string" ? inObj.name : null

  switch (toolName) {
    case "getChapterContent": {
      const title = typeof obj?.title === "string" ? obj.title : null
      const wc = typeof obj?.wordCount === "number" ? obj.wordCount : null
      return {
        ok: true,
        summary: title
          ? `《${title}》正文${wc != null ? ` · 共 ${wc.toLocaleString()} 字` : ""}`
          : "章节正文",
      }
    }
    case "getOutline": {
      if (!arr) return { ok: true, summary: "大纲" }
      const chapters = arr.reduce((n, v) => {
        const ch = (v as { chapters?: unknown }).chapters
        return n + (Array.isArray(ch) ? ch.length : 0)
      }, 0)
      return { ok: true, summary: `${arr.length} 卷 ${chapters} 章` }
    }
    case "getSetting": {
      const typeLabel =
        typeof inObj.type === "string" && inObj.type in SETTING_TYPE_LABELS
          ? SETTING_TYPE_LABELS[inObj.type as keyof typeof SETTING_TYPE_LABELS]
          : "设定"
      if (inName) return { ok: true, summary: `${typeLabel}「${inName}」` }
      return { ok: true, summary: arr ? `${typeLabel} · ${arr.length} 条` : typeLabel }
    }
    case "getCharacter": {
      const name = typeof obj?.name === "string" ? obj.name : inName
      return { ok: true, summary: name ? `「${name}」` : "角色" }
    }
    case "getNovelOverview": {
      const title = typeof obj?.title === "string" ? obj.title : null
      return { ok: true, summary: title ? `《${title}》` : "小说概览" }
    }
    case "getNovelContext":
      return { ok: true, summary: "主题/设定/角色全文" }
    case "getWorlds":
      return { ok: true, summary: arr ? `${arr.length} 个世界` : "世界树" }
    case "listCharacters":
      return { ok: true, summary: arr ? `${arr.length} 人` : "角色列表" }
    case "listReviews":
      return { ok: true, summary: arr ? `${arr.length} 条` : "评审记录" }
    case "getScoreReport": {
      const dims = Array.isArray(obj?.dimensions) ? (obj.dimensions as unknown[]).length : 0
      const agents = Array.isArray(obj?.agents) ? (obj.agents as unknown[]).length : 0
      const score = typeof obj?.score === "number" ? obj.score : null
      const parts = [
        score !== null ? `${score} 分` : null,
        dims > 0 ? `${dims} 维` : null,
        agents > 0 ? `${agents} 位评价` : null,
      ].filter(Boolean)
      return { ok: true, summary: parts.length > 0 ? parts.join(" · ") : "评分报告" }
    }
    case "listTropes":
      return { ok: true, summary: "平台与自定义条目" }
    case "listItems":
      return { ok: true, summary: arr ? `${arr.length} 件` : "物品" }
    case "getSceneContext":
    case "listScenes":
      return { ok: true, summary: arr ? `${arr.length} 处` : "场景" }
    case "listAttributes":
      return { ok: true, summary: arr ? `${arr.length} 条` : "属性定义" }
    case "getSopStatus": {
      const nodes = Array.isArray(obj?.nodes) ? (obj.nodes as unknown[]).length : 0
      const dq = Array.isArray(obj?.deferredQuestions)
        ? (obj.deferredQuestions as unknown[]).length
        : 0
      return {
        ok: true,
        summary: `${nodes} 个环节状态${dq > 0 ? ` · ${dq} 个问题挂账` : ""}`,
      }
    }
    default:
      return { ok: true, summary: "执行完成" }
  }
}
