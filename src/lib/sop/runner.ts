import { taskDefaults } from "@desktop/service/task-defaults"
/**
 * SOP 编排器（2026-08 graph-engineering SOP）：分层 DAG 的执行核心。
 *
 * - runCheckpointLoop：通用收敛循环（产出→检查点→达标或达上限收敛），produce/check
 *   依赖注入——e2e 可注假函数秒测收敛逻辑，不花 AI 钱。收敛硬保证：maxIterations
 *   上限 + 未收敛返回 converged:false 由墨影升级作者裁决。
 * - 具体入口：assessThemeMarket（平台编辑）/ summonPlaywright（剧作家，含实例级
 *   自动 loop 与阵容级检查）/ runReaderPanel（读者团并行 fan-out）/ reviewWholeNovel
 *   （L0 整书面板，findings 按 targetNode 路由回内层环节的 openFindings）。
 * - 每次节点执行写 SopNodeRun（含嵌套 parentRunId），每次子代理调用写 SubAgentRun
 *   并关联 sopNodeRunId；执行钩子自动给会话活跃计划打勾（plan.markItemByNodeRun）。
 * - 子代理只产出结构化内容，本模块负责落库（复用现有 service 层）；隔离契约见 agents.ts。
 */
import { Prisma, type Character } from "@/generated/prisma/client"
import { buildNovelSections } from "@/lib/ai/context"
import { normalizeAliases } from "@/lib/aliases"
import { renderBigFive } from "@/lib/big-five"
import { renderBeliefs } from "@/lib/beliefs"
import { prisma } from "@/lib/db"
import { ContentError } from "@/lib/content-errors"
import { contentHash } from "@/lib/services/content-commit"
import { renderMotivations } from "@/lib/motivation"
import { normalizePersonalityTags } from "@/lib/personality-tags"
import * as characterService from "@/lib/services/character"
import * as outlineService from "@/lib/services/outline"
import { runReaderReview } from "@/lib/services/review"
import * as settingService from "@/lib/services/setting"
import { completeRun, failRun, startRun, type SubAgentKind } from "@/lib/services/subagent-run"
import * as worldService from "@/lib/services/world"
import {
  callAgent,
  normalizeJudgeComments,
  READER_PERSONAS,
  type ReaderPersonaId,
  type SopAgentId,
} from "@/lib/sop/agents"
import { getSopNode, type SopNodeId } from "@/lib/sop/graph"
import * as planService from "@/lib/sop/plan"
import { publishStoryArtifact } from "@/lib/services/story-progress"
import { resolveModelForUser } from "@/lib/ai/provider"
import type { StoryCheckpoint } from "@/lib/story-workflow"

/* ----------------------------- 通用收敛 loop ----------------------------- */

export interface LoopCheckResult {
  score: number
  /** 本轮检查点一句话摘要（进 scoreHistory） */
  summary: string
  /** 反馈全文（注入下一轮 produce 的 {{feedback}}） */
  feedback: string
}

export interface CheckpointLoopResult {
  converged: boolean
  iterations: number
  finalScore: number | null
  scoreHistory: { round: number; score: number; summary: string }[]
  nodeRunId: string
}

/**
 * 收敛 loop：create SopNodeRun → 计划置 active → 至多 maxIterations 轮
 * 「produce(round, feedback) → check(round)」→ 达标收敛 → SopNodeRun 落档 + 计划打勾。
 * produce/check 抛错：SopNodeRun 置 failed、计划项置 failed 后原样抛出。
 */
