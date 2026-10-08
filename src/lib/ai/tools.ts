import { taskDefaults } from "@desktop/service/task-defaults"
import { createSceneSchema, sceneFieldsSchema } from "@/lib/scene-schema"
import { sceneForest } from "@/lib/scene-tree"
import { renderSceneContext } from "@/lib/scene-context"
import { createPlanningTools } from "./planning-tools"
import { planningSchema } from "@/lib/planning/domain"
import { tool, type ToolSet } from "ai"
import { randomUUID } from "node:crypto"
import { z } from "zod"

import { Prisma } from "@/generated/prisma/client"
import {
  AttributeTarget,
  AttributeValueType,
  NovelStage,
  SettingType,
  TropeKind,
} from "@/generated/prisma/enums"
import { buildNovelContext } from "@/lib/ai/context"
import { arcStageListSchema } from "@/lib/arc-stage"
import { normalizeBigFive } from "@/lib/big-five"
import { planProposalSchema } from "@/lib/chat-parts"
import { currentChatExecution } from "@/lib/chat-execution"
import { prisma } from "@/lib/db"
import { tentativeNovelTitle } from "@/lib/novel-title"
import { contentHash, requestHash } from "@/lib/services/content-commit"
import { chapterImprovementIntent, improveChapterContent } from "@/lib/services/content-improvement"
import { getChapterFinalizationChecklist } from "@/lib/services/chapter-finalization"
import { assessChapterNarrative, narrativeGateMessage } from "@/lib/services/narrative-assessment"
import { drawChapterCandidates, getChapterDrawState } from "@/lib/services/chapter-draw"
import { revertCandidateReplacement } from "@/lib/services/content-candidate"
import { ContentError } from "@/lib/content-errors"
import { worldNameSchema, worldIdSchema } from "@/lib/world-schema"
import * as attributeService from "@/lib/services/attribute"
import * as chapterService from "@/lib/services/chapter"
import * as characterService from "@/lib/services/character"
import * as characterImageService from "@/lib/services/character-image"
import * as coverImageService from "@/lib/services/cover-image"
import * as foreshadowCharacterService from "@/lib/services/foreshadow-character"
import * as foreshadowService from "@/lib/services/foreshadow"
import * as itemService from "@/lib/services/item"
import * as outlineService from "@/lib/services/outline"
import * as reviewService from "@/lib/services/review"
import * as sceneService from "@/lib/services/scene"
import * as scoreReportService from "@/lib/services/score-report"
import * as settingService from "@/lib/services/setting"
import { mapPlaceholderSaveOptions } from "@/lib/services/map-placeholder"
import * as subAgentRunService from "@/lib/services/subagent-run"
import * as stageService from "@/lib/services/stage"
import { createStoryWorkflowTools } from "./story-workflow-tools"
import { getStoryWorkflow, reviewStoryCheckpoint, recordInstanceLoopEvidence } from "@/lib/services/story-workflow"
import * as textCommentService from "@/lib/services/text-comment"
import * as themeService from "@/lib/services/theme"
import * as tropeService from "@/lib/services/trope"
import * as worldService from "@/lib/services/world"
import * as sopPlanService from "@/lib/sop/plan"
import * as sopRunner from "@/lib/sop/runner"
import * as sopStatusService from "@/lib/sop/status"
import { isWorldSettingType, SETTING_TYPE_LABELS } from "@/lib/setting-types"

/** 工具执行上下文：由 API 路由按会话注入 */
export interface AgentToolContext {
  userId: string
  /** 会话关联的小说；null 表示未关联（不挂载任何工具） */
  novelId: string | null
  /** 当前会话 id：SOP 计划自动打勾与子代理档案关联用（2026-08） */
  conversationId?: string | null
}

/** 写工具统一返回结构：前端工具卡片据此展示 ✓/✗ 与中文摘要 */
export interface ToolOutcome {
  ok: boolean
  message: string
  candidates?: { id: string; name: string; parentId: string | null }[]
}

const SETTING_TYPES = z.enum(SettingType)
const TROPE_KINDS = z.enum(TropeKind)
const ATTRIBUTE_TARGETS = z.enum(AttributeTarget)
const ATTRIBUTE_VALUE_TYPES = z.enum(AttributeValueType)

/** 阶段弧线入参语义说明（createCharacter/updateCharacter 共用） */
const ARC_STAGES_TOOL_DESCRIBE =
  "阶段弧线卡片链：数组顺序 = 时间先后（≤50 张）；空数组时弧线回退 backstory/growthArc 两文本字段。" +
  "每张卡 { id（唯一字符串）, name 阶段名（≤50 字）, markers 阶段定位 [{ kind: age 年龄 / event 事件 / custom 自定义, text ≤50 字 }]（≤6 条）, " +
  "startChapter 起始章节快照 { chapterId, volumeId, label（如「第 1 卷 风起青萍 · 第 3 章 退婚」）} 或 null（不确定时传 null）, " +
  "changes 属性变化 [{ section: identity 身份·外在 / psyche 心理 / ability 能力 / relation 关系, field 字段 key, value 该阶段此属性的新状态 }]（≤12 条）——" +
  "field 必须取自该板块词表：identity = name/aliases/age/gender/occupation/bio/personality/appearance/height/weight/build/faceShape/clothing/tastes/habits/catchphrase/dialogueStyle/sampleDialogue；" +
  "psyche = personalityTags/motivations/desires/fears/beliefs/bigFive；ability = abilities/attributes；relation = relationships。" +
  "value 与字段本体同构（text/textarea 为字符串、aliases/personalityTags 为字符串数组、bigFive 为五维 0~100 对象、beliefs 为观念对象、motivations 为分层数组、relationships 为关系条目数组、attributes 为 [{ definitionId, value }]）。" +
  "description 阶段描述（≤2000 字）, tags 阶段性质标签（转折/低谷/高光等，≤8 个）, " +
  "isDebut 是否首次出场阶段（全链最多一张；其前卡片自动视为出场前经历，无出场卡则整链视为登场后） }"

/** 物品字段 schema（createItem/updateItem 共用；上限与 items 路由 zod / 服务层规整器一致） */
const itemAliasesSchema = z
  .array(z.string().trim().min(1).max(50))
  .max(10)
  .optional()
  .describe("别名/别称列表（≤10 个，单个 ≤50 字）；正文提到别名也会被识别为该物品")
const itemTagsSchema = z
  .array(z.string().trim().min(1).max(20))
  .max(8)
  .optional()
  .describe("标签列表（≤8 个，单个 ≤20 字），标识物品性质，如 法宝/消耗品/成长型")
const itemAppearanceSchema = z.string().max(2000).optional().describe("外形描写（≤2000 字）")
const itemAcquisitionSchema = z.string().max(2000).optional().describe("获取方式（≤2000 字）")
const itemEffectsSchema = z
  .array(
    z.object({
      name: z.string().trim().max(30).default("").describe("功效名（可空，≤30 字）"),
      description: z.string().trim().min(1).max(500).describe("功效说明（≤500 字）"),
    })
  )
  .max(20)
  .optional()
  .describe("功效列表（≤20 条）")
const itemLevelsSchema = z
  .array(
    z.object({
      settingId: z.string().trim().min(1).describe("等级体系设定 id（用 getSetting 按 LEVEL_SYSTEM 类型查询）"),
      pathway: z.string().trim().min(1).max(50).nullable().default(null).describe("途径名；单途径体系传 null，多途径体系必传"),
      level: z.string().trim().min(1).max(50).describe("等级名"),
    })
  )
  .max(10)
  .optional()
  .describe("等级引用列表（≤10 条）。settingId 必须引用本书「适用对象为物品或通用」（LEVEL_SYSTEM 的 scope 为 ITEM 或 GENERAL）的等级体系；单途径体系 pathway 传 null，多途径体系必传途径名")

function ok(message: string): ToolOutcome {
  return { ok: true, message }
}

/** 工具错误消息的最大长度（避免整段调用栈回灌给模型） */
const FAIL_MESSAGE_MAX = 200

/**
 * Prisma 抛错的 message 里带调用栈与打包产物路径，对模型和作者都是噪音，
 * 这里压成一句人话：已知错误码给固定文案，其余取最后一行原因并截断。
 */
function fail(err: unknown): ToolOutcome {
  if (err instanceof worldService.WorldAmbiguousError) return { ok: false, message: err.message, candidates: err.candidates }
  if (!(err instanceof Error)) {
    return { ok: false, message: typeof err === "string" ? err : "操作失败" }
  }
  const code = (err as { code?: unknown }).code
  if (code === "P2002") {
    return { ok: false, message: "已存在同名或同序号的记录，请换个名称，或重新读取现状后重试" }
  }
  if (code === "P2025") {
    return { ok: false, message: "目标记录不存在或已被删除，请重新读取现状后再操作" }
  }
  const lines = err.message.split("\n").map((l) => l.trim()).filter(Boolean)
  const reason = lines[lines.length - 1] ?? "操作失败"
  return {
    ok: false,
    message: reason.length > FAIL_MESSAGE_MAX ? `${reason.slice(0, FAIL_MESSAGE_MAX)}…` : reason,
  }
}

/**
 * 工具返回值必须是 JSON 可序列化的纯数据。
 * Prisma 行含 Date 等对象，直接返回会让 AI SDK 在构建下一轮
 * prompt 时校验 ModelMessage 失败（jsonValueSchema 不接受 Date）。
 */
function jsonSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** 校验章节属于当前小说，返回章节（含卷）；找不到时报错并附当前章节清单，让模型立刻自我纠正 */
async function requireChapter(novelId: string, chapterId: string) {
  const chapter = await chapterService.getChapter(chapterId)
  if (!chapter || chapter.volume.novelId !== novelId) {
    throw new Error(await chapterNotFoundMessage(novelId))
  }
  return chapter
}

/** 章节找不到时的报错文案：附当前小说的章节清单（章次 + 标题 + id），抄错 id 也能当场拿回正确值 */
async function chapterNotFoundMessage(novelId: string): Promise<string> {
  const volumes = await prisma.volume.findMany({
    where: { novelId },
    orderBy: { index: "asc" },
    include: {
      chapters: { orderBy: { index: "asc" }, select: { id: true, index: true, title: true } },
    },
  })
  const list = volumes.flatMap((v) =>
    v.chapters.map((c) => `第${v.index}卷第${c.index}章《${c.title}》id=${c.id}`)
  )
  return `章节不存在或不属于当前小说。当前章节清单：${list.join("；") || "（还没有章节，先用 createVolume/createChapter 建大纲）"}`
}

/** 校验角色属于当前小说 */
async function requireCharacter(novelId: string, characterId: string) {
  const character = await characterService.getCharacter(characterId)
  if (!character || character.novelId !== novelId) {
    throw new Error("角色不存在或不属于当前小说")
  }
  return character
}

/** 校验卷属于当前小说 */
async function requireVolume(novelId: string, volumeId: string) {
  const volume = await prisma.volume.findUnique({ where: { id: volumeId } })
  if (!volume || volume.novelId !== novelId) {
    throw new Error("卷不存在或不属于当前小说，可用 getOutline 查看卷 id")
  }
  return volume
}

/** 正文预览截取长度（工具返回给模型，避免整章回灌上下文） */
const CONTENT_PREVIEW_LENGTH = 200

/**
 * 取父世界 id；不存在就先建一个同名占位世界。
 * 与子地图同一个坑：模型习惯把「主世界 + 各子世界」一批并行提交，
 * 子世界先落地时父世界还没建好，硬报错会让整批子世界连环失败；
 * 占位世界的介绍随后由父世界自己的 createWorld/updateWorld 覆盖。
 */
async function resolveParentWorldId(novelId: string, parentName: string): Promise<string> {
  return worldService.resolveOrCreateParentWorld(novelId, parentName)
}

/**
 * 取上级地图 id；不存在就先建一个同名占位地图。
 * 模型常把「父地图 + 各子地图」并行提交，子地图先落地时父地图还没建好，
 * 硬报错会让整批子地图连环失败；占位地图的内容随后由父地图自己的 upsert 覆盖。
 */
async function resolveParentMapId(
  novelId: string,
  worldId: string,
  parentMap: string
): Promise<string> {
  const found = async () =>
    prisma.setting.findFirst({ where: { novelId, worldId, type: "MAP", name: parentMap } })

  const existing = await found()
  if (existing) return existing.id
  try {
    const created = await settingService.upsertSetting({
      novelId,
      type: "MAP",
      name: parentMap,
      content: { text: "" },
      worldId,
      parentId: null,
    })
    return created.id
  } catch (err) {
    // 并发下可能已被同批的另一次调用建好，重查一次再决定
    const again = await found()
    if (again) return again.id
    throw err
  }
}

/**
 * 对话里推进创作阶段：让「创作流程」进度条跟上对话进度
 * （advanceNovelStage 只前进不回退，失败不影响写操作本身）。
 * 只在主干里程碑上推进；世界地图等阶段顺序靠后的类型不推进，
 * 免得越过角色/爽点阶段。
 */
async function advanceStageQuietly(novelId: string, target: NovelStage) {
  try {
    await stageService.advanceNovelStage(novelId, target)
  } catch (err) {
    console.warn(`[chat.tools] 推进创作阶段失败（novel=${novelId} → ${target}）：`, err)
  }
}

/** 三阶段保存：从当前回合 action 读暂存批次（重试/恢复同源） */
async function readStagedAction() {
  const scope = currentChatExecution()
  if (!scope?.turnId) return null
  const turn = await prisma.chatTurn.findUnique({ where: { id: scope.turnId }, select: { action: true } })
  const { parseStagedSaveAction } = await import("@/lib/staged-save")
  return parseStagedSaveAction(turn?.action)
}

/** 影响面分析用库内权威名（别名一并计入由调用方决定，这里只取主名） */
async function resolveTargetName(kind: string, id: string): Promise<string | null> {
  switch (kind) {
    case "WORLD": return (await prisma.world.findUnique({ where: { id }, select: { name: true } }))?.name ?? null
    case "SETTING": return (await prisma.setting.findUnique({ where: { id }, select: { name: true } }))?.name ?? null
    case "CHARACTER": return (await prisma.character.findUnique({ where: { id }, select: { name: true } }))?.name ?? null
    case "ITEM": return (await prisma.item.findUnique({ where: { id }, select: { name: true } }))?.name ?? null
    case "SCENE": return (await prisma.scene.findUnique({ where: { id }, select: { name: true } }))?.name ?? null
    case "FORESHADOW": return (await prisma.foreshadow.findUnique({ where: { id }, select: { title: true } }))?.title ?? null
    case "CHAPTER_CONTENT":
    case "CHAPTER_OUTLINE": return (await prisma.chapter.findUnique({ where: { id }, select: { title: true } }))?.title ?? null
    default: return null
  }
}

/**
 * 构建 AI 对话 Agent 的工具集（读写小说设定与内容）。
 * novelId 通过闭包绑定，模型无需（也不能）指定小说；
 * 未关联小说时可建书，后续执行从服务端会话解析小说归属。
 */
