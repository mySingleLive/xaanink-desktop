import { sceneFactions } from "./scene"
import { renderSceneContext } from "@/lib/scene-context"
import { sceneForest } from "@/lib/scene-tree"
/**
 * 情景试验场 AI 编排器：开局 / 逐回合推演 / 整理分镜 / 生成样文。
 *
 * 每回合形态（多代理 fan-out，照 runReaderPanel 先例）：
 *   N 个 actor agent 并行扮演（每角色独立调用 + 独立 SubAgentRun，只看到自己的内心）
 *   → 用户扮演角色的言行原样注入（source:"user"，既定事实）
 *   → director agent 汇总裁定 + 把本回合全部内容编排为时序流水 flow（旁白段与角色言/行/内心
 *     按发生先后穿插，角色项以 name 引用、落库前解析为 characterId）+ 提炼一句话情节点（落主干）
 *   → check agent 一致性把关（设定冲突/OOC/逻辑错误），不过带 feedback 重演 ≤ SCENARIO_CHECK_MAX_ROUNDS 轮
 *
 * 三个 LLM 步骤经 ScenarioEngineDeps 依赖注入（照 runCheckpointLoop 先例）：
 * e2e 注假函数秒测编排逻辑（fan-out 覆盖/重试/落库形状），默认实现走 generateJSON + 档案。
 */
import { z } from "zod"

import type { Character } from "@/generated/prisma/client"
import {
  buildNovelSections,
  loadCharacterAttributeNames,
  renderCharacter,
} from "@/lib/ai/context"
import { generateJSON, generateText } from "@/lib/ai/generate"
import { renderPrompt } from "@/lib/prompts/render"
import { prisma } from "@/lib/db"
import {
  normalizeScenarioBeats,
  normalizeScenarioCast,
  normalizeScenarioFlow,
  renderTurnFlow,
  resolveScenarioFlowNames,
  scenarioFlowFromBeats,
  scenarioFlowNarrative,
  SCENARIO_CHECK_MAX_ROUNDS,
  type ScenarioBeat,
  type ScenarioCastMember,
  type ScenarioCheckRecord,
  type ScenarioFlowItem,
  type ScenarioFlowTurn,
} from "@/lib/scenario-lab"
import {
  appendScenarioTurn,
  createScenarioNode,
  markScenarioActive,
  replaceScenarioCards,
  ScenarioLabNotFoundError,
  ScenarioStateError,
  setScenarioProse,
  type ScenarioCardDTO,
  type ScenarioLabDTO,
  type ScenarioTurnDTO,
} from "@/lib/services/scenario-lab"
import { completeRun, failRun, startRun } from "@/lib/services/subagent-run"

/** worldContext（主题+全量设定）塞进模板的上限——一致性需要全量设定，但也要给 N 个 actor 控制体量 */
const WORLD_CONTEXT_MAX = 8000
/** 样文渲染流水的上限（全回合全文，不设最近窗口） */
const PROSE_FLOW_MAX = 12000
/** actor 视角里其他角色的简介截取长度 */
const ROSTER_PROFILE_MAX = 120

// ── LLM 步骤的输入/输出与依赖注入 ─────────────────────────────────────

export interface ScenarioActorCall {
  userId: string
  novelId: string
  task: string
  member: ScenarioCastMember
  prompt: string
}

export interface ScenarioDirectorCall {
  userId: string
  novelId: string
  task: string
  prompt: string
}

export interface ScenarioCheckCall {
  userId: string
  novelId: string
  task: string
  prompt: string
}

export interface ScenarioActorResult {
  say?: string
  act?: string
  think?: string
  emotion?: string
}

/**
 * 导演裁定结果：flow = 本回合全部内容的时序流水（旁白段与角色言/行/内心按发生先后穿插，
 * 角色项用 name 引用本回合 beats 里的角色）；beatSummary = 一句话情节点（落主干）。
 */
export interface ScenarioDirectorResult {
  flow: ScenarioFlowItem[]
  beatSummary: string
}

export interface ScenarioCheckResult {
  ok: boolean
  score: number
  issues: string[]
}