export async function runCheckpointLoop(input: {
  novelId: string
  conversationId?: string | null
  nodeId: SopNodeId
  targetId?: string | null
  parentRunId?: string | null
  /** 首轮即注入的反馈（按意见改进链路：上轮评审意见直入首轮，不从空白起步） */
  initialFeedback?: string | null
  produce: (round: number, feedback: string | null, nodeRunId: string) => Promise<{ summary: string }>
  check: (round: number, nodeRunId: string) => Promise<LoopCheckResult>
}): Promise<CheckpointLoopResult> {
  const node = getSopNode(input.nodeId)
  if (!node.checkpoint) throw new Error(`[sop] 节点 ${input.nodeId} 没有检查点配置`)
  const { threshold, maxIterations } = node.checkpoint

  const nodeRun = await prisma.sopNodeRun.create({
    data: { defaultsSnapshot: await taskDefaults(),
      novelId: input.novelId,
      nodeId: input.nodeId,
      targetId: input.targetId ?? null,
      parentRunId: input.parentRunId ?? null,
      status: "running",
    },
  })
  await planService.markItemByNodeRun({
    conversationId: input.conversationId,
    nodeId: input.nodeId,
    targetId: input.targetId,
    status: "active",
    sopNodeRunId: nodeRun.id,
  })

  const scoreHistory: { round: number; score: number; summary: string }[] = []
  let feedback: string | null = input.initialFeedback?.trim() ? input.initialFeedback.trim() : null
  let converged = false

  try {
    for (let round = 1; round <= maxIterations; round++) {
      await input.produce(round, feedback, nodeRun.id)
      const checkRes = await input.check(round, nodeRun.id)
      scoreHistory.push({ round, score: checkRes.score, summary: checkRes.summary })
      if (checkRes.score >= threshold) {
        converged = true
        break
      }
      feedback = checkRes.feedback
    }
  } catch (err) {
    await prisma.sopNodeRun.update({
      where: { id: nodeRun.id },
      data: {
        status: "failed",
        iterations: scoreHistory.length,
        scoreHistory: scoreHistory as unknown as Prisma.InputJsonValue,
      },
    })
    await planService.markItemByNodeRun({
      conversationId: input.conversationId,
      nodeId: input.nodeId,
      targetId: input.targetId,
      status: "failed",
      sopNodeRunId: nodeRun.id,
      summary: err instanceof Error ? err.message.slice(0, 120) : "执行失败",
    })
    throw err
  }

  const finalScore = scoreHistory.length > 0 ? scoreHistory[scoreHistory.length - 1].score : null
  const iterations = scoreHistory.length
  await prisma.sopNodeRun.update({
    where: { id: nodeRun.id },
    data: {
      status: converged ? "done" : "failed",
      iterations,
      finalScore,
      scoreHistory: scoreHistory as unknown as Prisma.InputJsonValue,
    },
  })
  await planService.markItemByNodeRun({
    conversationId: input.conversationId,
    nodeId: input.nodeId,
    targetId: input.targetId,
    status: converged ? "done" : "failed",
    sopNodeRunId: nodeRun.id,
    summary: finalScore !== null ? `评分 ${finalScore}（${iterations} 轮${converged ? "" : "，未收敛"}）` : undefined,
  })
  // 本环节有了新的执行，更早 run 上挂着的 L0 findings 视为已被处理
  if (converged) await resolveEarlierFindings(input.novelId, input.nodeId, nodeRun.id)

  return { converged, iterations, finalScore, scoreHistory, nodeRunId: nodeRun.id }
}

/* ----------------------------- 子代理调用包装 ----------------------------- */

/** 单次子代理调用：startRun → callAgent → completeRun（失败 failRun 留痕后抛出） */
async function invokeAgent<I extends SopAgentId>(input: {
  agentId: I
  novelId: string
  userId: string
  conversationId?: string | null
  sopNodeRunId?: string | null
  task: string
  vars: Record<string, string>
  /** 轻评审（实例回炉 judge）置 true：按 NORMAL 档独立解析，不继承会话模型 */
  lightReview?: boolean
}) {
  const spec = input.agentId.split(".")[0] as SubAgentKind
  const run = await startRun({
    novelId: input.novelId,
    conversationId: input.conversationId,
    agentKind: spec,
    task: input.task,
    sopNodeRunId: input.sopNodeRunId,
  })
  try {
    const { data, usage } = await callAgent(input.agentId, {
      userId: input.userId,
      novelId: input.novelId,
      vars: input.vars,
      ...(input.lightReview ? { resolvedModel: await resolveModelForUser(input.userId, { tier: "NORMAL" }) } : {}),
    })
    await completeRun(run.id, { transcript: data, result: data, tokenUsage: usage })
    return { run, data, usage }
  } catch (err) {
    await failRun(run.id, err instanceof Error ? err.message : "子代理调用失败")
    throw err
  }
}

/** judge 系产出 → 检查点结果（反馈全文供下一轮修订）；导出供面板侧检查点复用 */
export function judgeToLoopResult(data: { score: number; comments: { aspect?: string; dimension?: string; issue: string; suggestion: string }[] }): LoopCheckResult {
  const comments = normalizeJudgeComments(data.comments)
  const feedback = comments.length
    ? comments.map((c, i) => `${i + 1}. 【${c.aspect}】${c.issue}\n   改法：${c.suggestion}`).join("\n")
    : ""
  return {
    score: data.score,
    summary: comments.length ? `${comments.length} 条意见` : "无意见",
    feedback,
  }
}

/** 实例回炉结果 → workflow checkpoint 证据；未收敛时意见标记 needsAuthor，由作者拍板（上限升级语义） */
function loopEvidence(artifactKey: string | undefined, loop: CheckpointLoopResult, lastJudge: { runId: string; comments: { aspect?: string; dimension?: string; issue: string; suggestion: string }[] } | null): InstanceLoopEvidence | undefined {
  if (!artifactKey || loop.finalScore === null) return undefined
  return {
    artifactKey,
    score: loop.finalScore,
    passed: loop.converged,
    iterations: loop.iterations,
    summary: loop.converged ? `实例回炉 ${loop.iterations} 轮收敛，检查点 ${loop.finalScore} 分` : `实例回炉 ${loop.iterations} 轮后 ${loop.finalScore} 分未达收敛线，保留当前版本请作者定夺`,
    issues: normalizeJudgeComments(lastJudge?.comments ?? []).map(c => ({ issue: `【${c.aspect}】${c.issue}`, suggestion: c.suggestion, needsAuthor: !loop.converged })),
    runId: lastJudge?.runId,
  }
}

/* ----------------------------- 平台编辑·主题 ----------------------------- */