export function createAgentTools(ctx: AgentToolContext): ToolSet {
  if (!ctx.novelId) {
    // 未选作品也可从聊天起步；工具结构不变，执行时按当前会话解析书籍归属。
    const definitions = createAgentTools({ ...ctx, novelId: "unbound" })
    const scoped = Object.fromEntries(Object.entries(definitions).map(([name, definition]) => [name, { ...definition, execute: async (input: unknown, options: Parameters<NonNullable<typeof definition.execute>>[1]) => {
      const conversation = ctx.conversationId ? await prisma.conversation.findFirst({ where: { id: ctx.conversationId, userId: ctx.userId }, select: { novelId: true } }) : null
      if (!conversation?.novelId && !["askUserQuestion", "proposePlan"].includes(name)) return fail("当前尚无作品，请先通过 startNovelFromChat 保存本次创作，再继续")
      const actual = conversation?.novelId ? createAgentTools({ ...ctx, novelId: conversation.novelId })[name] : definition
      return actual.execute!(input, options)
    } }]))
    return { ...scoped, startNovelFromChat: tool({ description: "从聊天灵感创建独立小说并关联当前会话，不需要填写表单。调用前提：已与作者共创出简报要素（主角、目标、世界方向），故事核心成形，且书名经作者确认或作者明确同意先用暂定名。不要替作者起正式风格的书名；书名未确认就不传 title，服务端会用中性占位名「未命名作品·M月D日」，之后可随时在聊天中定题改名。建书后继续共创与工具调用。", inputSchema: z.object({ premise: z.string().trim().min(1).max(500).describe("一句话故事核心（主角 + 目标/冲突），存为新作品的初始简介"), title: z.string().trim().min(1).max(100).optional().describe("作者确认过的书名；未确认则不传，用中性占位名") }), execute: async ({ premise, title }) => {
      try {
        const scope = currentChatExecution()
        if (!ctx.conversationId || !scope?.operationId) return fail("缺少有效会话，作品尚未创建")
        if (!premise?.trim()) return fail("缺少故事核心（premise）：请先与作者共创简报要素，再用一句话概括后建书")
        const conversation = await prisma.conversation.findFirst({ where: { id: ctx.conversationId, userId: ctx.userId }, select: { novelId: true } })
        if (!conversation) return fail("会话不存在或无权访问")
        if (conversation.novelId) return { ok: true, novel: await prisma.novel.findFirst({ where: { id: conversation.novelId, userId: ctx.userId, status: { not: "DELETED" } }, select: { id: true, title: true } }), message: "当前会话已有作品，请继续创作；若要新建另一部作品，请开始新会话" }
        const { startConversationNovel } = await import("@desktop/service/conversation-runtime")
        const created = await startConversationNovel(scope, { title: title?.trim() || tentativeNovelTitle(), premise: premise.trim() })
        if (!created) return { ok: false, message: "未选择作品目录，作品尚未创建；原聊天与草稿已保留。" }
        const novel = created.receipt
        scope.progress?.({ novelCreated: { id: novel.id, title: novel.title } })
        return { ok: true, novel, message: "作品已创建并关联当前会话。继续使用创作工具，从作者已有灵感开始补齐故事。" }
      } catch (error) { return fail(error) }
    } }) }
  }
  const { userId, novelId } = ctx
  const conversationId = ctx.conversationId ?? null
  const operationIds = new Map<string, string>()
  const operationFor = (toolName: string, toolCallId: string) => {
    const operationId = currentChatExecution()?.operationId
    if (operationId) return requestHash({ operationId, toolName })
    const key = `${toolName}:${toolCallId}`
    if (!operationIds.has(key)) operationIds.set(key, randomUUID())
    return operationIds.get(key)!
  }

  return {
    ...createStoryWorkflowTools({ userId, novelId }),
    ...createPlanningTools({ userId, novelId }),
    // ---------- 交互 ----------
    askUserQuestion: tool({
      description:
        "需要作者拍板时（方向多选一、方案确认、授权批准、关键设定取舍等）弹出问答面板让作者选择。给出 1~4 个问题，每个问题 2~5 个具体可执行的选项；不要自己加「其他」选项（面板会自动附带自由输入框）。选项序号风格（A/B/C、1/2/3、甲/乙/丙）由你按语境气质临时选择，经 markerStyle 传入。确认高成本操作（生成章节正文、整本重建大纲、批量出图）时必须同时传 costEstimate，面板会向作者展示预估消耗。调用后必须立即用一句话收尾结束本轮回复，不得再调用任何工具；作者的回答会以新消息送达。开放式讨论、需要大段自由回答的问题不要用这个工具，直接在回复文字里问。",
      inputSchema: z.object({
        questions: z
          .array(
            z.object({
              question: z.string().min(1).max(500).describe("要问作者的问题"),
              options: z
                .array(z.string().min(1).max(200))
                .min(2)
                .max(5)
                .describe("候选选项，具体可执行"),
            })
          )
          .min(1)
          .max(4),
        markerStyle: z
          .enum(["letters", "numbers", "stems"])
          .optional()
          .describe(
            "选项序号风格：letters=A/B/C（默认）、numbers=1/2/3、stems=甲/乙/丙。按语境气质挑，古风/玄学/武侠题材用 stems 更有味道"
          ),
        costEstimate: z
          .discriminatedUnion("kind", [
            z.object({
              kind: z.literal("chapterContent"),
              wordCount: z.number().int().positive().optional(),
            }),
            z.object({
              kind: z.literal("characterImages"),
              count: z.number().int().positive(),
            }),
            z.object({ kind: z.literal("outlineRebuild") }),
          ])
          .optional()
          .describe(
            "高成本操作确认时必传（面板据此向作者展示预估消耗/耗时）：chapterContent=生成章节正文（wordCount 目标字数，不传按 3000）/ outlineRebuild=整本重建大纲 / characterImages=批量出图（count 张数；出图不消耗墨滴，面板改显示耗时说明）。普通提问不要传。"
          ),
      }),
      execute: async ({ questions }) => ({
        ...ok(
          "问题已展示给作者。请立即用一句话收尾结束本轮回复，不要再调用任何工具；作者的回答会以「【回答问题】…我的回答：…」格式的新消息送达。"
        ),
        questions,
      }),
    }),

    // ---------- 读 ----------
    getNovelOverview: tool({
      description: "获取小说概览：主题信息 + 设定/角色/卷章数量摘要。需要快速了解小说全貌时调用。",
      inputSchema: z.object({}),
      execute: async () => {
        const novel = await prisma.novel.findUnique({
          where: { id: novelId },
          include: {
            theme: true,
            _count: { select: { settings: true, characters: true, volumes: true, tropes: true } },
          },
        })
        if (!novel) return fail("小说不存在")
        const chapterCount = await prisma.chapter.count({
          where: { volume: { novelId } },
        })
        return jsonSafe({
          title: novel.title,
          stage: novel.currentStage,
          theme: novel.theme,
          counts: { ...novel._count, chapters: chapterCount },
        })
      },
    }),

    getNovelContext: tool({
      description:
        "获取小说完整创作上下文（主题、全部设定、角色、爽点/泪点的全文，较长）。需要完整设定细节时再调用，优先用更精确的工具。",
      inputSchema: z.object({}),
      execute: async () => buildNovelContext(novelId),
    }),

    getWorlds: tool({
      description:
        "列出小说的世界树（id/名称/父世界/介绍摘要）。操作世界或世界级设定前先确认 ID；不同层级可以合法同名。",
      inputSchema: z.object({}),
      execute: async () => {
        const worlds = await worldService.listWorlds(novelId)
        if (worlds.length === 0) return "（暂无世界，可用 createWorld 创建）"
        return jsonSafe(
          worlds.map((w) => ({
            id: w.id,
            name: w.name,
            parentId: w.parentId,
            description: w.description.slice(0, 200),
            baseline: { version: null, updatedAt: w.updatedAt.toISOString(), hash: contentHash(w.description) },
          }))
        )
      },
    }),

    getSetting: tool({
      description: `按类型读取设定内容。世界级类型（LEVEL_SYSTEM 等级体系 / POWER_SYSTEM 力量体系 / CONCEPT 概念体系 / FACTION 势力分布 / MAP 世界地图 / SOCIETY 社会环境 / CULTURE 人文环境 / GEOGRAPHY 地理环境 / WORLD_HISTORY 世界历史）可传 world 限定某个世界，不传则返回全部世界的该类型；小说级类型（GOLD_FINGER 金手指 / STYLE 文风）无需 world。传 name 精确匹配单条。`,
      inputSchema: z.object({
        type: SETTING_TYPES.describe("设定类型"),
        name: z.string().optional().describe("设定名称，不传则返回该类型全部"),
        world: worldNameSchema.optional().describe("兼容世界名称；同名时必须指定 worldId"),
        worldId: worldIdSchema.optional().describe("所属世界 ID，优先于名称"),
      }),
      execute: async ({ type, name, world, worldId }) => {
        let settings
        if (isWorldSettingType(type)) {
          if (world || worldId) {
            let w
            try { w = await worldService.resolveWorldReference(novelId, { id: worldId, name: world }) } catch (error) { return fail(error) }
            if (!w) return fail(new Error("世界不存在或不属于本作品，请用 getWorlds 查看已有世界"))
            settings = await settingService.listSettings(novelId, { type, worldId: w.id })
          } else {
            settings = await prisma.setting.findMany({
              where: { novelId, type, worldId: { not: null } },
              orderBy: { createdAt: "asc" },
            })
          }
        } else {
          settings = await settingService.listSettings(novelId, { type })
        }
        const filtered = name ? settings.filter((s) => s.name === name) : settings
        if (filtered.length === 0) {
          return `（暂无${SETTING_TYPE_LABELS[type]}设定${name ? `「${name}」` : ""}${world ? `，世界：${world}` : ""}）`
        }
        // 附带世界名与上级地图名，便于后续 upsertSetting 定位
        const worldIds = [
          ...new Set(filtered.map((s) => s.worldId).filter((id): id is string => !!id)),
        ]
        const worlds = await prisma.world.findMany({ where: { id: { in: worldIds } } })
        const parentIds = [
          ...new Set(filtered.map((s) => s.parentId).filter((id): id is string => !!id)),
        ]
        const parents = await prisma.setting.findMany({ where: { id: { in: parentIds } } })
        return filtered.map((s) => ({
          id: s.id,
          name: s.name,
          world: worlds.find((w) => w.id === s.worldId)?.name ?? null,
          parentMap: parents.find((p) => p.id === s.parentId)?.name ?? null,
          content: s.content,
          version: s.version,
        }))
      },
    }),

    getCharacter: tool({
      description: "按名字读取角色的完整设定（性格/外貌/口头禅/关系/成长弧线等）。",
      inputSchema: z.object({ name: z.string().describe("角色名字") }),
      execute: async ({ name }) => {
        const character = await prisma.character.findFirst({ where: { novelId, name } })
        if (!character) return `（不存在角色「${name}」）`
        return jsonSafe(character)
      },
    }),

    listCharacters: tool({
      description:
        "列出小说的全部角色（id/名字/定位/身份摘要，不含长文本）。需要角色 id 或想确认已有哪些角色时调用。",
      inputSchema: z.object({}),
      execute: async () => {
        const characters = await prisma.character.findMany({
          where: { novelId },
          orderBy: [{ roleType: "asc" }, { createdAt: "asc" }],
          select: { id: true, name: true, roleType: true, gender: true, occupation: true, age: true },
        })
        if (characters.length === 0) return "（暂无角色，可用 createCharacter 创建）"
        return jsonSafe(characters)
      },
    }),

    listReviews: tool({
      description:
        "查看评审记录（AI 评分与逐条意见、作者是否已确认通过）。不传参数返回全书最近的评审；传 targetId 只看某卷/某章。需要按评审意见改进内容时先调用。",
      inputSchema: z.object({
        targetType: z
          .enum(["VOLUME_OUTLINE", "CHAPTER_OUTLINE", "CHAPTER_CONTENT"])
          .optional()
          .describe("评审类型，不传则不限"),
        targetId: z.string().optional().describe("卷 id 或章节 id，不传则不限"),
      }),
      execute: async ({ targetType, targetId }) => {
        const reviews = await prisma.review.findMany({
          where: { novelId, ...(targetType ? { targetType } : {}), ...(targetId ? { targetId } : {}) },
          orderBy: { createdAt: "desc" },
          take: 10,
        })
        if (reviews.length === 0) return "（暂无评审记录，可用 requestAIReview 发起评审）"
        return jsonSafe(
          reviews.map((r) => ({
            id: r.id,
            targetType: r.targetType,
            targetId: r.targetId,
            aiScore: r.aiScore,
            aiComments: r.aiComments,
            humanStatus: r.humanStatus,
            humanComment: r.humanComment,
          }))
        )
      },
    }),

    getScoreReport: tool({
      description:
        "查看某内容目标（章正文/章大纲/卷大纲）的评分报告：综合分、评委多维度评分与逐条意见（含原文引用）、读者团各人设试读评分与感受建议、是否评审中/评分是否已过时。「按意见改进」流程先调用它读回最新评分与意见全貌（比 listReviews 更全：含维度分与读者团）。",
      inputSchema: z.object({
        targetType: z
          .enum([
            "CHAPTER_CONTENT",
            "CHAPTER_OUTLINE",
            "VOLUME_OUTLINE",
          ])
          .describe("CHAPTER_CONTENT 章正文 / CHAPTER_OUTLINE 章大纲 / VOLUME_OUTLINE 卷大纲"),
        targetId: z.string().describe("目标 id（章节 id / 卷 id）"),
      }),
      execute: async ({ targetType, targetId }) => {
        try {
          const report = await scoreReportService.getScoreReport(novelId, targetType, targetId)
          return jsonSafe({
            targetLabel: report.targetLabel,
            score: report.score,
            scoredAt: report.scoredAt,
            stale: report.stale,
            reviewing: report.reviewing,
            dimensions: report.dimensions,
            agents: report.agents.map((a) => ({
              kind: a.kind,
              name: a.name,
              score: a.score,
              summary: a.summary,
              items: a.items,
              at: a.at,
            })),
          })
        } catch (err) {
          return fail(err)
        }
      },
    }),

    getOutline: tool({
      description: "读取分卷大纲树：各卷标题/简介及每章的 id、标题、章大纲（不含正文）。",
      inputSchema: z.object({}),
      execute: async () => {
        const tree = await outlineService.getOutlineTree(novelId)
        if (tree.length === 0) return "（尚未生成大纲）"
        return jsonSafe(tree)
      },
    }),

    getChapterContent: tool({
      description: "读取某章正文内容（chapterId 可从 getOutline 结果获得）。",
      inputSchema: z.object({ chapterId: z.string().describe("章节 id") }),
      execute: async ({ chapterId }) => {
        try {
          const chapter = await requireChapter(novelId, chapterId)
          return {
            chapterId: chapter.id,
            title: chapter.title,
            version: chapter.version,
            contentHash: contentHash(chapter.content),
            status: chapter.status,
            wordCount: chapter.wordCount,
            content: chapter.content || "（正文为空）",
          }
        } catch (err) {
          return fail(err)
        }
      },
    }),

    listTropes: tool({
      description: "列出爽点/泪点库：平台预置条目 + 本小说自定义条目，含选中状态与条目 id。",
      inputSchema: z.object({}),
      execute: async () => tropeService.listTropeLibrary(novelId),
    }),

    listItems: tool({
      description: "列出小说的全部物品（id/名称/描述）。更新或删除物品前先调用获取 id。",
      inputSchema: z.object({}),
      execute: async () => {
        const items = await itemService.listItems(novelId)
        if (items.length === 0) return "（暂无物品，可用 createItem 创建）"
        return jsonSafe(items.map((i) => ({ id: i.id, name: i.name, description: i.description })))
      },
    }),

    listScenes: tool({
      description: "读取全部层级场景及版本、父级、路径、全部资料与具体势力有效性。修改前读取版本；图片仅表示有无，不能声称看到像素。",
      inputSchema: z.object({}),
      execute: async () => { const rows = await sceneService.listScenes(novelId); const tree = sceneForest(rows); const factions = await sceneService.sceneFactions(novelId); return jsonSafe(rows.map(row => ({...row, path: tree.path(row.id), factionValid: !row.factionId || factions.some(f => f.id === row.factionId && f.settingId === row.factionSettingId)}))) },
    }),
    getSceneContext: tool({
      description: "按场景ID读取完整本层资料、根到父级环境/进入条件/势力摘要及直接子场景。相邻、名称前缀或共同势力不能当作包含关系。",
      inputSchema: z.object({sceneId: z.string()}),
      execute: async ({sceneId}) => { try {await sceneService.ownedScene(prisma, {novelId, userId}, sceneId); return renderSceneContext(await sceneService.listScenes(novelId), sceneId, await sceneService.sceneFactions(novelId))} catch (error) {return fail(error)} },
    }),

    listAttributes: tool({
      description: "列出小说的全部自定义属性定义（id/名称/适用对象/值类型/选项）。",
      inputSchema: z.object({}),
      execute: async () => {
        const defs = await attributeService.listAttributeDefinitions(novelId)
        if (defs.length === 0) return "（暂无属性定义，可用 upsertAttribute 创建）"
        return jsonSafe(
          defs.map((d) => ({
            id: d.id,
            name: d.name,
            description: d.description,
            targets: d.targets,
            valueType: d.valueType,
            options: d.options,
          }))
        )
      },
    }),

    // ---------- 写 ----------
    upsertTheme: tool({
      description: "创建或整体更新小说主题（书名/简介/频道/篇幅/题材/标签/核心卖点/目标受众/参考案例）。作者定位由服务端保留，调整定位须请作者在主题面板修改并保存。",
      inputSchema: z.object({
        title: z.string().describe("书名"),
        synopsis: z.string().describe("简介"),
        referenceCases: z.string().describe("参考案例（对标作品）"),
        channel: z.string().describe("频道，如男频/女频"),
        genre: z.string().describe("题材，如玄幻/都市"),
        length: z.string().optional().describe("篇幅：微型/短篇/中篇/长篇；未指定为空"),
        tags: z.array(z.string()).describe("标签数组"),
        sellingPoints: z.string().describe("核心卖点"),
        targetAudience: z.string().describe("目标受众"),
      }),
      execute: async (data) => {
        try {
          const theme = await themeService.upsertTheme(novelId, data)
          await advanceStageQuietly(novelId, "SETTING")
          return { ...ok(`已更新主题《${theme.title}》`), position: { channel: theme.channel, genre: theme.genre, length: theme.length, tags: theme.tags } }
        } catch (err) {
          return fail(err)
        }
      },
    }),

    createWorld: tool({
      description:
        "创建一个世界（一本小说可含多个世界，支持树形嵌套，如大千世界下套小千世界）。创建后可用 updateWorld 补充世界观介绍，用 upsertSetting 为其添加等级/力量体系/地图等设定。",
      inputSchema: z.object({
        name: worldNameSchema.describe("世界名称"),
        parentName: worldNameSchema.optional().describe("兼容父世界名称；有多个匹配时必须使用 parentId"),
        parentId: worldIdSchema.optional().describe("父世界 ID，优先于名称"),
        description: z.string().optional().describe("世界观文字介绍"),
      }),
      execute: async ({ name, parentName, parentId: selectedParentId, description }) => {
        try {
          const parent = selectedParentId ? await worldService.resolveWorldReference(novelId, { id: selectedParentId }) : null
          if (selectedParentId && !parent) return fail(new Error("父世界不存在或不属于本作品"))
          const parentId = parent?.id ?? (parentName ? await resolveParentWorldId(novelId, parentName) : null)
          const world = await worldService.createWorld(novelId, { name, parentId, description })
          await advanceStageQuietly(novelId, "SETTING")
          return {
            ...ok(`已创建世界「${name}」${parentName ? `（父世界：${parentName}）` : ""}`),
            worldId: world.id,
          }
        } catch (err) {
          return fail(err)
        }
      },
    }),

    updateWorld: tool({
      description:
        "按 worldId 更新世界名称、世界观介绍或父级。兼容唯一名称定位；重名时先读 getWorlds，不能猜选节点。",
      inputSchema: z.object({
        worldId: worldIdSchema.optional().describe("世界 ID，优先使用"),
        name: worldNameSchema.optional().describe("兼容当前唯一名称"),
        newName: worldNameSchema.optional().describe("新名称"),
        baseline: z.object({ version: z.null(), updatedAt: z.string(), hash: z.string() }).describe("getWorlds 返回的原世界基线"),
        description: z.string().optional().describe("新的世界观介绍"),
        parentId: worldIdSchema.nullable().optional().describe("新父世界 ID；null 为根级"),
        parentName: worldNameSchema
          .nullable()
          .optional()
          .describe("新的父世界名称；传 null 表示移为顶级世界"),
      }).refine(value => !!value.worldId || !!value.name, "请提供世界 ID 或唯一名称"),
      execute: async ({ worldId, name, newName, description, parentName, parentId: selectedParentId, baseline }, { toolCallId }) => {
        try {
          const world = await worldService.resolveWorldReference(novelId, { id: worldId, name })
          if (!world) return fail(new Error("世界不存在或不属于本作品"))
          let parentId: string | null | undefined
          if (selectedParentId !== undefined) {
            if (selectedParentId === null) parentId = null
            else {
              const parent = await worldService.resolveWorldReference(novelId, { id: selectedParentId })
              if (!parent) return fail(new Error("父世界不存在或不属于本作品"))
              parentId = parent.id
            }
          } else if (parentName !== undefined) {
            if (parentName === null) {
              parentId = null
            } else {
              const parent = await worldService.resolveWorldReference(novelId, { name: parentName })
              if (!parent) return fail(new Error(`不存在父世界「${parentName}」`))
              parentId = parent.id
            }
          }
          const updated = await worldService.updateWorld(world.id, { name: newName, description, parentId }, { userId, baseline, operationId: operationFor("world", toolCallId) })
          return { ...ok(`已更新世界「${updated.name}」`), worldId: world.id }
        } catch (err) {
          return fail(err)
        }
      },
    }),

    upsertSetting: tool({
      description: `创建或更新一条设定（按 作用域+类型+名称 覆盖）。世界级类型必须用 world 指定所属世界；世界地图（MAP）可再传 parentMap 创建/更新子地图（上级地图还不存在时会自动建一个同名占位地图，之后再 upsert 它本身即可补全内容）。content 为 JSON 对象，结构按类型固定：
- POWER_SYSTEM/MAP/SOCIETY/CULTURE/GEOGRAPHY/WORLD_HISTORY（纯文本）：{ "text": "正文" }
- LEVEL_SYSTEM：{ "scope": "CHARACTER/ITEM/GENERAL", "form": "SINGLE/MULTI_PATHWAY", "description": "体系介绍", "rules": "等级规则", "levels": [LevelNode], "pathways": [{ "name": "途径名", "aliases": ["别名"], "tags": ["标签"], "description": "途径介绍", "levels": [LevelNode] }] }。LevelNode = { "name": "等级名", "aliases": ["别名"], "tags": ["标签"], "condition": "进阶条件", "description": "描述", "abilities": [{ "name": "能力名", "description": "能力描述" }], "children": [LevelNode] }。scope 为体系使用对象：CHARACTER 角色 / ITEM 物品 / GENERAL 通用（角色物品均可，缺省按 GENERAL）；form 为组织形态：SINGLE 单途径（一条等级阶梯，读写 levels）、MULTI_PATHWAY 多途径（多条并行途径，各自一套 levels，读写 pathways，如《诡秘之主》22 条神之途径）；创建后 form 不可更改。description 概述体系本身，rules 写晋升/互斥/代价等通用规则（如「途径之间不可交互晋升」），均可为空字符串。levels 数组顺序即等级从低到高的次序；children 可无限嵌套子等级（如 炼气 → 炼气一层）；pathways 数组顺序仅为展示顺序（途径无高低之分）。aliases 承载同一名称在不同体系/语境下的叫法；tags 标识特殊性（如 低序列/中序列/高序列/天使序列）；均可为空数组。
- CONCEPT：{ "concepts": [{ "term": "术语", "explanation": "解释" }] }
- GOLD_FINGER：{ "trigger": "触发条件", "ability": "能力", "limitation": "限制" }
- STYLE：{ "style": "文风描述", "referenceCases": "参考案例", "dialogueMark": "对话符号（DOUBLE_QUOTE=“xxx” / SQUARE_BRACKET=[xxx] / CORNER_BRACKET=「xxx」 / DOUBLE_CORNER_BRACKET=『xxx』）", "innerDialogueMark": "心理对话符号（NONE=无符号 / PARENTHESES=(xxx) / LENTICULAR_BRACKET=【xxx】）" }（省略两个符号字段时分别默认为 DOUBLE_QUOTE 与 NONE）
- FACTION：保持已有条目的 id 和未知字段；缺 id 仅唯一旧名称可匹配，删除后重建同名是新身份。{ "factions": [{ "id": "已有条目id，新条目可省略", "name": "势力名", "description": "描述", "relations": "与其他势力关系" }] }
修改已有设定时先用 getSetting 读出原内容，在其基础上改动后整体提交。`,
      inputSchema: z.object({
        type: SETTING_TYPES.describe("设定类型"),
        name: z.string().describe("设定名称"),
        content: z
          .record(z.string(), z.unknown())
          .describe("设定内容 JSON，结构见工具描述"),
        world: worldNameSchema.optional().describe("兼容所属世界名称；世界级类型指定此项或 worldId"),
        worldId: worldIdSchema.optional().describe("所属世界 ID，优先于名称"),
        parentMap: z.string().optional().describe("上级地图名称（仅 MAP 子地图使用）"),
        expectedVersion: z.number().int().positive().optional().describe("修改已有设定必填：getSetting 返回的 version；新建可省略"),
      }),
      execute: async ({ type, name, content, world, worldId: selectedWorldId, parentMap, expectedVersion }, { toolCallId }) => {
        try {
          let worldId: string | null = null
          let parentId: string | null = null
          if (isWorldSettingType(type)) {
            if (!world && !selectedWorldId) {
              return fail(new Error(`${SETTING_TYPE_LABELS[type]}属于世界级设定，请用 world 参数指定所属世界`))
            }
            const w = await worldService.resolveWorldReference(novelId, { id: selectedWorldId, name: world })
            if (!w) {
              return fail(new Error("世界不存在或不属于本作品，可先用 getWorlds 核对或 createWorld 创建"))
            }
            worldId = w.id
            if (parentMap) {
              if (type !== "MAP") {
                return fail(new Error("只有世界地图（MAP）支持上级地图"))
              }
              parentId = await resolveParentMapId(novelId, worldId, parentMap)
            }
          }
          const operationId = operationFor("setting", toolCallId)
          const placeholder = type === "MAP" && worldId
            ? await mapPlaceholderSaveOptions({ userId, novelId, worldId, name, operationId })
            : undefined
          const saveOptions = expectedVersion !== undefined
            ? { userId, expectedVersion, operationId }
            : placeholder
          const saved = placeholder
            ? (await settingService.updateSetting(placeholder.settingId, { content: content as Prisma.InputJsonValue, parentId }, { ...saveOptions!, cascade: false })).setting
            : await settingService.upsertSetting({
            novelId,
            type,
            name,
            content: content as Prisma.InputJsonValue,
            worldId,
            parentId,
            saveOptions,
          })
          // 文风单独有阶段；其余设定统一停在「设定」阶段
          await advanceStageQuietly(novelId, type === "STYLE" ? "STYLE" : "SETTING")
          const parent = parentId ? await prisma.setting.findUnique({ where: { id: parentId }, select: { id: true, name: true, version: true, content: true } }) : null
          return { ...ok(`已保存${SETTING_TYPE_LABELS[type]}设定「${name}」${world ? `（世界：${world}）` : ""}`), settingId: saved.id, version: saved.version, ...(parent ? { parentMap: jsonSafe(parent) } : {}) }
        } catch (err) {
          return fail(err)
        }
      },
    }),

    createCharacter: tool({
      description:
        "新建角色。创建前可用 getNovelContext 或 getCharacter 检查是否撞设。" +
        "角色资料分六大板块：身份（姓名/别名/简介/人物描述）、外在（外貌/穿衣风格/品味偏好/行为习惯/口头禅/对话风格/示例对话）、心理（性格标签/性格五维/核心动机/核心欲望/核心恐惧/观念）、能力、弧线（出场前经历/成长弧线/阶段弧线卡片链）、关系。建角色时按作者提供的信息尽量填全，没提供的关键项（外貌、动机）必须补全。",
      inputSchema: z.object({
        name: z.string().describe("角色名字"),
        roleType: z
          .enum(["PROTAGONIST", "SUPPORTING", "ANTAGONIST"])
          .describe("PROTAGONIST 主角 / SUPPORTING 配角 / ANTAGONIST 反派"),
        aliases: z
          .array(z.string())
          .default([])
          .describe("别名/外号：昵称性质的别称，如「老陈」「沉默的大多数」。注意：同一个人物的不同身份（本名/化名/马甲/代号）不是别名，要建成多个角色"),
        age: z.string().default("").describe("年龄"),
        gender: z.string().default("").describe("性别"),
        occupation: z.string().default("").describe("职业/身份"),
        bio: z
          .string()
          .default("")
          .describe("角色简介：一句话概括角色的个人故事线（从哪来、正经历什么、要到哪去），如「退役刑警转行私家侦探，追查悬案时被卷入更大的阴谋」"),
        personality: z
          .string()
          .default("")
          .describe("人物描述：这个角色总体上是怎样一个人（性格底色、行事风格、内在矛盾等）"),
        personalityTags: z
          .array(z.string())
          .default([])
          .describe("性格标签：纯性格短词，如「内向」「腼腆」「护短」，也可用 MBTI 如「INTP」；1~6 个为宜"),
        appearance: z.string().default("").describe("外貌总述：整体外观辨识度（气质/伤疤/标志性特征等自由描述）"),
        height: z.string().default("").describe("身高，如「183cm」"),
        weight: z.string().default("").describe("体重，如「74kg」"),
        build: z.string().default("").describe("身材，如「瘦削结实」「魁梧」"),
        faceShape: z.string().default("").describe("脸型，如「瘦长有棱角」「圆脸」"),
        clothing: z.string().default("").describe("穿衣风格：具体穿着与饰品，以及抽象风格（衣服会换但风格一致）"),
        tastes: z.string().default("").describe("品味偏好：衣食住行的具象偏好，如喜欢走路上班、五分熟牛排、骑某品牌自行车"),
        habits: z.string().default("").describe("行为习惯：体态与应激小动作、标志性动作，如思考时捏头发、紧张时抬镜框、走路外八"),
        catchphrase: z.string().default("").describe("口头禅"),
        dialogueStyle: z.string().default("").describe("对话风格：语速/句式/用词倾向，如短句冷峻、爱反问、文绉绉掉书袋"),
        sampleDialogue: z.string().default("").describe("示例对话：2~4 句能代表这个角色说话方式的台词样例"),
        desires: z
          .string()
          .default("")
          .describe("核心欲望：无原因、发自内心/本能的长期想要（决定角色容易被什么吸引）；与动机不同——欲望不紧迫、没有为什么"),
        fears: z.string().default("").describe("核心恐惧：角色最害怕面对的事物/情境"),
        beliefs: z
          .object({
            worldview: z.string().optional().describe("世界观：如何看待这个世界中的事物"),
            values: z.string().optional().describe("价值观：如何判断对错、该不该做、值不值得做"),
            outlook: z.string().optional().describe("人生观：如何看待自己和别人的人生"),
            other: z.string().optional().describe("其他思想观念"),
          })
          .default({})
          .describe("观念：四键均可选，只填有内容的"),
        bigFive: z
          .object({
            openness: z.number().int().min(0).max(100).describe("开放性：0=务实守常 100=好奇求新"),
            conscientiousness: z.number().int().min(0).max(100).describe("尽责性：0=随性散漫 100=自律条理"),
            extraversion: z.number().int().min(0).max(100).describe("外向性：0=孤僻安静 100=热情健谈"),
            agreeableness: z.number().int().min(0).max(100).describe("宜人性：0=多疑对抗 100=信任利他"),
            neuroticism: z.number().int().min(0).max(100).describe("神经质：0=沉稳淡定 100=敏感焦虑"),
          })
          .nullable()
          .default(null)
          .describe(
            "Big Five 性格五维（人格主结构，各 0~100）：角色性格的骨架，必须先有人物描述/性格标签再据其推定、互相印证（内向腼腆→外向性给低、严谨自律→尽责性给高、多疑→宜人性偏低），要有区分度、不给五维全 50 的中庸值；它将直接驱动正文与台词中该角色的说话与行事基调。建角色时必须给出推定值——人物描述与标签都是你刚写的，信息足够；不得为省事传 null，null 仅用于作者明确要求留空"
          ),
        abilities: z
          .string()
          .default("")
          .describe("能力总述：角色自身的本事——基本能力（力量/智力/知识面）与小说世界的特殊能力（魔力/功法等）。只写这个角色会什么，力量体系规则本身归设定，不在此展开"),
        backstory: z.string().default("").describe("出场前经历：角色登场前的过往与记忆"),
        relationships: z
          .array(z.object({ target: z.string(), description: z.string() }))
          .default([])
          .describe("人物关系：[{ target: 对象角色名, description: 关系描述 }]"),
        growthArc: z.string().default("").describe("成长弧线：角色在全书中的成长与变化（起点 → 转折 → 终点）"),
        motivations: z
          .array(
            z.object({
              items: z
                .array(
                  z.object({
                    text: z.string(),
                    importance: z.number().int().min(1).max(5).default(3),
                  })
                )
                .min(1),
            })
          )
          .default([])
          .describe(
            "核心动机：角色一切言行、决策与成长的根本驱动力。层有序——第 1 层最表面、末层最根本（洋葱式真相链）；每层 items 可并列多个动机；importance=重要性 1~5（一般给 3）。简单人物一层一条即可"
          ),
        arcStages: arcStageListSchema.default([]).describe(ARC_STAGES_TOOL_DESCRIBE),
      }),
      execute: async (data) => {
        try {
          // bigFive 拆出单独处理：null（未评估）时不传该字段（可空 Json 列不接受裸 JS null）
          const { bigFive, ...rest } = data
          const character = await characterService.createCharacter(novelId, {
            ...rest,
            aliases: rest.aliases as Prisma.InputJsonValue,
            personalityTags: rest.personalityTags as Prisma.InputJsonValue,
            motivations: rest.motivations as Prisma.InputJsonValue,
            beliefs: rest.beliefs as Prisma.InputJsonValue,
            relationships: rest.relationships as Prisma.InputJsonValue,
            arcStages: rest.arcStages as unknown as Prisma.InputJsonValue,
            ...(bigFive !== null ? { bigFive: bigFive as Prisma.InputJsonValue } : {}),
          })
          await advanceStageQuietly(novelId, "CHARACTER")
          return {
            ...ok(
              bigFive === null
                ? `已创建角色「${data.name}」（注意：本次未传性格五维。若人物描述/性格标签已确定，请立即用 updateCharacter 补上 bigFive 推定值——五维是正文与台词的言行准绳，不应留空）`
                : `已创建角色「${data.name}」`
            ),
            // 供 generateCharacterImage 直接串接，省掉一次 getCharacter
            characterId: character.id,
          }
        } catch (err) {
          return fail(err)
        }
      },
    }),

    updateCharacter: tool({
      description:
        "更新角色设定（局部字段）。characterId 先用 getCharacter 获取；只传需要修改的字段，其余保持原值。字段含义同 createCharacter（六大板块）。",
      inputSchema: z.object({
        characterId: z.string().describe("角色 id"),
        expectedVersion: z.number().int().positive().optional().describe("getCharacter读取的version，防止覆盖作者同时编辑的内容"),
        name: z.string().optional(),
        roleType: z.enum(["PROTAGONIST", "SUPPORTING", "ANTAGONIST"]).optional(),
        aliases: z.array(z.string()).optional().describe("别名/外号（覆盖式）"),
        age: z.string().optional(),
        gender: z.string().optional(),
        occupation: z.string().optional(),
        bio: z.string().optional().describe("角色简介：一句话概括角色的个人故事线"),
        personality: z.string().optional().describe("人物描述：这个角色总体上是怎样一个人"),
        personalityTags: z
          .array(z.string())
          .optional()
          .describe("性格标签（覆盖式）：纯性格短词，如「内向」「INTP」"),
        appearance: z.string().optional().describe("外貌总述"),
        height: z.string().optional().describe("身高"),
        weight: z.string().optional().describe("体重"),
        build: z.string().optional().describe("身材"),
        faceShape: z.string().optional().describe("脸型"),
        clothing: z.string().optional().describe("穿衣风格"),
        tastes: z.string().optional().describe("品味偏好"),
        habits: z.string().optional().describe("行为习惯：体态与应激小动作、标志性动作"),
        catchphrase: z.string().optional(),
        dialogueStyle: z.string().optional().describe("对话风格"),
        sampleDialogue: z.string().optional().describe("示例对话（2~4 句）"),
        desires: z.string().optional().describe("核心欲望：无原因、本能的长期想要"),
        fears: z.string().optional().describe("核心恐惧"),
        beliefs: z
          .object({
            worldview: z.string().optional(),
            values: z.string().optional(),
            outlook: z.string().optional(),
            other: z.string().optional(),
          })
          .optional()
          .describe("观念（覆盖式）：{ worldview 世界观, values 价值观, outlook 人生观, other 其他 }"),
        bigFive: z
          .object({
            openness: z.number().int().min(0).max(100),
            conscientiousness: z.number().int().min(0).max(100),
            extraversion: z.number().int().min(0).max(100),
            agreeableness: z.number().int().min(0).max(100),
            neuroticism: z.number().int().min(0).max(100),
          })
          .nullable()
          .optional()
          .describe(
            "Big Five 性格五维（覆盖式，各 0~100）：角色性格的骨架；不传则保留作者手调值，作者改了人物描述/性格标签时才据新描述同步重估；传 null 清除为未评估"
          ),
        abilities: z.string().optional().describe("能力总述：角色自身的本事"),
        backstory: z.string().optional().describe("出场前经历"),
        relationships: z
          .array(z.object({ target: z.string(), description: z.string() }))
          .optional(),
        growthArc: z.string().optional().describe("成长弧线"),
        motivations: z
          .array(
            z.object({
              items: z
                .array(
                  z.object({
                    text: z.string(),
                    importance: z.number().int().min(1).max(5).default(3),
                  })
                )
                .min(1),
            })
          )
          .optional()
          .describe("核心动机（覆盖式）：层有序——第 1 层最表面、末层最根本；每层 items 可并列多条；importance 1~5"),
        arcStages: arcStageListSchema
          .optional()
          .describe("（整体替换：传入即全量覆盖现有卡片链，不做逐卡深合并；不传则保持原值）" + ARC_STAGES_TOOL_DESCRIBE),
      }),
      execute: async ({ characterId, expectedVersion, ...patch }) => {
        try {
          const existing = await requireCharacter(novelId, characterId)
          const merged = {
            name: patch.name ?? existing.name,
            roleType: patch.roleType ?? existing.roleType,
            age: patch.age ?? existing.age,
            gender: patch.gender ?? existing.gender,
            occupation: patch.occupation ?? existing.occupation,
            bio: patch.bio ?? existing.bio,
            personality: patch.personality ?? existing.personality,
            appearance: patch.appearance ?? existing.appearance,
            height: patch.height ?? existing.height,
            weight: patch.weight ?? existing.weight,
            build: patch.build ?? existing.build,
            faceShape: patch.faceShape ?? existing.faceShape,
            clothing: patch.clothing ?? existing.clothing,
            tastes: patch.tastes ?? existing.tastes,
            habits: patch.habits ?? existing.habits,
            catchphrase: patch.catchphrase ?? existing.catchphrase,
            dialogueStyle: patch.dialogueStyle ?? existing.dialogueStyle,
            sampleDialogue: patch.sampleDialogue ?? existing.sampleDialogue,
            desires: patch.desires ?? existing.desires,
            fears: patch.fears ?? existing.fears,
            abilities: patch.abilities ?? existing.abilities,
            backstory: patch.backstory ?? existing.backstory,
            growthArc: patch.growthArc ?? existing.growthArc,
            aliases: (patch.aliases ?? existing.aliases ?? []) as Prisma.InputJsonValue,
            personalityTags: (patch.personalityTags ??
              existing.personalityTags ??
              []) as Prisma.InputJsonValue,
            relationships: (patch.relationships ??
              existing.relationships ??
              []) as Prisma.InputJsonValue,
            motivations: (patch.motivations ??
              existing.motivations ??
              []) as Prisma.InputJsonValue,
            beliefs: (patch.beliefs ?? existing.beliefs ?? {}) as Prisma.InputJsonValue,
            arcStages: (patch.arcStages ?? existing.arcStages ?? []) as Prisma.InputJsonValue,
            ...(patch.bigFive !== undefined
              ? {
                  bigFive:
                    patch.bigFive === null
                      ? Prisma.DbNull
                      : (patch.bigFive as Prisma.InputJsonValue),
                }
              : {}),
          }
          await characterService.updateCharacter(characterId, merged, expectedVersion ?? existing.version)
          // 五维仍为未评估且本次改了人物描述/性格标签时，提醒同步补评（五维是言行准绳）
          const bigFiveStillUnset =
            patch.bigFive === undefined && normalizeBigFive(existing.bigFive) === null
          const personalityTouched =
            patch.personality !== undefined || patch.personalityTags !== undefined
          return ok(
            bigFiveStillUnset && personalityTouched
              ? `已更新角色「${merged.name}」的设定（注意：该角色性格五维仍未评估。本次改了人物描述/性格标签，请再用 updateCharacter 传入 bigFive 同步重估）`
              : `已更新角色「${merged.name}」的设定`
          )
        } catch (err) {
          return fail(err)
        }
      },
    }),

    generateCharacterImage: tool({
      description:
        "为角色生成头像（正方形面部特写）或立绘（竖版全身像）并保存为该角色的当前图像。" +
        "kind 传 both 时一次生成头像与立绘两张。characterId 从 createCharacter 的返回值或 getCharacter 获得。" +
        "每张图要花作者的钱且耗时约 20 秒，必须在作者明确表示要生成之后才调用，不要主动替作者决定。" +
        "promptHint 可补充画面细节（如「站在煤气路灯下」），构图、时代氛围与画风由平台按小说主题自动补齐。",
      inputSchema: z.object({
        characterId: z.string().describe("角色 id"),
        kind: z
          .enum(["avatar", "portrait", "both"])
          .describe("avatar 头像 / portrait 立绘 / both 两张都生成"),
        promptHint: z
          .string()
          .optional()
          .describe("画面补充描述，可选；不传则完全按角色的外貌与服饰资料生成"),
      }),
      execute: async ({ characterId, kind, promptHint }) => {
        try {
          const character = await requireCharacter(novelId, characterId)
          const kinds =
            kind === "both" ? (["avatar", "portrait"] as const) : ([kind] as const)
          // 时代语境按小说主题算一次，两张图共用，保证同一角色的头像与立绘同源
          const context = await characterImageService.resolveImageContext(novelId)

          const done: string[] = []
          const failed: string[] = []
          // 结构化产物（前端图片卡片按此渲染；urls 文本保留给模型阅读）
          const images: { kind: "avatar" | "portrait"; url: string }[] = []
          for (const one of kinds) {
            try {
              const result = await characterImageService.generateCharacterImage({
                novelId,
                characterId,
                kind: one,
                prompt: promptHint,
                context,
              })
              done.push(`${one === "avatar" ? "头像" : "立绘"}（${result.url}）`)
              images.push({ kind: one, url: result.url })
            } catch (err) {
              const reason = err instanceof Error ? err.message : "生成失败"
              failed.push(`${one === "avatar" ? "头像" : "立绘"}：${reason.slice(0, 100)}`)
            }
          }

          if (done.length === 0) {
            return { ok: false, message: `角色「${character.name}」的图像生成失败 — ${failed.join("；")}` }
          }
          return {
            ...ok(
              `已为角色「${character.name}」生成并保存${done.join("、")}` +
                (failed.length > 0 ? `；未完成：${failed.join("；")}` : "")
            ),
            urls: done,
            images,
          }
        } catch (err) {
          return fail(err)
        }
      },
    }),

    generateNovelCover: tool({
      description:
        "为小说生成封面图并设为当前封面（2:3 竖版）。每生成一张都要花时间与外部费用，必须在作者明确表示要生成封面之后才调用，不要主动替作者决定。" +
        "prompt 可选：不传则按书名/简介/类型标签自动拼装；传了则视为完整画面提示词原样使用（作者给过明确画面要求时才传）。",
      inputSchema: z.object({
        prompt: z
          .string()
          .optional()
          .describe("完整画面提示词（可选）；不传按作品资料自动拼装"),
      }),
      execute: async ({ prompt }) => {
        try {
          const { url, image } = await coverImageService.generateNovelCover({
            novelId,
            prompt,
            promptIsComplete: !!prompt?.trim(),
          })
          return { ...ok("已生成封面并设为当前封面"), coverUrl: url, imageId: image.id }
        } catch (err) {
          return fail(err)
        }
      },
    }),

    deleteCharacter: tool({
      description: "删除角色（不可恢复，调用前确认作者意图）。",
      inputSchema: z.object({ characterId: z.string().describe("角色 id") }),
      execute: async ({ characterId }) => {
        try {
          const existing = await requireCharacter(novelId, characterId)
          await characterService.deleteCharacter(characterId)
          return ok(`已删除角色「${existing.name}」`)
        } catch (err) {
          return fail(err)
        }
      },
    }),

    createItem: tool({
      description: "新建物品（如法宝、丹药、信物）。除名称外均可选：aliases 别名、tags 标签、appearance 外形、acquisition 获取方式、effects 功效、levels 等级引用。",
      inputSchema: z.object({
        name: z.string().describe("物品名称"),
        description: z.string().default("").describe("物品描述"),
        aliases: itemAliasesSchema,
        tags: itemTagsSchema,
        appearance: itemAppearanceSchema,
        acquisition: itemAcquisitionSchema,
        effects: itemEffectsSchema,
        levels: itemLevelsSchema,
      }),
      execute: async ({ name, description, aliases, tags, appearance, acquisition, effects, levels }) => {
        try {
          const item = await itemService.createItem(novelId, {
            name,
            description,
            ...(aliases !== undefined ? { aliases } : {}),
            ...(tags !== undefined ? { tags } : {}),
            ...(appearance !== undefined ? { appearance } : {}),
            ...(acquisition !== undefined ? { acquisition } : {}),
            ...(effects !== undefined ? { effects } : {}),
            ...(levels !== undefined ? { levels } : {}),
            attributes: [],
          })
          return { ...ok(`已创建物品「${name}」`), itemId: item.id }
        } catch (err) {
          return fail(err)
        }
      },
    }),

    updateItem: tool({
      description: "更新物品字段（itemId 先用 listItems 获取；只传需要修改的字段，未传字段保持不变）。可改名称/描述/别名/标签/外形/获取方式/功效/等级引用。",
      inputSchema: z.object({
        itemId: z.string().describe("物品 id"),
        name: z.string().optional(),
        description: z.string().optional(),
        aliases: itemAliasesSchema,
        tags: itemTagsSchema,
        appearance: itemAppearanceSchema,
        acquisition: itemAcquisitionSchema,
        effects: itemEffectsSchema,
        levels: itemLevelsSchema,
      }),
      execute: async ({ itemId, ...patch }) => {
        try {
          const existing = await prisma.item.findUnique({ where: { id: itemId } })
          if (!existing || existing.novelId !== novelId) return fail("物品不存在或不属于当前小说")
          await itemService.updateItem(itemId, {
            name: patch.name ?? existing.name,
            description: patch.description ?? existing.description,
            attributes: existing.attributes as Prisma.InputJsonValue,
            ...(patch.aliases !== undefined ? { aliases: patch.aliases } : {}),
            ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
            ...(patch.appearance !== undefined ? { appearance: patch.appearance } : {}),
            ...(patch.acquisition !== undefined ? { acquisition: patch.acquisition } : {}),
            ...(patch.effects !== undefined ? { effects: patch.effects } : {}),
            ...(patch.levels !== undefined ? { levels: patch.levels } : {}),
          })
          return ok(`已更新物品「${patch.name ?? existing.name}」`)
        } catch (err) {
          return fail(err)
        }
      },
    }),

    deleteItem: tool({
      description: "删除物品（不可恢复，调用前确认作者意图）。",
      inputSchema: z.object({ itemId: z.string().describe("物品 id") }),
      execute: async ({ itemId }) => {
        try {
          const existing = await prisma.item.findUnique({ where: { id: itemId } })
          if (!existing || existing.novelId !== novelId) return fail("物品不存在或不属于当前小说")
          await itemService.deleteItem(itemId)
          return ok(`已删除物品「${existing.name}」`)
        } catch (err) {
          return fail(err)
        }
      },
    }),

    createScene: tool({
      description: "创建任意尺度的场景树：明确包含时先创建父级再传 parentId，可多根、多兄弟、任意深度。相邻/名称前缀/共同势力不代表包含。先 listScenes 核对；同父同名唯一时复用且不覆盖原资料，多匹配时报歧义；失败后保留成功节点，只补缺项。",
      inputSchema: createSceneSchema,
      execute: async data => {try {const scene = await sceneService.createScene(novelId, data, {userId, reuse: true}); return {...ok(`场景「${scene.name}」已就绪`), sceneId: scene.id, parentId: scene.parentId, version: scene.version}} catch (error) {return fail(error)}},
    }),
    updateScene: tool({
      description: "修改场景实际变更字段。expectedVersion 使用 listScenes/getSceneContext 读到的版本；parentId 调整包含关系，服务端拒绝环及同级重名；所属势力使用具体条目的 settingId+id。",
      inputSchema: sceneFieldsSchema.extend({sceneId: z.string(), expectedVersion: z.number().int().positive()}),
      execute: async ({sceneId, expectedVersion, ...patch}, {toolCallId}) => {try {const scene = await sceneService.updateScene(sceneId, patch, {novelId, userId, expectedVersion, operationId: operationFor("updateScene", toolCallId)}); return {...ok(`已更新场景「${scene.name}」`), sceneId, version: scene.version}} catch (error) {return fail(error)}},
    }),
    deleteScene: tool({
      description: "删除作者明确要求删除的场景，先 listScenes 读取版本。有子场景或现行资料引用时拒绝删除并列出来源。",
      inputSchema: z.object({sceneId: z.string(), expectedVersion: z.number().int().positive()}),
      execute: async ({sceneId, expectedVersion}, {toolCallId}) => {try {await sceneService.deleteScene(sceneId, {novelId, userId, expectedVersion, operationId: operationFor("deleteScene", toolCallId)}); return ok("已删除场景")} catch (error) {return fail(error)}},
    }),

    upsertAttribute: tool({
      description: `创建或更新自定义属性定义（按名称覆盖；可挂载到角色/物品/场景，如「品阶」「灵力上限」）。
- targets：CHARACTER 角色 / ITEM 物品 / SCENE 场景，可多选
- valueType：TEXT 文本 / NUMBER 数字 / SELECT 下拉选项（SELECT 时必须传 options）`,
      inputSchema: z.object({
        name: z.string().describe("属性名称"),
        description: z.string().default("").describe("属性说明"),
        targets: z.array(ATTRIBUTE_TARGETS).describe("适用对象：CHARACTER/ITEM/SCENE"),
        valueType: ATTRIBUTE_VALUE_TYPES.default("TEXT").describe("TEXT/NUMBER/SELECT"),
        options: z.array(z.string()).default([]).describe("valueType=SELECT 时的可选值"),
      }),
      execute: async (data) => {
        try {
          const existing = await prisma.attributeDefinition.findFirst({
            where: { novelId, name: data.name },
          })
          if (existing) {
            await attributeService.updateAttributeDefinition(existing.id, data)
            return ok(`已更新属性定义「${data.name}」`)
          }
          await attributeService.createAttributeDefinition(novelId, data)
          return ok(`已创建属性定义「${data.name}」`)
        } catch (err) {
          return fail(err)
        }
      },
    }),

    deleteAttribute: tool({
      description: "按名称删除自定义属性定义（同时清理各实体上引用的属性值；不可恢复，调用前确认作者意图）。",
      inputSchema: z.object({ name: z.string().describe("属性定义名称") }),
      execute: async ({ name }) => {
        try {
          const existing = await prisma.attributeDefinition.findFirst({
            where: { novelId, name },
          })
          if (!existing) return fail(`不存在属性定义「${name}」`)
          await attributeService.deleteAttributeDefinition(existing.id)
          return ok(`已删除属性定义「${name}」`)
        } catch (err) {
          return fail(err)
        }
      },
    }),

    createCustomTrope: tool({
      description:
        "创建本小说的自定义爽点/泪点条目（平台库之外的新条目，创建后默认选中）。kind：SATISFACTION 爽点 / TEAR 泪点。",
      inputSchema: z.object({
        kind: TROPE_KINDS.describe("SATISFACTION 爽点 / TEAR 泪点"),
        category: z.string().describe("分类，如逆袭打脸/身份反转/奉献/离别"),
        content: z.string().describe("爽点/泪点内容"),
        referenceCase: z.string().default("").describe("参考案例（对标作品）"),
      }),
      execute: async ({ kind, category, content, referenceCase }) => {
        try {
          await tropeService.createCustomTrope({ novelId, kind, category, content, referenceCase })
          await advanceStageQuietly(novelId, "TROPE")
          return ok(`已创建自定义${kind === "SATISFACTION" ? "爽点" : "泪点"}「${category}」并选中`)
        } catch (err) {
          return fail(err)
        }
      },
    }),

    deleteCustomTrope: tool({
      description:
        "删除本小说的自定义爽点/泪点条目（仅限自定义条目，tropeId 从 listTropes 结果取 isCustom=true 的条目 id；平台库条目不可删除）。",
      inputSchema: z.object({ tropeId: z.string().describe("自定义条目 id") }),
      execute: async ({ tropeId }) => {
        try {
          const trope = await prisma.trope.findUnique({ where: { id: tropeId } })
          if (!trope || trope.novelId !== novelId) return fail("条目不存在或不属于当前小说")
          await tropeService.deleteCustomTrope(tropeId)
          return ok(`已删除自定义${trope.kind === "SATISFACTION" ? "爽点" : "泪点"}「${trope.category}」`)
        } catch (err) {
          return fail(err)
        }
      },
    }),

    deleteSetting: tool({
      description:
        "按 作用域+类型+名称 删除一条设定（不可恢复，调用前确认作者意图）。世界级类型必须用 world 指定所属世界；小说级类型（金手指/文风）无需 world。",
      inputSchema: z.object({
        type: SETTING_TYPES.describe("设定类型"),
        name: z.string().describe("设定名称"),
        world: worldNameSchema.optional().describe("所属世界的唯一名称"),
        worldId: worldIdSchema.optional().describe("所属世界 ID，优先使用"),
      }),
      execute: async ({ type, name, world, worldId: selectedWorldId }) => {
        try {
          let worldId: string | null = null
          if (isWorldSettingType(type)) {
            if (!world && !selectedWorldId) return fail(`${SETTING_TYPE_LABELS[type]}属于世界级设定，请用 world 参数指定所属世界`)
            const w = await worldService.resolveWorldReference(novelId, { id: selectedWorldId, name: world })
            if (!w) return fail("指定世界不存在或不属于当前作品")
            worldId = w.id
          }
          const setting = await prisma.setting.findFirst({
            where: { novelId, type, name, worldId },
            orderBy: { createdAt: "asc" },
          })
          if (!setting) return fail(`不存在${SETTING_TYPE_LABELS[type]}设定「${name}」`)
          await settingService.deleteSetting(setting.id)
          return ok(`已删除${SETTING_TYPE_LABELS[type]}设定「${name}」`)
        } catch (err) {
          return fail(err)
        }
      },
    }),

    deleteWorld: tool({
      description:
        "按名称删除一个世界（其下子世界与全部世界级设定会一并级联删除，不可恢复，调用前确认作者意图）。",
      inputSchema: z.object({ worldId: worldIdSchema.optional().describe("优先使用世界 ID"), name: worldNameSchema.optional().describe("兼容唯一世界名称") }).refine(data => !!data.worldId || !!data.name, "请指定世界 ID 或唯一名称"),
      execute: async ({ name, worldId }) => {
        try {
          const world = await worldService.resolveWorldReference(novelId, { id: worldId, name })
          if (!world) return fail("指定世界不存在或不属于当前作品")
          await worldService.deleteWorld(world.id)
          return ok(`已删除世界「${world.name}」（含其子世界与相关设定）`)
        } catch (err) {
          return fail(err)
        }
      },
    }),

    selectTrope: tool({
      description: "选中平台爽点/泪点库中的条目（tropeId 从 listTropes 结果取 isCustom=false 的条目 id）。",
      inputSchema: z.object({ tropeId: z.string().describe("平台库条目 id") }),
      execute: async ({ tropeId }) => {
        try {
          const trope = await tropeService.selectTrope({ novelId, tropeId })
          await advanceStageQuietly(novelId, "TROPE")
          return ok(`已选中${trope.kind === "SATISFACTION" ? "爽点" : "泪点"}「${trope.content.slice(0, 30)}」`)
        } catch (err) {
          return fail(err)
        }
      },
    }),

    generateOutline: tool({
      description:
        "AI 生成整部分卷大纲并替换旧大纲（会删除已有卷章结构，调用前确认作者意图）。耗时较长。",
      inputSchema: z.object({
        volumes: z.number().int().min(1).max(20).describe("卷数"),
        chaptersPerVolume: z.number().int().min(1).max(100).describe("每卷章数"),
        guidance: z.string().optional().describe("补充要求，如主线方向、节奏偏好"),
      }),
      execute: async ({ volumes, chaptersPerVolume, guidance }) => {
        try {
          const tree = await outlineService.generateOutline(
            novelId,
            { volumes, chaptersPerVolume, guidance },
            userId
          )
          const chapterCount = tree.reduce((sum, v) => sum + v.chapters.length, 0)
          return ok(`已生成 ${tree.length} 卷共 ${chapterCount} 章的新大纲`)
        } catch (err) {
          return fail(err)
        }
      },
    }),

    createVolume: tool({
      description:
        "追加一卷（在现有卷末尾新增，不影响已有内容）。想逐卷、逐章手工搭建大纲时用它，而不是会清空重来的 generateOutline。返回新卷的 volumeId，供 createChapter 使用。",
      inputSchema: z.object({
        title: z.string().describe("卷标题"),
        summary: z.string().default("").describe("卷简介：本卷主线、起止事件、结尾钩子"),
      }),
      execute: async ({ title, summary }) => {
        try {
          const volume = await outlineService.createVolume(novelId, { title, summary })
          return { ...ok(`已创建第 ${volume.index} 卷《${volume.title}》`), volumeId: volume.id }
        } catch (err) {
          return fail(err)
        }
      },
    }),

    updateVolumeOutline: tool({
      description: "更新卷标题或卷简介（volumeId 从 getOutline 结果获得；只传需要修改的字段）。",
      inputSchema: z.object({
        volumeId: z.string().describe("卷 id"),
        title: z.string().optional().describe("新卷标题"),
        summary: z.string().optional().describe("新卷简介"),
      }),
      execute: async ({ volumeId, title, summary }) => {
        try {
          const volume = await requireVolume(novelId, volumeId)
          await outlineService.updateVolume(volumeId, { title, summary })
          return ok(`已更新第 ${volume.index} 卷《${title ?? volume.title}》的卷大纲`)
        } catch (err) {
          return fail(err)
        }
      },
    }),

    createChapter: tool({
      description:
        "在某卷里新建一章（volumeId 从 getOutline 或 createVolume 获得）。outline 写清本章的场景、事件、冲突与结尾钩子。返回新章的 chapterId。" +
        "一次建多章时每章传 index 说明卷内序号。",
      inputSchema: z.object({
        volumeId: z.string().describe("所属卷 id"),
        title: z.string().describe("章标题"),
        outline: z.string().default("").describe("章大纲：场景/事件/冲突/结尾钩子"),
        index: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("本章在卷内的序号（第几章，从 1 开始）。批量建章必传，不传则追加到卷末"),
      }),
      execute: async ({ volumeId, title, outline, index }) => {
        try {
          const volume = await requireVolume(novelId, volumeId)
          const chapter = await outlineService.createChapter(volumeId, { title, outline, index })
          await advanceStageQuietly(novelId, "OUTLINE")
          return {
            ...ok(`已在第 ${volume.index} 卷追加第 ${chapter.index} 章《${chapter.title}》`),
            chapterId: chapter.id,
          }
        } catch (err) {
          return fail(err)
        }
      },
    }),

    updateChapterOutline: tool({
      description: "更新某章的标题或章大纲（chapterId 从 getOutline 结果获得）。",
      inputSchema: z.object({
        chapterId: z.string().describe("章节 id"),
        expectedVersion: z.number().int().positive().describe("读取大纲时的 version；冲突后重新读取并构造修改"),
        title: z.string().optional().describe("新章标题"),
        outline: z.string().optional().describe("新章大纲"),
      }),
      execute: async ({ chapterId, title, outline, expectedVersion }, { toolCallId }) => {
        try {
          const chapter = await requireChapter(novelId, chapterId)
          const updated = await outlineService.updateChapterOutline(chapterId, { title, outline }, { userId, novelId, expectedVersion, operationId: operationFor("outline", toolCallId) })
          return { ...ok(`已更新第 ${chapter.index} 章《${title ?? chapter.title}》的大纲`), receipt: updated.receipt, version: updated.version }
        } catch (err) {
          return fail(err)
        }
      },
    }),

    requestAIReview: tool({
      description:
        "对卷大纲/章大纲/章正文发起 AI 评审，返回评分与逐条意见。targetId 为卷 id 或章节 id（从 getOutline 获得）。评审只产出意见，不会改动内容，也不等于通过——作者认可后要再调用 approveOutline / finalizeChapter。",
      inputSchema: z.object({
        targetType: z
          .enum(["VOLUME_OUTLINE", "CHAPTER_OUTLINE", "CHAPTER_CONTENT"])
          .describe("VOLUME_OUTLINE 卷大纲 / CHAPTER_OUTLINE 章大纲 / CHAPTER_CONTENT 章正文"),
        targetId: z.string().describe("评审目标 id"),
      }),
      execute: async ({ targetType, targetId }) => {
        // 评委子代理（§7.3）：独立执行档案；对话区子代理行可开 tab 看只读回放
        let task = "评阅"
        try {
          if (targetType === "VOLUME_OUTLINE") {
            const volume = await requireVolume(novelId, targetId)
            task = `评阅第 ${volume.index} 卷《${volume.title}》大纲`
          } else {
            const chapter = await requireChapter(novelId, targetId)
            task = `评阅第 ${chapter.index} 章《${chapter.title}》${targetType === "CHAPTER_CONTENT" ? "正文" : "大纲"}`
          }
        } catch {
          // 任务名解析失败不影响主流程（reviewService 会再校验一次目标）
        }
        const run = await subAgentRunService.startRun({
          novelId,
          agentKind: "judge",
          task,
          // 评分目标关联（悬浮评分指示器）：评委评价卡聚合与「评审中」检测
          targetType,
          targetId,
        })
        try {
          const { review, usage } = await reviewService.requestAIReview({
            novelId,
            targetType,
            targetId,
            userId,
            sourceRunId: run.id,
          })
          const comments = Array.isArray(review.aiComments) ? review.aiComments : []
          if (review.sourceRunId !== run.id) await subAgentRunService.completeRun(run.id, {
            transcript: { score: review.aiScore, comments },
            result: { score: review.aiScore ?? null, commentCount: comments.length },
            tokenUsage: usage,
          })
          return {
            ...ok(`已完成评审，AI 评分 ${review.aiScore} 分，共 ${comments.length} 条意见`),
            reviewId: review.id,
            score: review.aiScore,
            // 意见全文回传给模型，便于据此直接改进内容
            comments: jsonSafe(comments),
            subAgentRunId: run.id,
            tokenUsage: usage,
          }
        } catch (err) {
          await subAgentRunService.failRun(
            run.id,
            err instanceof Error ? err.message : "评审失败"
          )
          return fail(err)
        }
      },
    }),

    requestReaderReview: tool({
      description:
        "让读者团子代理试读某章正文：多种读者人设并行试读（casual 小白读者看爽不爽 / veteran 老白读者挑逻辑设定 / target 按本书目标受众画像），各自给出试读感受与读者评分，聚合均分；与 AI 评审（编辑视角）互补。作者说「让读者看看/试读一下」时使用；需要该章已有正文。产出不挂行内评论。",
      inputSchema: z.object({
        chapterId: z.string().describe("章节 id"),
        personas: z
          .array(z.enum(["casual", "veteran", "target"]))
          .optional()
          .describe("读者人设子集；缺省三人并行（小白/老白/目标受众）"),
      }),
      execute: async ({ chapterId, personas }) => {
        try {
          const panel = await sopRunner.runReaderPanel({
            novelId,
            userId,
            chapterId,
            conversationId,
            personas,
          })
          const perReader = panel.readers.map((r) => `${r.label} ${r.score}`).join(" / ")
          return {
            ...ok(`读者团试读完成：均分 ${panel.aggregateScore} 分（${perReader}）`),
            aggregateScore: panel.aggregateScore,
            readers: panel.readers.map((r) => ({
              persona: r.persona,
              label: r.label,
              score: r.score,
              summary: r.summary,
              impressionCount: r.impressionCount,
              subAgentRunId: r.runId,
            })),
            subAgentRunId: panel.readers[0]?.runId ?? null,
            nodeRunId: panel.nodeRunId,
          }
        } catch (err) {
          return fail(err)
        }
      },
    }),

    addTextComment: tool({
      description:
        "在章大纲或章正文上添加一条行内评论：挂在从原文照抄的一段文字上，作者会在对应位置看到评论气泡。适合指出具体问题、给修改建议而不直接动手改；评论不会改动原文。",
      inputSchema: z.object({
        targetType: z
          .enum(["CHAPTER_OUTLINE", "CHAPTER_CONTENT"])
          .describe("CHAPTER_OUTLINE 章大纲 / CHAPTER_CONTENT 章正文"),
        chapterId: z.string().describe("章节 id"),
        quote: z.string().describe("必须从原文照抄的一段文字，作为评论锚点"),
        content: z.string().describe("评论内容（Markdown），指出问题并给出具体修改建议"),
      }),
      execute: async ({ targetType, chapterId, quote, content }) => {
        try {
          await requireChapter(novelId, chapterId)
          const comment = await textCommentService.createComment({
            novelId,
            targetType,
            targetId: chapterId,
            quote,
            content,
            authorType: "AI",
            authorName: "AI 评审员",
          })
          return { ...ok("已添加行内评论"), commentId: comment.id }
        } catch (err) {
          if (err instanceof textCommentService.CommentAnchorNotFoundError) {
            return fail("没能在原文中找到这段文字，请从原文照抄后再试")
          }
          return fail(err)
        }
      },
    }),

    listTextComments: tool({
      description:
        "列出某章（大纲或正文）上的行内评论线程：id / 锚点原文 quote（null = 无锚点整体评论）/ 评论内容 / 状态（OPEN 未处理 / AGREED 已同意 / APPLIED 已修改 / REJECTED 已拒绝）/ 已有回复。「改进正文」流程先调用它拉取 OPEN 评论。",
      inputSchema: z.object({
        targetType: z
          .enum(["CHAPTER_OUTLINE", "CHAPTER_CONTENT"])
          .describe("CHAPTER_OUTLINE 章大纲 / CHAPTER_CONTENT 章正文"),
        chapterId: z.string().describe("章节 id"),
        status: z
          .enum(["OPEN", "AGREED", "APPLIED", "REJECTED"])
          .optional()
          .describe("按状态过滤；缺省返回全部"),
      }),
      execute: async ({ targetType, chapterId, status }) => {
        try {
          await requireChapter(novelId, chapterId)
          const threads = await textCommentService.listThreads(targetType, chapterId)
          const { readTextTarget } = await import("@/lib/services/target-text")
          const state = await readTextTarget(prisma, { userId, novelId, targetType, targetId: chapterId })
          const filtered = status ? threads.filter((t) => t.status === status) : threads
          if (filtered.length === 0) return "（没有符合条件的评论）"
          return jsonSafe(
            filtered.map((t) => ({
              id: t.id,
              status: t.status,
              quote: t.quote,
              content: t.content,
              author: t.authorName,
              commentUpdatedAt: t.updatedAt,
              baseline: { version: state.version, updatedAt: state.updatedAt, hash: state.hash },
              replies: t.replies.map((r) => ({ author: r.authorName, content: r.content })),
            }))
          )
        } catch (err) {
          return fail(err)
        }
      },
    }),

    handleTextComment: tool({
      description:
        "按 listTextComments 的基线逐条处理评论：MODIFY 精确替换 quote 范围，范围外文字不能放入 replacement。无锚点 MODIFY 必须关联本次整体改写已保存的 committedOperationId。AGREE/REJECT 必须解释理由。原文或评论变化时重新读取；锚点歧义请作者重新选区，不得为了清空计数改判意见。成功回执才代表已修改。",
      inputSchema: z.object({
        commentId: z.string().describe("评论 id（经 listTextComments 获得）"),
        action: z.enum(["MODIFY", "AGREE", "REJECT"]),
        replacement: z.string().optional().describe("仅 MODIFY 且评论有锚点时：锚点段落的改写文本"),
        reply: z.string().describe("给评论者的回复（一两句话）"),
        commentUpdatedAt: z.string().describe("listTextComments 返回的评论版本"),
        baseline: z.object({ version: z.number().int().positive().nullable(), updatedAt: z.string(), hash: z.string() }).optional(),
        committedOperationId: z.string().optional().describe("无锚点 MODIFY 的整体改写回执编号"),
      }),
      execute: async (input, { toolCallId }) => {
        try {
          const comment = await prisma.textComment.findFirst({ where: { id: input.commentId, novelId } })
          if (comment?.targetType === "CHAPTER_CONTENT" && (await chapterImprovementIntent({ userId, novelId, chapterId: comment.targetId })).authorized) throw new ContentError("CANDIDATE_REQUIRED", "本轮正文改进须在候选中处理评论，请调用 improveChapterContent；当前评论尚未修改")
          const result = await textCommentService.handleCommentById({ ...input, userId, novelId, operationId: operationFor("handleTextComment", toolCallId) })
          return jsonSafe({ ok: true, ...result })
        } catch (err) {
          return fail(err)
        }
      },
    }),

    approveOutline: tool({
      description:
        "记录作者对大纲的确认通过（卷大纲或章大纲），该卷/该章状态从「大纲」变为「已评审」，正文才允许生成。批准会推进章节版本，后续生成使用本工具返回的章节 version，不能沿用批准前的版本。必须在作者明确表示大纲没问题/可以开始写之后调用，不要替作者拍板。",
      inputSchema: z.object({
        targetType: z
          .enum(["VOLUME_OUTLINE", "CHAPTER_OUTLINE"])
          .describe("VOLUME_OUTLINE 整卷大纲（含卷内各章）/ CHAPTER_OUTLINE 单章大纲"),
        targetId: z.string().describe("卷 id 或章节 id"),
        comment: z.string().optional().describe("作者的确认意见，可选"),
      }),
      execute: async ({ targetType, targetId, comment }) => {
        try {
          await reviewService.approveTargetByAuthor({ userId, novelId, targetType, targetId, comment })
          if (targetType === "VOLUME_OUTLINE") {
            const volume = await requireVolume(novelId, targetId)
            const chapters = await prisma.chapter.findMany({ where: { volumeId: targetId }, orderBy: { index: "asc" }, select: { id: true, index: true, title: true, version: true, status: true } })
            return { ...ok(`已记录作者确认：第 ${volume.index} 卷《${volume.title}》大纲通过，卷内各章可以开始写正文`), chapters }
          }
          const chapter = await requireChapter(novelId, targetId)
          return { ...ok(`已记录作者确认：第 ${chapter.index} 章《${chapter.title}》大纲通过，可以开始写正文`), chapterId: chapter.id, version: chapter.version, status: chapter.status }
        } catch (err) {
          return fail(err)
        }
      },
    }),

    checkChapterNarrative: tool({
      description:
        "免费结构检查本章叙事卡与创作资料：讲述意图/世界事件/段落节拍、文风/关联世界介绍、资料有效性与伏笔双层首埋。只检查本章已采用规划，不要求全书资料或未来回收。生成正文或抽卡前先调用；status=ready 才能生成。missing/thin 按 issues 用已有 CRUD 补资料、proposeNovelPlanning 补本章规划（作者采用后复检），不逐项 AI 审核。",
      inputSchema: z.object({
        chapterId: z.string().describe("章节 id"),
      }),
      execute: async ({ chapterId }) => {
        try {
          const assessment = await assessChapterNarrative({ userId, novelId, chapterId })
          return jsonSafe({ ...ok(assessment.status === "ready" ? `《${assessment.chapterTitle}》叙事卡与创作资料完备（${assessment.totals.readingCards} 张阅读卡 / ${assessment.totals.totalBeats} 个段落节拍），可以抽卡生成` : `《${assessment.chapterTitle}》叙事卡或创作资料${assessment.status === "missing" ? "缺失" : "尚不完整"}，按缺项补齐再生成`), ...assessment })
        } catch (err) {
          return fail(err)
        }
      },
    }),

    getChapterCandidates: tool({
      description:
        "读取本章最近一次抽卡的真实候选状态并在对话中就地重现候选卡片（采用/丢弃/待检查状态以服务端为准）。请作者选稿之前必须先用本工具核对：本章从未抽卡就明说并进入抽卡流程；候选已采用/已丢弃就如实汇报并继续下一步；只有存在待选候选时才请作者选稿。禁止凭记忆重复要求选稿。",
      inputSchema: z.object({
        chapterId: z.string().describe("章节 id"),
      }),
      execute: async ({ chapterId }) => {
        try {
          const draw = await getChapterDrawState({ userId, novelId, chapterId })
          if (!draw) return { ...ok("本章还没有抽卡候选；先按流程检查叙事卡并抽卡"), draw: null }
          const adopted = draw.candidates.find(c => c.status === "accepted")
          const pending = draw.candidates.filter(c => ["ready", "needs_review"].includes(c.status))
          return jsonSafe({
            ...ok(adopted
              ? `本章最近一次抽卡的「${draw.candidates.find(c => c.status === "accepted")?.label ?? ""}」已被作者采用——选稿已完成，不要再要求选稿；继续后续步骤（评审/定稿/下一章）。`
              : pending.length
                ? `本章 ${pending.length} 份候选待选稿（卡片已就地重现），请作者在卡片中查看全文后选定。`
                : "本章候选均已处理（丢弃/撤回/过期），需要时重新抽卡。"),
            draw,
          })
        } catch (err) {
          return fail(err)
        }
      },
    }),

    drawChapterCandidates: tool({
      description:
        "正文抽卡：为本章并发生成 N 份（默认 3，至多 5）差异化候选稿，在对话中以候选卡片展示；全部候选保留待作者选稿，不自动采用、不替换正文（committed 恒为 false）。前置：先 checkChapterNarrative 确认 ready（本工具也会复检，不完备返回 NARRATIVE_NOT_READY 报告而不生成）；章大纲须已 approveOutline。作者要以某张候选为基础继续改进时，传 baseCandidateId + feedback 再抽 3 份。作者「换一批」时（含候选卡片「换一批」按钮与问答面板的两个换一批选项发来的固定文案）：不传 baseCandidateId——「直接换一批」不带 feedback，「根据要求换一批：…」feedback 传作者要求原文；文案指定「重新抽 N 张」传 count=N，指定「字数范围调整为 X～Y 字」传 wordMin=X、wordBudget=Y（悬浮框设置，仅本批候选，不改卷章大纲）。作者从评审视图「正文改进对话框」发起改进时（action 带 draw 载荷）：传 baseOnCurrent=true 以当前正文为底稿，feedback 传对话框勾选的改进项编译文本（必传），count/wordMin/wordBudget 按对话框设置原样传。作者选稿后：采用走候选稿采用流程，采用≠定稿。",
      inputSchema: z.object({
        chapterId: z.string().describe("章节 id"),
        expectedVersion: z.number().int().positive().describe("从 getOutline/getChapterContent/approveOutline 读取的当前 version"),
        count: z.number().int().min(1).max(5).optional().describe("候选份数，默认 3"),
        baseCandidateId: z.string().optional().describe("改进抽卡的底稿候选 id（作者选定的待改进候选）；不传为首次抽卡"),
        baseOnCurrent: z.boolean().optional().describe("以当前正文为底稿的改进抽卡（正文改进对话框发起）；与 baseCandidateId 互斥，此时 feedback 必传"),
        feedback: z.string().optional().describe("作者对底稿的改进意见（改进抽卡时必传）；首次抽卡/换一批时为对本章写作的额外要求"),
        wordMin: z.number().int().positive().optional().describe("本批字数覆盖下限（悬浮框设置，仅作者明确调整时与 wordBudget 同传；仅本批候选，不改规划档）"),
        wordBudget: z.number().int().positive().optional().describe("本批字数覆盖上限（须与 wordMin 同传且不小于它）"),
      }),
      execute: async ({ chapterId, expectedVersion, count, baseCandidateId, baseOnCurrent, feedback, wordMin, wordBudget }, { toolCallId }) => {
        let task = "抽卡生成章节候选"
        let chapterIndex = 0
        try {
          const ch = await requireChapter(novelId, chapterId)
          chapterService.assertChapterGenerationReady(ch, expectedVersion)
          chapterIndex = ch.index
          task = `第 ${ch.index} 章《${ch.title}》正文抽卡`
          const assessment = await assessChapterNarrative({ userId, novelId, chapterId })
          if (assessment.status !== "ready") {
            return jsonSafe({ ...ok(`第 ${ch.index} 章《${ch.title}》叙事卡尚不具备生成条件，未发起抽卡`), code: "NARRATIVE_NOT_READY", narrativeStatus: assessment.status, assessment, guidance: narrativeGateMessage(assessment), committed: false })
          }
        } catch (err) {
          // 校验失败不能先创建运行/计划副作用
          return fail(err)
        }
        const nodeRun = await prisma.sopNodeRun.create({
          data: { defaultsSnapshot: await taskDefaults(), novelId, nodeId: "content", targetId: chapterId, status: "running" },
        })
        const run = await subAgentRunService.startRun({
          novelId,
          conversationId,
          agentKind: "writer",
          task,
          sopNodeRunId: nodeRun.id,
        })
        try {
          const outcome = await drawChapterCandidates({
            scope: { userId, novelId, chapterId },
            expectedVersion,
            operationId: operationFor("draw", toolCallId),
            count,
            baseCandidateId,
            baseOnCurrent,
            feedback,
            wordMin,
            wordBudget,
            sourceRunId: run.id,
          })
          if (!outcome.ready) {
            await subAgentRunService.failRun(run.id, outcome.message)
            await prisma.sopNodeRun.update({ where: { id: nodeRun.id }, data: { status: "failed" } })
            return jsonSafe({ ...ok("叙事卡尚不具备生成条件，未发起抽卡"), code: "NARRATIVE_NOT_READY", narrativeStatus: outcome.assessment.status, assessment: outcome.assessment, guidance: outcome.message, committed: false })
          }
          const { result } = outcome
          await subAgentRunService.completeRun(run.id, {
            transcript: { wordCount: result.candidates.reduce((n, c) => n + c.wordCount, 0), preview: result.candidates.map(c => `【${c.label}】${c.excerpt}`).join("\n").slice(0, CONTENT_PREVIEW_LENGTH) },
            result: { candidates: result.candidates.length, failures: result.failures.length },
          })
          await prisma.sopNodeRun.update({ where: { id: nodeRun.id }, data: { status: "done", iterations: 1 } })
          return jsonSafe({
            ...ok(`第 ${chapterIndex} 章《${result.chapterTitle}》已抽出 ${result.candidates.length} 份候选稿${result.failures.length ? `（${result.failures.length} 份生成失败）` : ""}。候选未落正文：请作者在候选卡片中查看全文并选择；作者选定后可采用，或指定一张继续改进。`),
            draw: result,
            committed: false,
            subAgentRunId: run.id,
          })
        } catch (err) {
          await subAgentRunService.failRun(run.id, err instanceof Error ? err.message : "抽卡失败")
          await prisma.sopNodeRun.update({ where: { id: nodeRun.id }, data: { status: "failed" } })
          return fail(err)
        }
      },
    }),

    generateChapterContent: tool({
      description:
        "召唤写手子代理为某章生成整章正文并保存（隔离链路：自动带入主题/文风/设定/角色/本章大纲/前一章衔接，不经对话历史，篇幅约 3000 字）。需要该章大纲已通过（先 approveOutline）。适合按大纲正常出稿；耗时较长，一次只写一章。修订轮把上一轮评审反馈经 feedback 传入。committed=true 后用 getChapterContent 读回实际正文，再用 listForeshadows({chapterId}) 核对本章：已有伏笔的新提及或遗漏触点也要补录，去重依据为实际 chapterId+kind。新出现的后文承诺复用 createForeshadow/addForeshadowTouch 登记，不把普通描写当伏笔，也不把未采用候选登记成正文事实。",
      inputSchema: z.object({
        chapterId: z.string().describe("章节 id"),
        expectedVersion: z.number().int().positive().describe("从 getOutline/getChapterContent 读取的 version"),
        guidance: z.string().optional().describe("补充要求，如视角、节奏、必须出现的伏笔"),
        wordCount: z
          .number()
          .optional()
          .describe("本章目标字数（800-8000）；作者或章大纲交代了篇幅就照着传，不传默认 3000"),
        feedback: z
          .string()
          .optional()
          .describe("上一轮评审反馈（修订轮注入，首轮不传）"),
      }),
      execute: async ({ chapterId, guidance, wordCount, feedback, expectedVersion }, { toolCallId }) => {
        // 写手子代理（2026-08 SOP）：隔离生成链路登记为独立执行档案 + 节点运行
        let task = "撰写章节正文"
        try {
          const ch = await requireChapter(novelId, chapterId)
          chapterService.assertChapterGenerationReady(ch, expectedVersion)
          task = `撰写第 ${ch.index} 章《${ch.title}》正文`
          const assessment = await assessChapterNarrative({ userId, novelId, chapterId })
          if (assessment.status !== "ready") {
            return jsonSafe({ ...ok(`第 ${ch.index} 章《${ch.title}》叙事卡尚不具备生成条件，未生成正文`), code: "NARRATIVE_NOT_READY", narrativeStatus: assessment.status, assessment, guidance: narrativeGateMessage(assessment), committed: false })
          }
        } catch (err) {
          // 校验失败不能先创建运行/计划副作用，否则版本修正后会被未知结果围栏阻挡。
          return fail(err)
        }
        const nodeRun = await prisma.sopNodeRun.create({
          data: { defaultsSnapshot: await taskDefaults(), novelId, nodeId: "content", targetId: chapterId, status: "running" },
        })
        const run = await subAgentRunService.startRun({
          novelId,
          conversationId,
          agentKind: "writer",
          task,
          sopNodeRunId: nodeRun.id,
        })
        try {
          const chapter = await chapterService.generateChapterContent(chapterId, userId, {
            expectedVersion,
            operationId: operationFor("generate", toolCallId),
            sourceRunId: run.id,
            guidance,
            wordCount,
            feedback,
          })
          await subAgentRunService.completeRun(run.id, {
            transcript: { wordCount: chapter.wordCount, preview: chapter.content.slice(0, CONTENT_PREVIEW_LENGTH) },
            result: { wordCount: chapter.wordCount },
          })
          if (!chapter.receipt) {
            await prisma.sopNodeRun.update({ where: { id: nodeRun.id }, data: { status: "failed" } })
            return { ...ok(`候选稿已保留，实际 ${chapter.wordCount} 字，原稿未替换。请在正文面板的候选稿中查看检查结果。`), committed: false, wordCount: chapter.wordCount, candidateId: chapter.candidate.id, candidateStatus: chapter.candidate.status, subAgentRunId: run.id }
          }
          await prisma.sopNodeRun.update({
            where: { id: nodeRun.id },
            data: { status: "done", iterations: 1 },
          })
          await sopPlanService.markItemByNodeRun({
            conversationId,
            nodeId: "content",
            targetId: chapterId,
            status: "done",
            sopNodeRunId: nodeRun.id,
            summary: `正文 ${chapter.wordCount} 字已落库`,
          })
          return {
            ...ok(`已生成并保存第 ${chapter.index} 章《${chapter.title}》正文，共 ${chapter.wordCount} 字`),
            wordCount: chapter.wordCount,
            receipt: chapter.receipt,
            committed: true,
            preview: chapter.content.slice(0, CONTENT_PREVIEW_LENGTH),
            subAgentRunId: run.id,
            nodeRunId: nodeRun.id,
          }
        } catch (err) {
          await subAgentRunService.failRun(run.id, err instanceof Error ? err.message : "正文生成失败")
          await prisma.sopNodeRun.update({ where: { id: nodeRun.id }, data: { status: "failed" } })
          await sopPlanService.markItemByNodeRun({
            conversationId,
            nodeId: "content",
            targetId: chapterId,
            status: "failed",
            sopNodeRunId: nodeRun.id,
            summary: "正文生成中断",
          })
          return fail(err)
        }
      },
    }),

    improveChapterContent: tool({
      description: "统一改进已有章节正文：以当前 version 固定原稿、作者本轮要求、评论与前后章事实，生成候选并作同配置评审。最多两次写手、一次基线与两次候选评审；降分/不完整/约束未解决保留原稿，返回候选供作者比较。只有 committed=true 才表示已采用，不自动定稿。不要先直接修改评论，不要通过重复调用刷分。",
      inputSchema: z.object({ chapterId: z.string(), expectedVersion: z.number().int().positive().describe("getChapterContent 实际读取的 version") }),
      execute: async ({ chapterId, expectedVersion }, { toolCallId }) => {
        try {
          const chapter = await requireChapter(novelId, chapterId)
          const result = await improveChapterContent({ userId, novelId, chapterId, expectedVersion, operationId: operationFor("improve", toolCallId) })
          const completed = !["interrupted", "incomplete"].includes(result.status)
          return jsonSafe({ ...ok(result.committed ? `《${chapter.title}》改进稿已采用，等待作者检查定稿` : !completed ? "改进未完整完成；已收到片段可在正文面板查看" : "候选已保留，本次未提交正文，请在正文面板比较评分和差异"), ...result, ok: completed, target: { id: chapterId, label: `第 ${chapter.index} 章《${chapter.title}》正文` } })
        } catch (error) { return fail(error) }
      },
    }),

    revertChapterReplacement: tool({
      description:
        "放弃换用：作者在候选卡片「替换当前正文，采用这张」把本章正文换用为另一候选稿后，于换用过渡检查问答中选择「放弃替换，恢复原正文」时调用。恢复换用前正文为新修订（历史快照不改写），候选状态回滚（换用稿撤回、原稿恢复已采用）。仅限该问答场景；换用后正文已有新修订时会拒绝并返回原因（CANDIDATE_STALE）。",
      inputSchema: z.object({ chapterId: z.string().describe("章节 id") }),
      execute: async ({ chapterId }, { toolCallId }) => {
        try {
          const chapter = await requireChapter(novelId, chapterId)
          const { receipt } = await revertCandidateReplacement({ userId, novelId, chapterId }, { expectedVersion: chapter.version, operationId: operationFor("revert-replace", toolCallId) })
          return jsonSafe({ ...ok(`已恢复《${chapter.title}》换用前的正文（修订 v${receipt.version}，${receipt.wordCount} 字），候选状态已回滚`), committed: true, receipt, target: { id: chapterId, label: `第 ${chapter.index} 章《${chapter.title}》正文` } })
        } catch (error) { return fail(error) }
      },
    }),

    writeChapterContent: tool({
      description:
        "提交完整章节候选稿。必须先读取正文与 version。服务端检查完成状态、缩短和字数；只有回执 committed=true 才表示原稿已替换，否则引导作者在候选稿中查看。不能只提交梗概或声称候选已保存到正文。",
      inputSchema: z.object({
        chapterId: z.string().describe("章节 id"),
        expectedVersion: z.number().int().positive().describe("读取原稿时的 version，不能猜测或在冲突后只换版本重发旧稿"),
        content: z.string().min(200).describe("完整章节正文"),
      }),
      execute: async ({ chapterId, content, expectedVersion }, { toolCallId }) => {
        try {
          if ((await chapterImprovementIntent({ userId, novelId, chapterId })).authorized) throw new ContentError("CANDIDATE_REQUIRED", "本轮改进须调用 improveChapterContent 完成候选评分比较")
          const chapter = await requireChapter(novelId, chapterId)
          if (chapter.status === "OUTLINE") throw new chapterService.ChapterNotReadyError()
          const generated = await chapterService.persistGeneratedChapter(
            chapterId,
            content,
            "对话中写入正文",
            { userId, novelId, expectedVersion, operationId: operationFor("write", toolCallId), previousContent: chapter.content, finishReason: "tool-calls" }
          )
          return { ...ok(generated.receipt ? `已保存第 ${chapter.index} 章《${chapter.title}》正文，共 ${generated.receipt.wordCount} 字` : "候选稿已保留，原稿未替换，请在正文面板查看候选稿与检查结果"), committed: !!generated.receipt, receipt: generated.receipt, candidateId: generated.candidate.id, candidateStatus: generated.candidate.status, ...(generated.receipt ? { wordCount: generated.receipt.wordCount, previousWordCount: generated.receipt.previousWordCount, deltaWordCount: generated.receipt.deltaWordCount, version: generated.receipt.version } : {}), target: { id: chapter.id, label: `第 ${chapter.index} 章《${chapter.title}》正文` } }
        } catch (err) {
          return fail(err)
        }
      },
    }),

    getChapterFinalizationChecklist: tool({
      description: "读取当前正文的版本、完整性/字数检查、未处理评论和对应评分建议。定稿前请作者在正文面板的「定稿检查」中查看并确认此版本；清单本身不代表定稿授权。",
      inputSchema: z.object({ chapterId: z.string() }),
      execute: async ({ chapterId }) => { try { return jsonSafe(await getChapterFinalizationChecklist({ userId, novelId, chapterId })) } catch (error) { return fail(error) } },
    }),
    finalizeChapter: tool({
      description:
        "记录作者对某章正文的定稿确认。只有作者在正文面板「定稿检查」确认过此 version/hash 后才能执行；从系统附带的确认动作取值。过期时请作者重新检查，不能自己换版本重试。改进和达到 80 分不等于定稿授权。",
      inputSchema: z.object({
        chapterId: z.string().describe("章节 id"),
        expectedVersion: z.number().int().positive().describe("作者确认的正文 version"),
        expectedHash: z.string().describe("作者确认的正文 contentHash，从 getChapterContent 获取"),
        comment: z.string().optional().describe("作者的确认意见，可选"),
      }),
      execute: async ({ chapterId, comment, expectedVersion, expectedHash }, { toolCallId }) => {
        try {
          if ((await chapterImprovementIntent({ userId, novelId, chapterId })).action?.kind === "improve") throw new ContentError("AUTHOR_CONFIRMATION_REQUIRED", "改进不包含定稿授权，请向作者展示当前版本的检查结果并等待确认")
          const chapter = await requireChapter(novelId, chapterId)
          await reviewService.approveTargetByAuthor({
            userId,
            novelId,
            targetType: "CHAPTER_CONTENT",
            targetId: chapterId,
            comment,
            expectedVersion,
            expectedHash,
            operationId: operationFor("finalize", toolCallId),
          })
          return ok(`已记录作者确认：第 ${chapter.index} 章《${chapter.title}》正文定稿`)
        } catch (err) {
          return fail(err)
        }
      },
    }),

    // ---------- SOP 图编排（2026-08 graph-engineering SOP，图定义见 src/lib/sop/graph.ts） ----------
    getSopStatus: tool({
      description:
        "查看本书 SOP 创作流程的当前状态：各环节最近一次检查点评分与迭代、未闭环待办（openFindings）、进行中的计划与挂账待澄清问题。判断作者意图路由、规划下一步、回答「进行到哪了」、或执行到某环节入口前查挂账问题时调用。",
      inputSchema: z.object({}),
      execute: async () => sopStatusService.getSopStatus({ novelId, conversationId }),
    }),

    proposePlan: tool({
      description: "计划模式专用：输出只读计划提案供作者批准。只生成提案，不创建 SOP，不修改作品。目标、步骤、产出用作者能理解的自然语言；调用后立即结束本轮。",
      inputSchema: planProposalSchema,
      execute: async proposal => ({ ok: true, proposal }),
    }),
    createSopPlan: tool({
      description:
        "【SOP 规划】命中创作流程（SOP）意图后、动手之前调用：把将要做的环节/子任务列成结构化 ToDo List（对话区会展示并逐项打勾）。同一会话只保留一个进行中计划，重复调用优先更新同一计划并保留任务编号；只有作者明确改变目标时传 replaceGoal=true 作废旧计划。信息没问全也能建计划——作者暂时答不上来的问题用 deferredQuestions 挂账（绑定环节），执行到对应环节入口时再追问。",
      inputSchema: z.object({
        title: z.string().describe("计划标题，如「从主题到角色阵容搭建」"),
        entryIntent: z.string().optional().describe("入口意图摘要"),
        replaceGoal: z.boolean().optional().describe("仅作者明确改变目标时为 true"),
        items: z
          .array(
            z.object({
              label: z.string().describe("任务项一句话，如「召唤剧作家搭建世界观并过审稿」"),
              nodeId: z
                .enum(["theme", "world", "character", "setting", "outline", "content", "novel", "manual"])
                .describe("所属环节；manual 为需作者参与的人工项"),
              targetId: z.string().optional().describe("实例锚点（如 chapterId），环节级不传"),
            })
          )
          .min(1)
          .describe("按执行顺序排列的任务项"),
        deferredQuestions: z
          .array(
            z.object({
              nodeId: z.enum(["theme", "world", "character", "setting", "outline", "content", "novel"]),
              question: z.string(),
            })
          )
          .optional()
          .describe("挂账待澄清问题（用户「还没想好」跳过的），执行到对应环节时再问"),
      }),
      execute: async ({ title, entryIntent, items, deferredQuestions, replaceGoal }) => {
        if (!conversationId) return fail("当前会话不可用")
        try {
          const plan = await sopPlanService.createPlan({
            novelId,
            conversationId,
            title,
            entryIntent,
            items,
            deferredQuestions,
            replaceGoal,
          })
          return {
            ...ok(`计划「${plan.title}」已建立，共 ${items.length} 项任务${deferredQuestions?.length ? `，${deferredQuestions.length} 个问题挂账` : ""}`),
            planId: plan.id,
          }
        } catch (err) {
          return fail(err)
        }
      },
    }),

    updateSopPlan: tool({
      description:
        "【SOP 规划】更新进行中的计划：人工任务项打勾/跳过（节点类任务项由服务层自动打勾，无需调用）、登记或解决挂账问题、作废整个计划。",
      inputSchema: z.object({
        planId: z.string().optional().describe("缺省取当前活跃计划"),
        itemUpdates: z
          .array(
            z.object({
              id: z.string().describe("任务项 id"),
              status: z.enum(["pending", "active", "done", "failed", "skipped"]).optional(),
              summary: z.string().optional().describe("完成小结"),
            })
          )
          .optional(),
        planStatus: z.enum(["done", "superseded"]).optional().describe("整计划完结/作废"),
        deferQuestion: z
          .object({
            nodeId: z.enum(["theme", "world", "character", "setting", "outline", "content", "novel"]),
            question: z.string(),
          })
          .optional()
          .describe("登记一个挂账问题（作者暂时答不上来，到对应环节再问）"),
        resolveQuestion: z
          .object({ id: z.string(), answer: z.string().optional() })
          .optional()
          .describe("挂账问题已得到答案"),
      }),
      execute: async ({ planId, itemUpdates, planStatus, deferQuestion: dq, resolveQuestion: rq }) => {
        if (!conversationId) return fail("当前会话不可用")
        try {
          const plan = planId
            ? await sopPlanService.getPlan(planId)
            : await sopPlanService.getActivePlan(conversationId)
          if (!plan || plan.conversationId !== conversationId || plan.novelId !== novelId) return fail("没有当前会话的计划")
          if (dq) await sopPlanService.deferQuestion(plan.id, dq)
          if (rq) await sopPlanService.resolveQuestion(plan.id, rq.id, rq.answer)
          if (itemUpdates?.length) {
            const items = plan.items as unknown as { id: string; status?: string; summary?: string }[]
            const allKnown = itemUpdates.every(update => items.some(i => i.id === update.id))
            const changed = !allKnown || itemUpdates.some(update => {
              const item = items.find(i => i.id === update.id)
              return (update.status !== undefined && update.status !== item!.status) || (update.summary !== undefined && update.summary !== item!.summary)
            })
            if (!changed) {
              return fail(`计划内容未变化：任务项已是该状态与小结，本次未写入。计划工具只同步进度，不会修改叙事线/设定等内容产物；要落实内容修订，请 loadCreationTools 启用对应写入工具后调用。`)
            }
            await sopPlanService.updatePlanItems(plan.id, itemUpdates)
          }
          if (planStatus) await sopPlanService.setPlanStatus(plan.id, planStatus)
          return { ...ok("计划已更新"), planId: plan.id }
        } catch (err) {
          return fail(err)
        }
      },
    }),

    assessThemeMarket: tool({
      description:
        "召唤平台编辑子代理评估当前主题的市场方向：赛道冷热/卖点检验/受众匹配/风险提示，给出评分与「值不值得写、往哪写」的方向建议。主题由你与作者共建（upsertTheme）后调用；评估只产出意见，不改动主题。评分不达标时与作者讨论调整方向后再次评估（≤3 轮），作者也可以拍板直接进入下一环节。",
      inputSchema: z.object({
        brief: z.string().optional().describe("补充说明（如作者对题材的偏好、顾虑、对标作品）"),
      }),
      execute: async ({ brief }) => {
        try {
          const r = await sopRunner.assessThemeMarket({ novelId, userId, conversationId, brief })
          return {
            ...ok(`平台编辑评估完成：${r.score} 分——${r.verdict}`),
            score: r.score,
            verdict: r.verdict,
            risks: r.risks,
            suggestions: r.suggestions,
            subAgentRunId: r.subAgentRunId,
            tokenUsage: r.usage,
            nodeRunId: r.nodeRunId,
          }
        } catch (err) {
          return fail(err)
        }
      },
    }),

    summonPlaywright: tool({
      description:
        "召唤剧作家子代理搭建世界观/角色/设定/卷大纲：按创作简报产出结构化内容并自动落库。世界观/角色/设定会自动经审稿人检查点循环修订（≤2 轮），返回真实评分；收敛证据自动记为该项检查点，同内容无需再 reviewStoryCheckpoint，达标后直接 requestStoryApproval。上限未达标仍未完成。卷大纲只产出框架。产出带 questions 时用 askUserQuestion 向作者问清。按作者选定的子任务范围执行，完成后调用completeStoryTask给出自由下一步；修改已存在对象传name。",
      inputSchema: z.object({
        kind: z.enum(["world", "character", "setting", "outline"]).describe("产出类型"),
        brief: z.string().describe("创作简报：作者意图、环节入口追问到的答案、具体要求"),
        name: z.string().optional().describe("指定对象名（修订已有对象，或指定新对象名）"),
        worldName: worldNameSchema.optional().describe("world：上级唯一世界名；setting：所属唯一世界名。同名时先按 ID 确认世界，再使用相应写工具"),
      }),
      execute: async ({ kind, brief, name, worldName }) => {
        try {
          const r = await sopRunner.summonPlaywright({ novelId, userId, conversationId, kind, brief, name, worldName })
          if (kind === "outline") {
            return {
              ...ok(`剧作家完成第 ${r.volumeIndex} 卷《${r.title}》框架（${r.chapterCount} 章），已落库；下一步用 requestAIReview 评审卷大纲`),
              volumeId: r.volumeId,
              chapterCount: r.chapterCount,
              questions: r.questions.length ? r.questions : undefined,
              subAgentRunId: r.subAgentRunId,
              nodeRunId: r.nodeRunId,
            }
          }
          const label = { world: "世界观", character: "角色", setting: "设定" }[kind]
          // 实例回炉证据直接作为该产物检查点，同指纹 reviewStoryCheckpoint 命中免重评；写入竞态失败不阻断工具回执（退化为独立重评）
          if (r.evidence) await recordInstanceLoopEvidence({ novelId, userId }, r.evidence.artifactKey, r.evidence).catch(error => console.warn("[story] 实例回炉证据写入失败，后续将独立评审", error instanceof Error ? error.message : error))
          return {
            ...ok(
              r.converged
                ? `剧作家完成${label}：检查点 ${r.finalScore} 分，${r.iterations} 轮收敛`
                : `剧作家完成${label}：检查点 ${r.finalScore} 分，${r.iterations} 轮后未达收敛线——把反馈如实告诉作者，请作者拍板（继续修订或接受现状）`
            ),
            converged: r.converged,
            iterations: r.iterations,
            finalScore: r.finalScore,
            questions: r.questions.length ? r.questions : undefined,
            nodeRunId: r.nodeRunId,
          }
        } catch (err) {
          return fail(err)
        }
      },
    }),

    reviewWholeNovel: tool({
      description:
        "整书审视：聊天创作流程逐项检查全文与来源，长篇分段并保留断点，不以首尾抽样代替全书；先通过正文阶段。旧作品保留总编面板。沿用本轮模型；按作者已授权的整书流程或作者点名时使用。完成后展示意见、询问是否改进。",
      inputSchema: z.object({}),
      execute: async () => {
        try {
          if (await getStoryWorkflow({ novelId, userId })) {
            const reviewed = await reviewStoryCheckpoint({ novelId, userId }, "phase:revision")
            return { ...reviewed, score: reviewed.checkpoint?.score, subAgentRunId: reviewed.checkpoint?.runId, storyFocus: { key: "phase:revision", kind: "story-review", id: "phase:revision", title: "整书评审" } }
          }
          const r = await sopRunner.reviewWholeNovel({ novelId, userId, conversationId })
          return {
            ...ok(`整书审视完成：综合 ${r.score} 分（编辑 ${r.editor.score} / 总审 ${r.judge.score}），${r.judge.findings.length} 条待办已路由回对应环节`),
            score: r.score,
            editor: { score: r.editor.score, verdict: r.editor.verdict, risks: r.editor.risks, suggestions: r.editor.suggestions },
            judge: { score: r.judge.score, comments: jsonSafe(r.judge.comments), findings: r.judge.findings },
            subAgentRunIds: [r.editor.runId, r.judge.runId],
            subAgentRunId: r.judge.runId,
            nodeRunId: r.nodeRunId,
          }
        } catch (err) {
          return fail(err)
        }
      },
    }),

    createForeshadowCharacter: tool({
      description:
        "登记一个伏笔角色：身份未明、不宜立刻建成正式角色的存在（如「灰雾之上的老者」「神秘女声」），小说级全局实体，可在叙事线与正文中引用；之后揭示身份时再转正。不要替他在角色列表里编造正式身份。",
      inputSchema: z.object({
        name: z.string().describe("称呼，如「老者」"),
        note: z.string().optional().describe("备注：伏笔线索、身份猜测等"),
      }),
      execute: async ({ name, note }) => {
        try {
          const fc = await foreshadowCharacterService.createForeshadowCharacter(novelId, {
            name,
            note,
          })
          return { ...ok(`已登记伏笔角色「${fc.name}」`), foreshadowCharacterId: fc.id }
        } catch (err) {
          return fail(err)
        }
      },
    }),

    /* ---------------- 伏笔档案（情节线索的埋入/提及/回收追踪） ---------------- */

    listForeshadows: tool({
      description:
        "列出本小说的伏笔档案与触点。核对正式正文时传 chapterId，保留全部档案但只列该正式章的触点，避免把其他章的记录当成本章已登记。本章无触点只表示尚未登记，不表示正文未出现；逐条对照 getChapterContent 的实际原句，发现已出现但缺登记时补录。全书状态 RESOLVED 不代表当前章每一次提及已经登记。",
      inputSchema: z.object({
        status: z
          .enum(["PLANNED", "PLANTED", "RESOLVED", "DROPPED"])
          .optional()
          .describe("按状态过滤；不传返回全部"),
        chapterId: z.string().optional().describe("核对正式章时必传其实际ID；只显示该章触点"),
      }),
      execute: async ({ status, chapterId }) => {
        try {
          if (chapterId) await requireChapter(novelId, chapterId)
          const rows = await foreshadowService.listForeshadows(novelId, status ? { status } : undefined)
          if (rows.length === 0) return ok("（暂无伏笔档案；发现值得后续兑现的线索时可用 createForeshadow 登记）")
          const lines = rows.map((f) => {
            const touches = f.touches.filter(t => !chapterId || t.chapterId === chapterId)
              .map((t) => `    · ${t.kind} [${t.chapterId ? `chapterId=${t.chapterId}` : "无锚点"}; touchId=${t.id}]${t.targetLabel ? ` @ ${t.targetLabel}` : ""}${t.summary ? `：${t.summary}` : ""}${t.score !== null ? `（${t.score} 分）` : ""}`)
              .join("\n")
            return `- [${f.status}] 「${f.title}」（id: ${f.id}）${f.expectation ? ` 预期回收：${f.expectation}` : ""}${f.plannedChapter ? `（第 ${f.plannedChapter} 章）` : ""}\n  ${f.content.slice(0, 120)}${touches ? `\n${touches}` : chapterId ? "\n  （本章无触点）" : ""}`
          })
          return ok(`${chapterId ? `以下仅列正式章节 chapterId=${chapterId} 的触点。“本章无触点”表示尚未登记，不表示正文未出现，请逐条对照本章实际原句后补录。\n` : ""}${lines.join("\n")}`)
        } catch (err) {
          return fail(err)
        }
      },
    }),

    getForeshadow: tool({
      description: "读取单条伏笔的完整内容、预期回收、全触点链与触点评分；不读取作者私有写作备忘。",
      inputSchema: z.object({
        foreshadowId: z.string().describe("伏笔 id（从 listForeshadows 获得）"),
      }),
      execute: async ({ foreshadowId }) => {
        try {
          const f = await foreshadowService.getForeshadow(novelId, foreshadowId)
          const { note: privateNote, ...foreshadow } = f
          void privateNote // 与面板「写作备忘不进 AI 上下文」的契约一致。
          return { ...ok(`伏笔「${f.title}」`), foreshadow }
        } catch (err) {
          return fail(err)
        }
      },
    }),

    createForeshadow: tool({
      description:
        "登记一条伏笔：值得在未来兑现的情节线索（谜题/承诺/隐患/信物/预言等）。title 要短（如「皮影投影的来历」）；content 写谜面、真相与兑现计划；expectation 写预期回收位置（如「第二卷结尾」），plannedChapter 可给全书线性章序号用于逾期提醒。身份未明的角色不要走这里，用 createForeshadowCharacter 登记伏笔角色。",
      inputSchema: z.object({
        title: z.string().describe("伏笔标题（短）"),
        content: z.string().optional().describe("伏笔内容：谜面/真相/兑现计划"),
        expectation: z.string().optional().describe("预期回收位置（自由文本）"),
        plannedChapter: z.number().int().positive().optional().describe("预期回收的全书线性章序号"),
        note: z.string().optional().describe("写作备忘（不进 AI 上下文）"),
      }),
      execute: async (input) => {
        try {
          const f = await foreshadowService.createForeshadow(novelId, input)
          return { ...ok(`已登记伏笔「${f.title}」`), foreshadowId: f.id }
        } catch (err) {
          return fail(err)
        }
      },
    }),

    updateForeshadow: tool({
      description:
        "更新伏笔档案（标题/内容/备注/预期回收）或状态。状态通常由触点自动维护（挂埋入触点→已埋，挂回收触点→已回收），只有作者明确拍板（如废弃某伏笔）才手动改 status。",
      inputSchema: z.object({
        foreshadowId: z.string().describe("伏笔 id"),
        title: z.string().optional(),
        content: z.string().optional(),
        expectation: z.string().optional(),
        plannedChapter: z.number().int().positive().nullable().optional().describe("null 清除"),
        note: z.string().optional(),
        status: z.enum(["PLANNED", "PLANTED", "RESOLVED", "DROPPED"]).optional(),
      }),
      execute: async ({ foreshadowId, ...patch }) => {
        try {
          const f = await foreshadowService.updateForeshadow(novelId, foreshadowId, patch)
          return { ...ok(`已更新伏笔「${f.title}」（${f.status}）`), foreshadowId: f.id }
        } catch (err) {
          return fail(err)
        }
      },
    }),

    deleteForeshadow: tool({
      description: "删除伏笔及其全部触点（破坏性操作，必须先经作者明确同意）。",
      inputSchema: z.object({
        foreshadowId: z.string().describe("伏笔 id"),
      }),
      execute: async ({ foreshadowId }) => {
        try {
          await foreshadowService.deleteForeshadow(novelId, foreshadowId)
          return ok("已删除伏笔")
        } catch (err) {
          return fail(err)
        }
      },
    }),

    addForeshadowTouch: tool({
      description:
        "给伏笔挂触点：记录它在某章的埋入（PLANT）/提及（MENTION）/回收（PAYOFF）。chapterId 从 getOutline 获得；也可传 chapterTitle 章题自动定位，歧义会报错。推演情节/建章纲时识别到伏笔的埋提收就要挂点，几百章后平台依然记得回收。挂埋入触点伏笔自动转「已埋」，挂回收触点自动转「已回收」。",
      inputSchema: z.object({
        foreshadowId: z.string().describe("伏笔 id"),
        kind: z.enum(["PLANT", "MENTION", "PAYOFF"]).describe("PLANT=该线索在故事中的首次埋入；MENTION=已有前序埋点后的再次提及；PAYOFF=兑现真相或用途。生成后的补登记仍按故事顺序分类，新发现线索的首次出现不能误记成MENTION"),
        summary: z.string().describe("这一笔的情节摘要（≤200 字；建议30字以内，便于与原文核对）"),
        chapterId: z.string().optional().describe("章 id"),
        chapterTitle: z.string().optional().describe("章题（chapterId 的兼容定位；唯一匹配才生效）"),
      }),
      execute: async ({ foreshadowId, kind, summary, chapterId, chapterTitle }) => {
        try {
          let resolvedChapterId = chapterId ?? null
          if (!resolvedChapterId && chapterTitle) {
            const chapters = await prisma.chapter.findMany({
              where: { volume: { novelId }, title: chapterTitle },
              select: { id: true },
            })
            if (chapters.length !== 1) {
              return fail(new Error(chapters.length === 0 ? `找不到章题「${chapterTitle}」` : `章题「${chapterTitle}」有多个匹配，请用 chapterId`))
            }
            resolvedChapterId = chapters[0].id
          }
          const touch = await foreshadowService.addTouch(novelId, foreshadowId, {
            kind,
            summary,
            chapterId: resolvedChapterId,
          })
          return { ...ok(`已挂${kind === "PLANT" ? "埋入" : kind === "MENTION" ? "提及" : "回收"}触点${touch.targetLabel ? `（${touch.targetLabel}）` : ""}`), touchId: touch.id }
        } catch (err) {
          return fail(err)
        }
      },
    }),

    removeForeshadowTouch: tool({
      description: "移除伏笔的某个触点（挂错了才用；已回收伏笔失去回收触点会自动回退为已埋）。",
      inputSchema: z.object({
        foreshadowId: z.string().describe("伏笔 id"),
        touchId: z.string().describe("触点 id（从 listForeshadows/getForeshadow 的触点链获得）"),
      }),
      execute: async ({ foreshadowId, touchId }) => {
        try {
          await foreshadowService.removeTouch(novelId, foreshadowId, touchId)
          return ok("已移除触点")
        } catch (err) {
          return fail(err)
        }
      },
    }),

    // ---------- 三阶段保存（docs/staged-save/technical-design.md §5.3） ----------
    analyzeStagedImpact: tool({
      description:
        "三阶段保存流水线第 1 步：分析本回合暂存修改的影响面（引用这些对象的章大纲/正文/世界线/叙事线数量与清单），并给出风险分级（low/medium/high）。修改含删除实体、命中≥5 章或涉及核心世界观/主角时为 high，须先 askUserQuestion 提示风险再继续。仅在携带面板修改批次的回合使用。",
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const staged = await readStagedAction()
          if (!staged) return fail("本回合没有暂存修改批次")
          const changes = staged.batches.flatMap(b => b.changes)
          const names = new Map<string, string>()
          for (const c of changes) {
            // 用库内权威名（创建类用目标标签）
            if (c.op === "create") { names.set(c.targetId, c.targetLabel); continue }
            const dbName = await resolveTargetName(c.targetKind, c.targetId)
            names.set(c.targetId, dbName ?? c.targetLabel)
          }
          const volumes = await prisma.volume.findMany({
            where: { novelId },
            orderBy: { index: "asc" },
            include: { chapters: { orderBy: { index: "asc" } } },
          })
          const items: { kind: string; title: string; where: string; hits: string[] }[] = []
          const hitChapters = new Set<string>()
          for (const volume of volumes) {
            for (const chapter of volume.chapters) {
              const hits = [...names.values()].filter(n => n.length >= 2 && (chapter.outline.includes(n) || chapter.content.includes(n)))
              if (hits.length === 0) continue
              hitChapters.add(chapter.id)
              const where = [
                hits.some(n => chapter.outline.includes(n)) ? "大纲" : null,
                hits.some(n => chapter.content.includes(n)) ? "正文" : null,
              ].filter(Boolean).join("+")
              items.push({ kind: "chapter", title: `${volume.title} · ${chapter.title}`, where, hits })
            }
          }
          const planningRow = await prisma.planningDocument.findUnique({ where: { novelId } })
          const planning = planningRow ? planningSchema.parse(planningRow.data) : null
          if (planning) {
            const eventHit = planning.events.filter(e => [...names.values()].some(name => name.length >= 2 && (e.title.includes(name) || e.fact.includes(name))))
            const cardHit = planning.cards.filter(c => [...names.values()].some(name => name.length >= 2 && (c.title.includes(name) || c.tellings.some(t => t.intent.includes(name)))))
            if (eventHit.length + cardHit.length > 0) items.push({ kind: "planning", title: "世界线/叙事线", where: `${eventHit.length} 事件/${cardHit.length} 卡片`, hits: [] })
          }
          const hasDelete = changes.some(c => c.op === "delete")
          const hasCore = changes.some(c => ["WORLD", "SETTING"].includes(c.targetKind)) || [...names.values()].some(n => /主角|世界观|力量体系|核心/.test(n))
          const risk = hasDelete || hitChapters.size >= 5 || (hasCore && hitChapters.size >= 3) ? "high" : hitChapters.size >= 2 || hasCore ? "medium" : "low"
          const reasons = [
            hasDelete ? `包含删除实体 ${changes.filter(c => c.op === "delete").length} 个` : null,
            hitChapters.size >= 5 ? `命中章节 ≥5（${hitChapters.size} 章）` : null,
            hasCore ? "涉及核心世界观/设定" : null,
          ].filter(Boolean)
          return {
            ...ok(`影响面分析完成：命中 ${hitChapters.size} 章（大纲/正文）${items.filter(i => i.kind === "planning").length} 处世界线/叙事线；风险 ${risk}${reasons.length ? `（${reasons.join("；")}）` : ""}。${risk === "high" ? "必须先 askUserQuestion 提示风险（选项含「撤销修改」「强制继续」），按作者回答继续或中止。" : risk === "medium" ? "影响面可控，可直接进入落库。" : "影响面很小，可直接落库。"}`),
            totalChapters: hitChapters.size,
            items,
            risk,
            reasons,
          }
        } catch (err) {
          return fail(err)
        }
      },
    }),

    commitStagedChanges: tool({
      description:
        "三阶段保存流水线唯一落库口：把本回合作者确认的面板修改（含删除/世界观内创建）经服务层落库（版本/幂等/修订快照）。单笔失败不中断整批；版本冲突如实返回。SETTING/CHARACTER 不自动级联，回执带 cascade 候选，须先 askUserQuestion 询问作者后才可调 triggerCascadeRevision。仅在携带面板修改批次的回合、analyzeStagedImpact（及必要的风险问答）之后调用。",
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const staged = await readStagedAction()
          if (!staged) return fail("本回合没有暂存修改批次")
          const changes = staged.batches.flatMap(b => b.changes)
          const { commitStagedChanges: execute } = await import("@/lib/services/staged-commit")
          const receipt = await execute({ userId, novelId }, changes)
          const parts = [
            receipt.committed.length > 0 ? `已落库 ${receipt.committed.length} 项：${receipt.committed.map(c => `${c.op === "delete" ? "删除" : c.op === "create" ? "新增" : ""}「${c.targetLabel}」`).join("、")}` : null,
            receipt.conflicts.length > 0 ? `版本冲突 ${receipt.conflicts.length} 项（未落库，面板将刷新为最新稿）：${receipt.conflicts.map(c => `「${c.targetLabel}」`).join("、")}` : null,
            receipt.errors.length > 0 ? `失败 ${receipt.errors.length} 项：${receipt.errors.map(c => `「${c.targetLabel}」${c.message}`).join("、")}` : null,
          ].filter(Boolean)
          return {
            ...ok(`${parts.join("；") || "没有可落库的修改"}。下一步：对落库目标做对应评审（正文→requestAIReview、设定/角色/题材→reviewStoryCheckpoint、世界线/叙事线→reviewStoryCheckpoint(phase:plot:worldline/phase:plot:narrative)），不达标自愈≤2轮；${receipt.cascade.length > 0 ? "存在级联候选，须先 askUserQuestion 询问作者是否级联及方案（含「不级联」选项），确认后再调 triggerCascadeRevision。" : "无级联候选。"}`),
            committed: receipt.committed,
            conflicts: receipt.conflicts,
            errors: receipt.errors,
            cascade: receipt.cascade,
          }
        } catch (err) {
          return fail(err)
        }
      },
    }),

    triggerCascadeRevision: tool({
      description:
        "三阶段保存流水线第 5 步（仅经 askUserQuestion 获得作者确认后调用）：对落库的设定/角色变更触发级联修订，产出各章大纲/正文的修订候选（before/after 对照），作者在级联面板逐条应用或跳过。只处理与本次变更相关的内容。",
      inputSchema: z.object({
        triggerType: z.enum(["SETTING", "CHARACTER"]).describe("commitStagedChanges 回执 cascade 项的 triggerType"),
        triggerId: z.string().describe("对应实体的真实 id（回执 committedId）"),
        changeDescription: z.string().min(1).max(2000).describe("变更描述（旧→新），喂给级联修订；用回执 cascade 项的 changeDescription，可按作者问答结论补充取舍"),
      }),
      execute: async ({ triggerType, triggerId, changeDescription }) => {
        try {
          const { triggerCascade } = await import("@/lib/services/cascade")
          const job = await triggerCascade({ novelId, triggerType, triggerId, changeDescription })
          if (!job) return { ...ok("当前作品还没有卷章或处于对话创作流程，无需级联修订；跳过此步。"), skipped: true }
          return {
            ...ok(`级联修订已启动（job ${job.id}）：将逐章产出修订候选，完成后在级联面板逐条待确认。请在报告中告知作者去级联面板逐条应用/跳过；已应用的级联项需要逐一评审（不达标自愈）。`),
            jobId: job.id,
          }
        } catch (err) {
          return fail(err)
        }
      },
    }),
  }
}

export type AgentTools = ReturnType<typeof createAgentTools>