/** 编排器的三个 LLM 步骤（e2e 注假函数即秒测；缺省为真实实现） */
export interface ScenarioEngineDeps {
  actorFn?: (call: ScenarioActorCall) => Promise<ScenarioActorResult>
  directorFn?: (call: ScenarioDirectorCall) => Promise<ScenarioDirectorResult>
  checkFn?: (call: ScenarioCheckCall) => Promise<ScenarioCheckResult>
}

const actorBeatSchema = z.object({
  say: z.string().default(""),
  act: z.string().default(""),
  think: z.string().default(""),
  emotion: z.string().default(""),
})

const directorResultSchema = z.object({
  flow: z
    .array(
      z.object({
        kind: z.enum(["narrative", "say", "act", "think"]),
        name: z.string().default(""),
        content: z.string().min(1),
      })
    )
    .min(1),
  beatSummary: z.string().min(1),
})

const checkResultSchema = z.object({
  ok: z.boolean(),
  score: z.number().min(0).max(100),
  issues: z.array(z.string()).default([]),
})

const organizeResultSchema = z.object({
  cards: z
    .array(
      z.object({
        nodeId: z.string().min(1),
        text: z.string().min(1),
        characterNames: z.array(z.string()).default([]),
        sceneNames: z.array(z.string()).default([]),
        sceneIds: z.array(z.string()).optional(),
      })
    )
    .min(1),
})

// ── 默认实现：generateJSON/generateText + SubAgentRun 档案（照 invokeAgent 先例） ──

async function defaultActorFn(call: ScenarioActorCall): Promise<ScenarioActorResult> {
  const run = await startRun({ novelId: call.novelId, agentKind: "scenarioActor", task: call.task })
  try {
    const { data, promptTokens, completionTokens } = await generateJSON({
      userId: call.userId,
      novelId: call.novelId,
      action: "scenario.actor",
      tier: "NORMAL",
      prompt: call.prompt,
      schema: actorBeatSchema,
    })
    const result: ScenarioActorResult = {
      say: data.say.trim() || undefined,
      act: data.act.trim() || undefined,
      think: data.think.trim() || undefined,
      emotion: data.emotion.trim() || undefined,
    }
    await completeRun(run.id, {
      transcript: { prompt: call.prompt, output: result },
      result,
      tokenUsage: { input: promptTokens, output: completionTokens },
    })
    return result
  } catch (err) {
    await failRun(run.id, err instanceof Error ? err.message : String(err))
    throw err
  }
}

async function defaultDirectorFn(call: ScenarioDirectorCall): Promise<ScenarioDirectorResult> {
  const run = await startRun({
    novelId: call.novelId,
    agentKind: "scenarioDirector",
    task: call.task,
  })
  try {
    const { data, promptTokens, completionTokens } = await generateJSON({
      userId: call.userId,
      novelId: call.novelId,
      action: "scenario.director",
      tier: "ADVANCED",
      prompt: call.prompt,
      schema: directorResultSchema,
    })
    await completeRun(run.id, {
      transcript: { prompt: call.prompt, output: data },
      result: data,
      tokenUsage: { input: promptTokens, output: completionTokens },
    })
    return data
  } catch (err) {
    await failRun(run.id, err instanceof Error ? err.message : String(err))
    throw err
  }
}