export async function assessThemeMarket(input: {
  novelId: string
  userId: string
  conversationId?: string | null
  brief?: string
}) {
  const { novelId, userId } = input
  const sections = await buildNovelSections(novelId)
  if (sections.theme === "（暂无主题）") {
    throw new Error("还没有主题可评估：请先与作者共建主题（upsertTheme）")
  }

  const nodeRun = await prisma.sopNodeRun.create({
    data: { defaultsSnapshot: await taskDefaults(), novelId, nodeId: "theme", status: "running" },
  })
  await planService.markItemByNodeRun({
    conversationId: input.conversationId,
    nodeId: "theme",
    status: "active",
    sopNodeRunId: nodeRun.id,
  })

  try {
    const { run, data, usage } = await invokeAgent({
      agentId: "editor.theme",
      novelId,
      userId,
      conversationId: input.conversationId,
      sopNodeRunId: nodeRun.id,
      task: "评估主题市场方向",
      vars: { theme: sections.theme, brief: input.brief?.trim() || "（无）" },
    })
    await prisma.sopNodeRun.update({
      where: { id: nodeRun.id },
      data: {
        status: "done",
        iterations: 1,
        finalScore: data.score,
        scoreHistory: [{ round: 1, score: data.score, summary: data.verdict.slice(0, 80) }] as unknown as Prisma.InputJsonValue,
      },
    })
    await planService.markItemByNodeRun({
      conversationId: input.conversationId,
      nodeId: "theme",
      status: "done",
      sopNodeRunId: nodeRun.id,
      summary: `市场评估 ${data.score} 分`,
    })
    await resolveEarlierFindings(novelId, "theme", nodeRun.id)
    return { ...data, usage, subAgentRunId: run.id, nodeRunId: nodeRun.id }
  } catch (err) {
    await prisma.sopNodeRun.update({ where: { id: nodeRun.id }, data: { status: "failed" } })
    await planService.markItemByNodeRun({
      conversationId: input.conversationId,
      nodeId: "theme",
      status: "failed",
      summary: "评估中断",
    })
    throw err
  }
}

/* ----------------------------- 剧作家 ----------------------------- */

export type PlaywrightKind = "world" | "character" | "setting" | "outline"

/** 实例回炉收敛证据：由工具层写入该产物 key 的 workflow checkpoint（W3 消除双重评审） */
export interface InstanceLoopEvidence {
  artifactKey: string
  score: number
  passed: boolean
  iterations: number
  summary: string
  issues: StoryCheckpoint["issues"]
  runId?: string
}

/** summonPlaywright 统一返回：loop 系字段 + outline 专有字段（可选） */
export interface SummonResult {
  converged: boolean
  iterations: number
  finalScore: number | null
  questions: string[]
  nodeRunId: string
  scoreHistory?: { round: number; score: number; summary: string }[]
  /** outline：新卷信息 */
  volumeId?: string
  volumeIndex?: number
  title?: string
  chapterCount?: number
  subAgentRunId?: string
  /** character / setting：落库对象名 */
  characterName?: string
  settingName?: string
  /** world/character/setting：实例回炉收敛证据 */
  evidence?: InstanceLoopEvidence
}

/** 并行提交的父子兜底：找不到上级世界时建同名占位世界（随后由它自己的召唤覆盖） */
async function resolveParentWorldId(novelId: string, worldName?: string): Promise<string | null> {
  if (worldName === undefined) return null
  return worldService.resolveOrCreateParentWorld(novelId, worldName)
}

/** 同理：找不到上级地图时建同名占位 MAP 设定 */
async function resolveParentMapId(
  novelId: string,
  worldId: string | null,
  parentMapName?: string
): Promise<string | null> {
  if (!parentMapName?.trim()) return null
  const name = parentMapName.trim()
  const scope = worldId ? { worldId } : { novelId, worldId: null }
  const existing = await prisma.setting.findFirst({
    where: { ...scope, type: "MAP", name, parentId: null },
  })
  if (existing) return existing.id
  const placeholder = await settingService.upsertSetting({
    novelId,
    type: "MAP",
    name,
    content: { text: "" },
    worldId,
  })
  return placeholder.id
}

/** judge.character 检查点的单角色渲染（含空缺占位，供评委发现缺口） */
function renderCharacterSubject(c: Character) {
  const roleLabel = { PROTAGONIST: "主角", SUPPORTING: "配角", ANTAGONIST: "反派" }[c.roleType] ?? c.roleType
  const aliases = normalizeAliases(c.aliases)
  const personalityTags = normalizePersonalityTags(c.personalityTags)
  const bigFive = renderBigFive(c.bigFive)
  const beliefs = renderBeliefs(c.beliefs)
  return [
    `### ${c.name}（${roleLabel}｜${c.gender || "性别未知"}｜${c.occupation || "身份未知"}｜${c.age || "年龄未知"}）`,
    `- 别名：${aliases.length > 0 ? aliases.join("、") : "（无）"}`,
    `- 简介：${c.bio || "（空）"}`,
    `- 人物描述：${c.personality || "（空）"}`,
    `- 性格：${personalityTags.length > 0 ? personalityTags.join("、") : "（空）"}`,
    `- 性格五维：${bigFive || "（未评估）"}`,
    `- 外貌：${c.appearance || "（空）"}`,
    `- 身形：${[c.height && `身高 ${c.height}`, c.weight && `体重 ${c.weight}`, c.build, c.faceShape && `脸型${c.faceShape}`].filter(Boolean).join(" · ") || "（空）"}`,
    `- 穿衣风格：${c.clothing || "（空）"}`,
    `- 品味偏好：${c.tastes || "（空）"}`,
    `- 行为习惯：${c.habits || "（空）"}`,
    `- 口头禅：${c.catchphrase || "（空）"}`,
    `- 对话风格：${c.dialogueStyle || "（空）"}`,
    `- 示例对话：${c.sampleDialogue || "（空）"}`,
    `- 核心动机：${renderMotivations(c.motivations) || "（空）"}`,
    `- 核心欲望：${c.desires || "（空）"}`,
    `- 核心恐惧：${c.fears || "（空）"}`,
    `- 观念：${beliefs || "（空）"}`,
    `- 能力：${c.abilities || "（空）"}`,
    `- 出场前经历：${c.backstory || "（空）"}`,
    `- 成长弧线：${c.growthArc || "（空）"}`,
    `- 人物关系：${JSON.stringify(c.relationships)}`,
  ].join("\n")
}

/**
 * 召唤剧作家：产出（结构化 JSON）→ 编排器落库 → world/character/setting 实例级
 * 自动收敛 loop（≤图配置轮次，修订轮带 feedback）；outline 为 chat 驱动——只产出，
 * 检查点走既有 requestAIReview 链路，不在本函数内循环。
 */
export async function summonPlaywright(input: {
  novelId: string
  userId: string
  conversationId?: string | null
  kind: PlaywrightKind
  /** 创作简报：作者意图 + 环节入口追问到的答案汇总 */
  brief: string
  /** 重做/修订某个具体对象时的对象名（缺省则由剧作家命名新对象） */
  name?: string
  /** world：上级世界名；setting：所属世界名 */
  worldName?: string
}): Promise<SummonResult> {
  const { kind } = input
  const brief = [
    input.brief.trim(),
    input.name?.trim() ? `对象名指定：「${input.name.trim()}」（已存在则修订它，否则以该名新建）` : "",
  ]
    .filter(Boolean)
    .join("\n\n")

  if (kind === "world") return summonWorld({ ...input, brief })
  if (kind === "character") return summonCharacter({ ...input, brief })
  if (kind === "setting") return summonSetting({ ...input, brief })
  return summonOutline({ ...input, brief })
}

async function summonWorld(input: Parameters<typeof summonPlaywright>[0] & { brief: string }) {
  const { novelId, userId } = input
  const parentId = await resolveParentWorldId(novelId, input.worldName)
  let questions: string[] = []
  let producedId: string | undefined
  let lastJudge: { runId: string; comments: { aspect?: string; dimension?: string; issue: string; suggestion: string }[] } | null = null

  const loop = await runCheckpointLoop({
    novelId,
    conversationId: input.conversationId,
    nodeId: "world",
    produce: async (round, feedback, nodeRunId) => {
      const baselines = await prisma.world.findMany({ where: { novelId, parentId } })
      const sections = await buildNovelSections(novelId, undefined, undefined, input.brief)
      const { data } = await invokeAgent({
        agentId: "playwright.world",
        novelId,
        userId,
        conversationId: input.conversationId,
        sopNodeRunId: nodeRunId,
        task: `搭建世界观（第 ${round} 轮）`,
        vars: { theme: sections.theme, settings: sections.settings, brief: input.brief, feedback: feedback ?? "" },
      })
      const existing = await worldService.resolveWorldReference(novelId, { parentId, name: data.name })
      if (existing) {
        const before = baselines.find(row => row.id === existing.id)
        if (!before) throw new ContentError("VERSION_CONFLICT", "生成期间世界已被创建，请重新读取后继续")
        producedId = existing.id
        await worldService.updateWorld(existing.id, { description: data.description }, { userId, operationId: `sop:${nodeRunId}:world:${round}`, baseline: { version: null, updatedAt: before.updatedAt.toISOString(), hash: contentHash(before.description) } })
      } else {
        producedId = (await worldService.createWorld(novelId, { name: data.name, parentId, description: data.description })).id
      }
      questions = data.questions ?? []
      await publishStoryArtifact(novelId, `world:${producedId}`)
      return { summary: `世界「${data.name}」已落库` }
    },
    check: async (_round, nodeRunId) => {
      const [sections, world] = await Promise.all([
        buildNovelSections(novelId, undefined, undefined, input.brief),
        producedId ? worldService.resolveWorldReference(novelId, { id: producedId }) : Promise.resolve(null),
      ])
      const subject = world ? `【世界 · ${world.name}】\n${world.description}` : "（未找到刚落库的世界）"
      const { run, data } = await invokeAgent({
        agentId: "judge.world",
        novelId,
        userId,
        conversationId: input.conversationId,
        sopNodeRunId: nodeRunId,
        task: "审查世界观",
        vars: { theme: sections.theme, settings: sections.settings, subject },
        lightReview: true,
      })
      lastJudge = { runId: run.id, comments: data.comments }
      return judgeToLoopResult(data)
    },
  })
  return { ...loop, questions, evidence: loopEvidence(producedId ? `world:${producedId}` : undefined, loop, lastJudge) }
}