async function defaultCheckFn(call: ScenarioCheckCall): Promise<ScenarioCheckResult> {
  const run = await startRun({ novelId: call.novelId, agentKind: "scenarioCheck", task: call.task })
  try {
    const { data, promptTokens, completionTokens } = await generateJSON({
      userId: call.userId,
      novelId: call.novelId,
      action: "scenario.check",
      role: "review",
      tier: "ADVANCED",
      prompt: call.prompt,
      schema: checkResultSchema,
    })
    await completeRun(run.id, {
      transcript: { prompt: call.prompt, output: data },
      result: data,
      tokenUsage: { input: promptTokens, output: completionTokens },
    })
    return data
  } catch (err) {
    await failRun(run.id, err instanceof Error ? err.message : String(err))
    throw err
  }
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}……` : text
}

// ── 上下文组装 ────────────────────────────────────────────────────────

interface ScenarioContext {
  worldContext: string
  styleContext: string
  sceneContext: string
  /** cast 顺序的全量角色档案（director/check/prose 用） */
  castProfiles: string
  /** characterId → 全量档案（actor 自己用） */
  profileById: Map<string, string>
  /** actor 视角的同场名单（他人只给公开信息：姓名/身份/简介/外貌，动机与内心不给） */
  castRoster: string
}

async function buildScenarioContext(
  novelId: string,
  cast: ScenarioCastMember[],
  sceneIds: string[]
): Promise<ScenarioContext> {
  const ids = cast.map((m) => m.characterId)
  const [sections, characters, scenes, attrNames] = await Promise.all([
    buildNovelSections(novelId),
    ids.length
      ? prisma.character.findMany({ where: { novelId, id: { in: ids } } })
      : Promise.resolve([] as Character[]),
    prisma.scene.findMany({where: {novelId}, orderBy: {createdAt: "asc"}}),
    loadCharacterAttributeNames(novelId),
  ])
  const factions = await sceneFactions(novelId)
  if (sceneIds.some(id => !scenes.some(scene => scene.id === id))) throw new ScenarioStateError("参演场景已删除或不属于当前作品，请重新配置")
  const characterById = new Map(characters.map((c) => [c.id, c]))

  const profileById = new Map<string, string>()
  const rosterLines: string[] = []
  const profileBlocks: string[] = []
  for (const member of cast) {
    const c = characterById.get(member.characterId)
    if (!c) continue
    profileById.set(member.characterId, renderCharacter(c, attrNames))
    profileBlocks.push(renderCharacter(c, attrNames))
    const identity = [c.gender, c.occupation].filter(Boolean).join("，")
    rosterLines.push(
      `- ${member.name}${identity ? `（${identity}）` : ""}` +
        `${c.personality.trim() ? `：${clip(c.personality.trim(), ROSTER_PROFILE_MAX)}` : ""}` +
        `${c.appearance.trim() ? `\n  外貌：${clip(c.appearance.trim(), ROSTER_PROFILE_MAX)}` : ""}`
    )
  }

  return {
    worldContext: clip([sections.theme, sections.settings].filter(Boolean).join("\n\n"), WORLD_CONTEXT_MAX),
    styleContext: sections.style ?? "",
    sceneContext: sceneIds.map(id => renderSceneContext(scenes, id, factions)).join("\n\n") || "（未配置场景）",
    castProfiles: profileBlocks.join("\n\n") || "（无）",
    profileById,
    castRoster: rosterLines.join("\n") || "（无）",
  }
}

/** 读 lab 行 + 归属/状态校验（opening 要 draft、turn 要 active） */
async function getLabForRun(novelId: string, labId: string) {
  const lab = await prisma.scenarioLab.findUnique({ where: { id: labId } })
  if (!lab || lab.novelId !== novelId) throw new ScenarioLabNotFoundError()
  return lab
}

/** 当前流水 + 主干摘要映射（actor/director/check 共用） */
async function loadFlow(labId: string): Promise<{
  turns: ScenarioFlowTurn[]
  nodeSummaryByTurnId: Map<string, string>
}> {
  const [turns, nodes] = await Promise.all([
    prisma.scenarioTurn.findMany({ where: { labId }, orderBy: { index: "asc" } }),
    prisma.scenarioNode.findMany({ where: { labId }, orderBy: { index: "asc" } }),
  ])
  const nodeSummaryByTurnId = new Map<string, string>()
  for (const n of nodes) {
    if (n.turnId && n.text.trim()) nodeSummaryByTurnId.set(n.turnId, n.text.trim())
  }
  return {
    turns: turns.map((t) => ({
      id: t.id,
      index: t.index,
      kind: t.kind,
      narrative: t.narrative,
      beats: normalizeScenarioBeats(t.beats),
      flow: normalizeScenarioFlow(t.flow),
      direction: t.direction,
    })),
    nodeSummaryByTurnId,
  }
}

function renderUserAct(beat: ScenarioBeat | null): string {
  if (!beat) return "（无）"
  if (beat.say) return `${beat.name}说：「${beat.say}」`
  if (beat.act) return `${beat.name}行动：${beat.act}`
  return "（无）"
}

/** 回合内容渲染（check 的待审对象：全知视角单回合流水） */
function renderTurnContent(turn: ScenarioFlowTurn): string {
  return renderTurnFlow([turn], { recentTurns: 1 })
}

// ── 开局 ──────────────────────────────────────────────────────────────

/** 开局：director 依 premise（或自动切入）写开场叙述 + check 把关；落 turn 1 + 主干节点 1，状态转 active */
export async function runScenarioOpening(
  input: { userId: string; novelId: string; labId: string },
  deps?: ScenarioEngineDeps
): Promise<ScenarioTurnDTO> {
  const { userId, novelId, labId } = input
  const directorFn = deps?.directorFn ?? defaultDirectorFn
  const checkFn = deps?.checkFn ?? defaultCheckFn

  const lab = await getLabForRun(novelId, labId)
  if (lab.status !== "draft") {
    throw new ScenarioStateError("试验场已经开局了，想重新推演请先重置")
  }
  const cast = normalizeScenarioCast(lab.cast)
  if (cast.length === 0) throw new ScenarioStateError("先配置至少一名参演角色")
  if (lab.sceneIds.length === 0) throw new ScenarioStateError("先配置至少一个参演场景")

  const ctx = await buildScenarioContext(novelId, cast, lab.sceneIds)
  const premise = lab.premise.trim() || "（无——请根据角色与场景自然切入）"

  const checks: ScenarioCheckRecord[] = []
  let feedback = ""
  let result: ScenarioDirectorResult | null = null
  // 开局时序流水：只允许 narrative 段（无角色行动），角色项一律丢弃
  let flow: ScenarioFlowItem[] = []
  let narrative = ""
  for (let round = 1; round <= SCENARIO_CHECK_MAX_ROUNDS; round++) {
    const directorPrompt = await renderPrompt("scenario.director", {
      mode: "开局",
      premise,
      worldContext: ctx.worldContext,
      castProfiles: ctx.castProfiles,
      sceneContext: ctx.sceneContext,
      flowText: "（尚无剧情）",
      direction: "（无）",
      userAct: "（无）",
      roundBeats: "（开局无角色行动——你只写开场叙述，不替任何角色说话或做决定）",
      feedback: feedback || "（无）",
    })
    result = await directorFn({
      userId,
      novelId,
      task: `情景试验场·开局《${lab.title}》`,
      prompt: directorPrompt,
    })
    flow = resolveScenarioFlowNames(result.flow, new Map())
    narrative = scenarioFlowNarrative(flow)

    const checkPrompt = await renderPrompt("scenario.check", {
      worldContext: [ctx.worldContext, ctx.sceneContext].filter(Boolean).join("\n\n"),
      castProfiles: ctx.castProfiles,
      flowText: "（尚无剧情）",
      turnContent: renderTurnContent({
        index: 1,
        kind: "opening",
        narrative,
        beats: [],
        flow,
      }),
    })
    const check = await checkFn({
      userId,
      novelId,
      task: `情景试验场·开局一致性检查《${lab.title}》`,
      prompt: checkPrompt,
    })
    checks.push({ round, ok: check.ok, score: check.score, issues: check.issues })
    if (check.ok) break
    feedback = check.issues.join("\n")
  }

  const turn = await appendScenarioTurn(labId, {
    kind: "opening",
    narrative,
    beats: [],
    flow,
    checks,
  })
  await createScenarioNode(labId, { text: result!.beatSummary, turnId: turn.id })
  await markScenarioActive(labId)
  return turn
}

// ── 逐回合推演 ────────────────────────────────────────────────────────

export type ScenarioTurnInput = {
  /** 旁观用户的导演指示（与 act 互斥） */
  direction?: string
  /** 用户扮演角色的言行（与 direction 互斥；kind=say 说 / do 行动） */
  act?: { kind: "say" | "do"; content: string }
}

/**
 * 推进一回合：N 个 actor 并行 → 用户言行注入 → director 裁定 → check 把关（不过重演）→ 落库。
 * 返回落库后的完整回合（含 beats 与 checks 记录）。
 */
export async function runScenarioTurn(
  input: { userId: string; novelId: string; labId: string } & ScenarioTurnInput,
  deps?: ScenarioEngineDeps
): Promise<ScenarioTurnDTO> {
  const { userId, novelId, labId } = input
  const actorFn = deps?.actorFn ?? defaultActorFn
  const directorFn = deps?.directorFn ?? defaultDirectorFn
  const checkFn = deps?.checkFn ?? defaultCheckFn

  const lab = await getLabForRun(novelId, labId)
  if (lab.status !== "active") {
    throw new ScenarioStateError("试验场还没开局，先开始推演")
  }
  const cast = normalizeScenarioCast(lab.cast)
  if (cast.length === 0) throw new ScenarioStateError("参演名单是空的，请先配置角色")

  const userMember = cast.find((m) => m.control === "user") ?? null
  const direction = input.direction?.trim() || ""
  let userBeat: ScenarioBeat | null = null
  if (input.act?.content.trim()) {
    if (!userMember) {
      throw new ScenarioStateError("你没有在扮演任何角色——想以角色身份行动，先在配置里选「我来演」")
    }
    const content = input.act.content.trim()
    userBeat = {
      characterId: userMember.characterId,
      name: userMember.name,
      control: "user",
      ...(input.act.kind === "say" ? { say: content } : { act: content }),
      source: "user",
    }
  }

  const ctx = await buildScenarioContext(novelId, cast, lab.sceneIds)
  const { turns, nodeSummaryByTurnId } = await loadFlow(labId)
  const turnIndex = (turns[turns.length - 1]?.index ?? 0) + 1
  const aiMembers = cast.filter((m) => m.control === "ai")
  const userActText = renderUserAct(userBeat)
  const directionText = direction || "（无）"

  const checks: ScenarioCheckRecord[] = []
  let feedback = ""
  let beats: ScenarioBeat[] = []
  let directorResult: ScenarioDirectorResult | null = null
  // 本回合时序流水（导演编排的穿插顺序）与派生叙述全文
  let flow: ScenarioFlowItem[] = []
  let narrative = ""

  for (let round = 1; round <= SCENARIO_CHECK_MAX_ROUNDS; round++) {
    // 1. actor fan-out：每个 AI 角色独立扮演（只看到自己的内心；round>1 时带一致性修订意见）
    const actorOutputs = await Promise.all(
      aiMembers.map(async (member) => {
        const flowText = renderTurnFlow(turns, {
          viewerCharacterId: member.characterId,
          nodeSummaryByTurnId,
        })
        const prompt = await renderPrompt("scenario.actor", {
          characterProfile: ctx.profileById.get(member.characterId) ?? member.name,
          worldContext: ctx.worldContext,
          sceneContext: ctx.sceneContext,
          castRoster: ctx.castRoster,
          flowText,
          direction: directionText,
          userAct: userActText,
          feedback: feedback || "（无）",
        })
        const out = await actorFn({
          userId,
          novelId,
          task: `情景试验场·第${turnIndex}回合·扮演${member.name}《${lab.title}》`,
          member,
          prompt,
        })
        return { member, out }
      })
    )
    const aiBeats = new Map(actorOutputs.map((r) => [r.member.characterId, r.out]))

    // 2. 按 cast 顺序组装 beats（用户言行原样注入，既定事实）
    beats = []
    for (const member of cast) {
      if (member.control === "user") {
        if (userBeat) beats.push(userBeat)
        continue
      }
      const out = aiBeats.get(member.characterId)
      if (!out || (!out.say && !out.act && !out.think)) continue
      beats.push({
        characterId: member.characterId,
        name: member.name,
        control: "ai",
        ...(out.say ? { say: out.say } : {}),
        ...(out.act ? { act: out.act } : {}),
        ...(out.think ? { think: out.think } : {}),
        ...(out.emotion ? { emotion: out.emotion } : {}),
        source: "ai",
      })
    }

    // 3. director 汇总裁定（全知视角流水 + 本回合全部言行）
    const roundBeats = JSON.stringify(
      beats.map((b) => ({
        name: b.name,
        source: b.source,
        ...(b.say ? { say: b.say } : {}),
        ...(b.act ? { act: b.act } : {}),
        ...(b.think ? { think: b.think } : {}),
        ...(b.emotion ? { emotion: b.emotion } : {}),
      })),
      null,
      2
    )
    const directorPrompt = await renderPrompt("scenario.director", {
      mode: "推进",
      premise: lab.premise.trim() || "（无）",
      worldContext: ctx.worldContext,
      castProfiles: ctx.castProfiles,
      sceneContext: ctx.sceneContext,
      flowText: renderTurnFlow(turns, { nodeSummaryByTurnId }),
      direction: directionText,
      userAct: userActText,
      roundBeats,
      feedback: feedback || "（无）",
    })
    directorResult = await directorFn({
      userId,
      novelId,
      task: `情景试验场·第${turnIndex}回合·导演《${lab.title}》`,
      prompt: directorPrompt,
    })
    // 导演按名字引用本回合角色 → 解析为 characterId；未知名丢弃；全丢光则退化为 beats 固定顺序合成
    const nameToId = new Map(beats.map((b) => [b.name, b.characterId] as const))
    flow = resolveScenarioFlowNames(directorResult.flow, nameToId)
    if (flow.length === 0) flow = scenarioFlowFromBeats(beats)
    narrative = scenarioFlowNarrative(flow)

    // 4. check agent 一致性把关（设定冲突/OOC/逻辑错误）；不过带 issues 重演
    const checkPrompt = await renderPrompt("scenario.check", {
      worldContext: [ctx.worldContext, ctx.sceneContext].filter(Boolean).join("\n\n"),
      castProfiles: ctx.castProfiles,
      flowText: renderTurnFlow(turns, { nodeSummaryByTurnId }),
      turnContent: renderTurnContent({
        index: turnIndex,
        kind: "beat",
        narrative,
        beats,
        flow,
        direction: direction || null,
      }),
    })
    const check = await checkFn({
      userId,
      novelId,
      task: `情景试验场·第${turnIndex}回合·一致性检查《${lab.title}》`,
      prompt: checkPrompt,
    })
    checks.push({ round, ok: check.ok, score: check.score, issues: check.issues })
    if (check.ok) break
    feedback = check.issues.join("\n")
  }

  // 5. 落库：回合 + 主干情节点（beatSummary 自动派生，溯源 turnId）
  const turn = await appendScenarioTurn(labId, {
    kind: "beat",
    narrative,
    beats,
    flow,
    direction: direction || null,
    checks,
  })
  await createScenarioNode(labId, { text: directorResult!.beatSummary, turnId: turn.id })
  return turn
}

// ── 整理成分镜卡 ──────────────────────────────────────────────────────

/** 把主干情节点整理为分镜卡（全量替换旧卡）；角色/场景名解析为 id，名单外的丢弃（宁缺毋假） */
export async function organizeScenarioCards(input: {
  userId: string
  novelId: string
  labId: string
}): Promise<ScenarioCardDTO[]> {
  const { userId, novelId, labId } = input
  const lab = await getLabForRun(novelId, labId)
  const nodes = await prisma.scenarioNode.findMany({
    where: { labId },
    orderBy: { index: "asc" },
  })
  const visible = nodes.filter((n) => n.text.trim())
  if (visible.length === 0) {
    throw new ScenarioStateError("主干还没有情节点，先推进几回合再整理成分镜")
  }
  const cast = normalizeScenarioCast(lab.cast)
  const allScenes = await prisma.scene.findMany({where: {novelId}, orderBy: {createdAt: "asc"}})
  if (lab.sceneIds.some(id => !allScenes.some(scene => scene.id === id))) throw new ScenarioStateError("参演场景已删除或不属于当前作品，请重新配置")
  const scenes = allScenes.filter(scene => lab.sceneIds.includes(scene.id))
  const factions = await sceneFactions(novelId)
  const tree = sceneForest(allScenes)
  const nodesJson = JSON.stringify(
    visible.map((n) => ({ nodeId: n.id, text: n.text.trim() })),
    null,
    2
  )
  const prompt = await renderPrompt("scenario.organize", {
    nodesJson,
    castRoster: cast.map((m) => m.name).join("、") || "（无）",
    sceneRoster: scenes.length ? JSON.stringify(scenes.map(s => ({id: s.id, name: s.name, path: tree.path(s.id)}))) + "\n\n【上述参演场景的当前资料；祖先仅作环境来源，不能作为名单外参演ID输出】\n" + scenes.map(s => renderSceneContext(allScenes, s.id, factions)).join("\n\n") : "（无）",
  })
  const { data } = await generateJSON({
    userId,
    novelId,
    action: "scenario.organize",
    tier: "NORMAL",
    prompt,
    schema: organizeResultSchema,
  })

  const nodeIds = new Set(visible.map((n) => n.id))
  const characterIdByName = new Map(cast.map((m) => [m.name, m.characterId]))
  const validSceneIds = new Set(scenes.map(s => s.id))
  const cards = data.cards
    .filter((c) => nodeIds.has(c.nodeId) && c.text.trim())
    .map((c) => ({
      nodeId: c.nodeId,
      text: c.text.trim(),
      characterIds: c.characterNames
        .map((name) => characterIdByName.get(name))
        .filter((id): id is string => Boolean(id)),
      sceneIds: (() => {
        if (c.sceneIds !== undefined) {if (c.sceneIds.some(id => !validSceneIds.has(id))) throw new ScenarioStateError("整理结果包含无效或未配置的场景ID，原分镜保持不变"); return [...new Set(c.sceneIds)]}
        return c.sceneNames.map(name => {const matches = scenes.filter(s => s.name === name); if (matches.length !== 1) throw new ScenarioStateError(`场景「${name}」不存在或存在同名歧义，请使用ID；原分镜保持不变`); return matches[0].id})
      })(),
    }))
  if (cards.length === 0) {
    throw new ScenarioStateError("AI 整理的结果没有可用分镜卡，请重试")
  }
  return replaceScenarioCards(labId, cards)
}

// ── 生成样文 ──────────────────────────────────────────────────────────

/** 把推演流水改写成连贯正文（样文，落 lab.prose——与正文列表完全隔离） */
export async function generateScenarioProse(input: {
  userId: string
  novelId: string
  labId: string
}): Promise<ScenarioLabDTO> {
  const { userId, novelId, labId } = input
  const lab = await getLabForRun(novelId, labId)
  const cast = normalizeScenarioCast(lab.cast)
  const { turns, nodeSummaryByTurnId } = await loadFlow(labId)
  if (turns.length === 0) {
    throw new ScenarioStateError("还没有推演内容，先开局并推进几回合再生成样文")
  }

  const ctx = await buildScenarioContext(novelId, cast, lab.sceneIds)
  const flowText = renderTurnFlow(turns, {
    nodeSummaryByTurnId,
    recentTurns: turns.length,
    maxLength: PROSE_FLOW_MAX,
  })
  const prompt = await renderPrompt("scenario.prose", {
    worldContext: [ctx.worldContext, ctx.sceneContext].filter(Boolean).join("\n\n"),
    styleContext: ctx.styleContext || "（未设定文风，按题材自然处理）",
    castProfiles: ctx.castProfiles,
    flowText,
  })

  const run = await startRun({
    novelId,
    agentKind: "scenarioWriter",
    task: `情景试验场·生成样文《${lab.title}》`,
  })
  try {
    const { text, promptTokens, completionTokens } = await generateText({
      userId,
      novelId,
      action: "scenario.prose",
      tier: "ADVANCED",
      prompt,
    })
    const prose = text.trim()
    await completeRun(run.id, {
      transcript: { prompt, output: prose },
      result: { words: prose.length },
      tokenUsage: { input: promptTokens, output: completionTokens },
    })
    return await setScenarioProse(labId, prose)
  } catch (err) {
    await failRun(run.id, err instanceof Error ? err.message : String(err))
    throw err
  }
}