async function summonCharacter(input: Parameters<typeof summonPlaywright>[0] & { brief: string }) {
  const { novelId, userId } = input
  let questions: string[] = []
  let producedName = input.name?.trim() || ""
  let producedId: string | undefined
  let lastJudge: { runId: string; comments: { aspect?: string; dimension?: string; issue: string; suggestion: string }[] } | null = null

  const loop = await runCheckpointLoop({
    novelId,
    conversationId: input.conversationId,
    nodeId: "character",
    produce: async (round, feedback, nodeRunId) => {
      const baselines = await prisma.character.findMany({ where: { novelId } })
      const sections = await buildNovelSections(novelId, undefined, undefined, input.brief)
      const { data } = await invokeAgent({
        agentId: "playwright.character",
        novelId,
        userId,
        conversationId: input.conversationId,
        sopNodeRunId: nodeRunId,
        task: `设计角色（第 ${round} 轮）`,
        vars: {
          theme: sections.theme,
          settings: sections.settings,
          characters: sections.characters,
          brief: input.brief,
          feedback: feedback ?? "",
        },
      })
      producedName = data.name
      const payload = {
        name: data.name,
        roleType: data.roleType,
        age: data.age,
        gender: data.gender,
        occupation: data.occupation,
        bio: data.bio,
        personality: data.personality,
        aliases: data.aliases as unknown as Prisma.InputJsonValue,
        personalityTags: data.personalityTags as unknown as Prisma.InputJsonValue,
        appearance: data.appearance,
        height: data.height,
        weight: data.weight,
        build: data.build,
        faceShape: data.faceShape,
        clothing: data.clothing,
        tastes: data.tastes,
        habits: data.habits,
        catchphrase: data.catchphrase,
        dialogueStyle: data.dialogueStyle,
        sampleDialogue: data.sampleDialogue,
        desires: data.desires,
        fears: data.fears,
        abilities: data.abilities,
        backstory: data.backstory,
        growthArc: data.growthArc,
        arcStages: data.arcStages as unknown as Prisma.InputJsonValue,
        motivations: data.motivations as unknown as Prisma.InputJsonValue,
        beliefs: data.beliefs as unknown as Prisma.InputJsonValue,
        ...(data.bigFive
          ? { bigFive: data.bigFive as unknown as Prisma.InputJsonValue }
          : {}),
        relationships: data.relationships as unknown as Prisma.InputJsonValue,
      }
      const existing = await prisma.character.findFirst({ where: { novelId, name: data.name } })
      if (existing) {
        const before = baselines.find(row => row.id === existing.id)
        if (!before) throw new ContentError("VERSION_CONFLICT", "生成期间角色已被创建，请重新读取后继续")
        await characterService.updateCharacter(existing.id, payload, before.version)
        producedId = existing.id
      } else {
        producedId = (await characterService.createCharacter(novelId, payload)).id
      }
      questions = data.questions ?? []
      await publishStoryArtifact(novelId, `character:${producedId}`)
      return { summary: `角色「${data.name}」已落库` }
    },
    check: async (_round, nodeRunId) => {
      const [sections, character] = await Promise.all([
        buildNovelSections(novelId, undefined, undefined, input.brief),
        prisma.character.findFirst({ where: { novelId, name: producedName } }),
      ])
      const subject = character ? renderCharacterSubject(character) : "（未找到刚落库的角色）"
      const { run, data } = await invokeAgent({
        agentId: "judge.character",
        novelId,
        userId,
        conversationId: input.conversationId,
        sopNodeRunId: nodeRunId,
        task: `审查角色「${producedName}」`,
        vars: {
          theme: sections.theme,
          settings: sections.settings,
          characters: sections.characters,
          subject,
        },
        lightReview: true,
      })
      lastJudge = { runId: run.id, comments: data.comments }
      return judgeToLoopResult(data)
    },
  })
  return { ...loop, questions, characterName: producedName, evidence: loopEvidence(producedId ? `character:${producedId}` : undefined, loop, lastJudge) }
}

async function summonSetting(input: Parameters<typeof summonPlaywright>[0] & { brief: string }) {
  const { novelId, userId } = input
  let questions: string[] = []
  let producedLabel = input.name?.trim() || ""
  let producedId: string | undefined
  let lastJudge: { runId: string; comments: { aspect?: string; dimension?: string; issue: string; suggestion: string }[] } | null = null

  const loop = await runCheckpointLoop({
    novelId,
    conversationId: input.conversationId,
    nodeId: "setting",
    produce: async (round, feedback, nodeRunId) => {
      const baselines = await prisma.setting.findMany({ where: { novelId } })
      const sections = await buildNovelSections(novelId, undefined, undefined, input.brief)
      const { data } = await invokeAgent({
        agentId: "playwright.setting",
        novelId,
        userId,
        conversationId: input.conversationId,
        sopNodeRunId: nodeRunId,
        task: `设计设定（第 ${round} 轮）`,
        vars: { theme: sections.theme, settings: sections.settings, brief: input.brief, feedback: feedback ?? "" },
      })
      producedLabel = data.name
      const worldId = await resolveParentWorldId(novelId, data.worldName)
      const parentMapId = await resolveParentMapId(novelId, worldId, data.parentMapName)
      const targetWorldId = data.type === "GOLD_FINGER" || data.type === "STYLE" ? null : worldId
      const before = baselines.find(row => row.type === data.type && row.name === data.name && row.worldId === targetWorldId && row.parentId === parentMapId)
      const savedSetting = await settingService.upsertSetting({
        novelId,
        type: data.type,
        name: data.name,
        content: data.content as Prisma.InputJsonValue,
        worldId: targetWorldId,
        parentId: parentMapId,
        saveOptions: before ? { userId, expectedVersion: before.version, operationId: `sop:${nodeRunId}:setting:${round}` } : undefined,
      })
      producedId = savedSetting.id
      questions = data.questions ?? []
      await publishStoryArtifact(novelId, `setting:${savedSetting.id}`)
      return { summary: `设定「${data.name}」已落库` }
    },
    check: async (_round, nodeRunId) => {
      const [sections, setting] = await Promise.all([
        buildNovelSections(novelId, undefined, undefined, input.brief),
        prisma.setting.findFirst({ where: { novelId, name: producedLabel }, orderBy: { updatedAt: "desc" } }),
      ])
      const subject = setting
        ? `【${setting.type} · ${setting.name}】\n${JSON.stringify(setting.content, null, 2)}`
        : "（未找到刚落库的设定）"
      const { run, data } = await invokeAgent({
        agentId: "judge.setting",
        novelId,
        userId,
        conversationId: input.conversationId,
        sopNodeRunId: nodeRunId,
        task: `审查设定「${producedLabel}」`,
        vars: { theme: sections.theme, settings: sections.settings, subject },
        lightReview: true,
      })
      lastJudge = { runId: run.id, comments: data.comments }
      return judgeToLoopResult(data)
    },
  })
  return { ...loop, questions, settingName: producedLabel, evidence: loopEvidence(producedId ? `setting:${producedId}` : undefined, loop, lastJudge) }
}

/** 卷大纲：chat 驱动节点——只产出（含落库），检查点走既有 requestAIReview 链路 */
async function summonOutline(input: Parameters<typeof summonPlaywright>[0] & { brief: string }) {
  const { novelId, userId } = input
  const nodeRun = await prisma.sopNodeRun.create({
    data: { defaultsSnapshot: await taskDefaults(), novelId, nodeId: "outline", status: "running" },
  })
  await planService.markItemByNodeRun({
    conversationId: input.conversationId,
    nodeId: "outline",
    status: "active",
    sopNodeRunId: nodeRun.id,
  })

  try {
    const sections = await buildNovelSections(novelId, undefined, undefined, input.brief)
    const { run, data } = await invokeAgent({
      agentId: "playwright.outline",
      novelId,
      userId,
      conversationId: input.conversationId,
      sopNodeRunId: nodeRun.id,
      task: "搭建一卷大纲框架",
      vars: {
        theme: sections.theme,
        settings: sections.settings,
        characters: sections.characters,
        tropes: sections.tropes,
        brief: input.brief,
        feedback: "",
      },
    })

    const volume = await outlineService.createVolume(novelId, { title: data.title, summary: data.summary })
    for (const ch of data.chapters) {
      await outlineService.createChapter(volume.id, { title: ch.title, outline: ch.outline, index: ch.index })
    }

    await prisma.sopNodeRun.update({
      where: { id: nodeRun.id },
      data: { status: "done", iterations: 1, targetId: volume.id },
    })
    await planService.markItemByNodeRun({
      conversationId: input.conversationId,
      nodeId: "outline",
      targetId: volume.id,
      status: "done",
      sopNodeRunId: nodeRun.id,
      summary: `第 ${volume.index} 卷《${volume.title}》${data.chapters.length} 章框架已落库，待评审`,
    })
    await resolveEarlierFindings(novelId, "outline", nodeRun.id)
    return {
      converged: true,
      iterations: 1,
      finalScore: null,
      nodeRunId: nodeRun.id,
      volumeId: volume.id,
      volumeIndex: volume.index,
      title: volume.title,
      chapterCount: data.chapters.length,
      questions: data.questions ?? [],
      subAgentRunId: run.id,
    }
  } catch (err) {
    await prisma.sopNodeRun.update({ where: { id: nodeRun.id }, data: { status: "failed" } })
    await planService.markItemByNodeRun({
      conversationId: input.conversationId,
      nodeId: "outline",
      status: "failed",
      summary: "大纲搭建中断",
    })
    throw err
  }
}

/** 阵容级检查（L1 复合节点 checkpoint）：全部角色建完后评估整体结构 */
export async function reviewCast(input: {
  novelId: string
  userId: string
  conversationId?: string | null
}) {
  const { novelId, userId } = input
  const sections = await buildNovelSections(novelId)
  if (sections.characters === "（暂无角色）") throw new Error("还没有角色，先召唤剧作家建角色")

  const nodeRun = await prisma.sopNodeRun.create({
    data: { defaultsSnapshot: await taskDefaults(), novelId, nodeId: "character", status: "running" },
  })
  try {
    const { run, data } = await invokeAgent({
      agentId: "judge.cast",
      novelId,
      userId,
      conversationId: input.conversationId,
      sopNodeRunId: nodeRun.id,
      task: "审查角色阵容整体",
      vars: { theme: sections.theme, settings: sections.settings, subject: sections.characters },
    })
    await prisma.sopNodeRun.update({
      where: { id: nodeRun.id },
      data: {
        status: "done",
        iterations: 1,
        finalScore: data.score,
        scoreHistory: [{ round: 1, score: data.score, summary: `${data.comments.length} 条意见` }] as unknown as Prisma.InputJsonValue,
      },
    })
    const comments = normalizeJudgeComments(data.comments)
    return { score: data.score, comments, subAgentRunId: run.id, nodeRunId: nodeRun.id }
  } catch (err) {
    await prisma.sopNodeRun.update({ where: { id: nodeRun.id }, data: { status: "failed" } })
    throw err
  }
}

/* ----------------------------- 读者团 ----------------------------- */

export interface ReaderPanelEntry {
  persona: ReaderPersonaId
  label: string
  score: number
  summary: string
  impressionCount: number
  runId: string
}

/**
 * 读者团并行 fan-out：多种人设同时试读一章，各自独立 SubAgentRun，聚合均分。
 * target 人设按 Theme.targetAudience 动态画像；主题缺失时退化为资深读者口吻。
 */
export async function runReaderPanel(input: {
  novelId: string
  userId: string
  chapterId: string
  conversationId?: string | null
  personas?: ReaderPersonaId[]
}) {
  const { novelId, userId, chapterId } = input
  const personas = input.personas ?? ["casual", "veteran", "target"]

  const theme = await prisma.theme.findUnique({ where: { novelId } })
  const personaTextOf = (id: ReaderPersonaId): { label: string; text: string } => {
    if (id === "target") {
      const audience = theme?.targetAudience?.trim()
      return {
        label: READER_PERSONAS.target.label,
        text: audience
          ? `你是本书的目标受众读者：${audience}。你对这类题材有明确偏好与期待，会用该读者群的真实标准衡量本章。`
          : "你是一位资深网文读者，长期追读各类小说，口味挑剔但公平。",
      }
    }
    const p = READER_PERSONAS[id]
    return { label: p.label, text: p.description }
  }

  const nodeRun = await prisma.sopNodeRun.create({
    data: { defaultsSnapshot: await taskDefaults(), novelId, nodeId: "content", targetId: chapterId, status: "running" },
  })

  try {
    const entries: ReaderPanelEntry[] = await Promise.all(
      personas.map(async (persona) => {
        const { label, text } = personaTextOf(persona)
        const { run, data } = await runReaderReview({
          novelId,
          chapterId,
          userId,
          conversationId: input.conversationId,
          persona: text,
          personaLabel: label,
          sopNodeRunId: nodeRun.id,
        })
        return {
          persona,
          label,
          score: data.score,
          summary: data.summary,
          impressionCount: data.impressions.length,
          runId: run.id,
        }
      })
    )
    const aggregateScore = Math.round(entries.reduce((s, e) => s + e.score, 0) / entries.length)
    await prisma.sopNodeRun.update({
      where: { id: nodeRun.id },
      data: {
        status: "done",
        iterations: 1,
        finalScore: aggregateScore,
        scoreHistory: [
          { round: 1, score: aggregateScore, summary: entries.map((e) => `${e.label} ${e.score}`).join(" / ") },
        ] as unknown as Prisma.InputJsonValue,
      },
    })
    await planService.markItemByNodeRun({
      conversationId: input.conversationId,
      nodeId: "content",
      targetId: chapterId,
      status: "done",
      sopNodeRunId: nodeRun.id,
      summary: `读者团均分 ${aggregateScore}`,
    })
    return { aggregateScore, readers: entries, nodeRunId: nodeRun.id }
  } catch (err) {
    await prisma.sopNodeRun.update({ where: { id: nodeRun.id }, data: { status: "failed" } })
    throw err
  }
}

/* ----------------------------- L0 整书面板 ----------------------------- */

/**
 * 整书审视（L0 loop 检查点）：平台编辑（市场兑现）+ 总审稿人（整体质量）并行，
 * findings 带 targetNode，路由回内层环节——写入该环节最新 run 的 openFindings 待办。
 */
export async function reviewWholeNovel(input: {
  novelId: string
  userId: string
  conversationId?: string | null
}) {
  const { novelId, userId } = input

  const [sections, volumes, nodeRuns] = await Promise.all([
    buildNovelSections(novelId),
    prisma.volume.findMany({
      where: { novelId },
      orderBy: { index: "asc" },
      include: { chapters: { orderBy: { index: "asc" }, select: { index: true, title: true, status: true, content: true } } },
    }),
    prisma.sopNodeRun.findMany({
      where: { novelId, status: "done", finalScore: { not: null } },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
  ])

  const outlineDigest = volumes.length
    ? volumes
        .map(
          (v) =>
            `第 ${v.index} 卷《${v.title}》：${v.summary}\n  章节：${v.chapters.map((c) => `第${c.index}章《${c.title}》`).join("、")}`
        )
        .join("\n")
    : "（暂无大纲）"
  const written = volumes.flatMap((v) =>
    v.chapters.filter((c) => c.content.trim()).map((c) => ({ volume: v, chapter: c }))
  )
  const contentSamples = written.length
    ? [written[0], written[written.length - 1]]
        .map(
          ({ volume, chapter }, i) =>
            `【${i === 0 ? "开篇" : "最新"}抽样 · 第 ${volume.index} 卷第 ${chapter.index} 章《${chapter.title}》】\n${chapter.content.slice(0, 600)}…`
        )
        .join("\n\n")
    : "（暂无正文）"
  const seenNodes = new Set<string>()
  const scoreHistory = nodeRuns.length
    ? nodeRuns
        .filter((r) => {
          if (seenNodes.has(r.nodeId)) return false
          seenNodes.add(r.nodeId)
          return true
        })
        .map((r) => `- ${r.nodeId}：${r.finalScore} 分（${r.iterations} 轮）`)
        .join("\n")
    : "（暂无检查点记录）"

  const nodeRun = await prisma.sopNodeRun.create({
    data: { defaultsSnapshot: await taskDefaults(), novelId, nodeId: "novel", status: "running" },
  })

  try {
    const [editorRes, judgeRes] = await Promise.all([
      invokeAgent({
        agentId: "editor.theme",
        novelId,
        userId,
        conversationId: input.conversationId,
        sopNodeRunId: nodeRun.id,
        task: "整书市场兑现评估",
        vars: {
          theme: sections.theme,
          brief: `（整书复审：结合以下成品脉络，评估市场定位是否被兑现）\n${outlineDigest}\n\n${contentSamples}`,
        },
      }),
      invokeAgent({
        agentId: "judge.whole",
        novelId,
        userId,
        conversationId: input.conversationId,
        sopNodeRunId: nodeRun.id,
        task: "整书质量审视",
        vars: {
          theme: sections.theme,
          settings: sections.settings,
          characters: sections.characters,
          foreshadows: sections.foreshadows,
          outlineDigest,
          contentSamples,
          scoreHistory,
        },
      }),
    ])

    const score = Math.round((editorRes.data.score + judgeRes.data.score) / 2)
    const findings = judgeRes.data.findings
    await prisma.sopNodeRun.update({
      where: { id: nodeRun.id },
      data: {
        status: "done",
        iterations: 1,
        finalScore: score,
        scoreHistory: [{ round: 1, score, summary: `编辑 ${editorRes.data.score} / 总审 ${judgeRes.data.score} · ${findings.length} 条待办` }] as unknown as Prisma.InputJsonValue,
        openFindings: findings as unknown as Prisma.InputJsonValue,
      },
    })
    await attachFindings(novelId, nodeRun.id, findings)
    await planService.markItemByNodeRun({
      conversationId: input.conversationId,
      nodeId: "novel",
      status: "done",
      sopNodeRunId: nodeRun.id,
      summary: `整书 ${score} 分 · ${findings.length} 条待办`,
    })
    return {
      score,
      editor: { ...editorRes.data, runId: editorRes.run.id },
      judge: {
        score: judgeRes.data.score,
        comments: normalizeJudgeComments(judgeRes.data.comments),
        findings,
        runId: judgeRes.run.id,
      },
      nodeRunId: nodeRun.id,
    }
  } catch (err) {
    await prisma.sopNodeRun.update({ where: { id: nodeRun.id }, data: { status: "failed" } })
    throw err
  }
}

/** findings 路由：写入目标环节最近一次 run 的 openFindings（追加，不覆盖） */
async function attachFindings(
  novelId: string,
  fromRunId: string,
  findings: { targetNode: string; issue: string; suggestion: string }[]
) {
  for (const f of findings) {
    const latest = await prisma.sopNodeRun.findFirst({
      where: { novelId, nodeId: f.targetNode, id: { not: fromRunId } },
      orderBy: { createdAt: "desc" },
    })
    if (!latest) continue
    const open = (latest.openFindings as unknown as { issue: string; suggestion: string; fromRunId: string }[] | null) ?? []
    open.push({ issue: f.issue, suggestion: f.suggestion, fromRunId })
    await prisma.sopNodeRun.update({
      where: { id: latest.id },
      data: { openFindings: open as unknown as Prisma.InputJsonValue },
    })
  }
}

/** 环节完成新 run 后，清空该环节更早 run 上的未闭环 findings（视为已被本轮工作处理） */
async function resolveEarlierFindings(novelId: string, nodeId: SopNodeId, exceptRunId: string) {
  await prisma.sopNodeRun.updateMany({
    where: { novelId, nodeId, id: { not: exceptRunId }, openFindings: { not: Prisma.DbNull } },
    data: { openFindings: Prisma.DbNull },
  })
}

/* 供 status.ts 与 e2e 直测复用 */
export { attachFindings, resolveEarlierFindings }
