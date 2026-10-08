import { prepareStoryTask } from "@/lib/services/story-task"
import { generateCharacterArc, generateCharacterArcSchema } from "@/lib/services/character-arc"
import { tool, type ToolSet } from "ai"
import { z } from "zod"
import { prisma } from "@/lib/db"
import { classifyError, isSchemaDriftError } from "@/lib/ai/error-classification"
import { ContentError } from "@/lib/content-errors"
import { STORY_APPROVAL_OPTIONS, STORY_APPROVE_ANSWER, STORY_REVISE_ANSWER, storyPhaseSchema } from "@/lib/story-workflow"
import { getStoryWorkflow, updateStoryWorkflow, updateStoryWorkflowSchema, reopenStoryPhase, reviewStoryCheckpoint, prepareStoryApproval } from "@/lib/services/story-workflow"
import { ownedStory, readStoryArtifacts, linkStoryArtifacts, storyImpact, storySources, type StoryScope } from "@/lib/services/story-artifacts"
import { generateStoryChapters } from "@/lib/services/story-writing"
import { prepareStoryContentApproval } from "@/lib/services/story-content-approval"
import { prepareStoryRemoval, listStoryRemovals, restoreStoryStructure } from "@/lib/services/story-structure"
import { currentChatExecution } from "@/lib/chat-execution"
import { requestHash } from "@/lib/services/content-commit"
import { storyPhaseDefinition } from "@/lib/sop/graph"
import { summarizeStoryWorkflow } from "./story-workflow-summary"

const key = z.string().min(3).max(160).describe("getStoryWorkflow 返回的产物 key；阶段用 phase:brainstorm/settings/plot/outline/writing/revision；plot 环节须用子键 phase:plot:worldline 或 phase:plot:narrative（先世界线后叙事线；旧 skeleton 环节已并入 outline）")
export async function storyOperationResult<T>(run: () => Promise<T>) {
  try { return JSON.parse(JSON.stringify(await run())) as T }
  catch (error) {
    if (error instanceof ContentError) return { ok: false, code: error.code, message: error.message }
    const classified = classifyError(error)
    if (classified.category !== "internal") return { ok: false, code: classified.code, message: classified.message }
    // 内部失败必须留证：工具结果面向模型，技术细节只进服务端日志。
    console.error("[story-tool] 操作内部失败", JSON.stringify({ name: error instanceof Error ? error.name : "Unknown", code: error && typeof error === "object" && "code" in error ? String(error.code) : undefined, detail: error instanceof Error ? error.message.split("\n").slice(-3).join("\n").slice(0, 500) : "未知错误" }))
    // 结构漂移等具体诊断如实透传：模型应如实告知作者，不能按「读取进度后继续」空转重试。
    if (isSchemaDriftError(error)) return { ok: false, code: classified.code, message: classified.message }
    return { ok: false, code: "STORY_OPERATION_FAILED", message: "创作步骤未完成，已保存内容保留，请读取进度后继续" }
  }
}
export function createStoryWorkflowTools(scope: StoryScope): ToolSet {
  return {
    generateCharacterArc: tool({ description: "依据角色设定和剧情生成3–5个因果连贯的弧线阶段。保存到角色弧线，保留原稿快照；已有链可mode=append追加后续阶段；mode=replace必须指定stageIds，只改这些阶段，其他手工阶段保留。无剧情时事件标为建议。不创建图片或改写叙事线。", inputSchema: generateCharacterArcSchema, execute: input => storyOperationResult(() => generateCharacterArc(scope, input)) }),
    completeStoryTask: tool({ description: "本子任务实际内容完成后调用：对keys指向的最终版本检查一次，返回真实评分与多种下一步问答，允许剧情/角色/世界自由选择；同版认可复用，达标后可继续改进。批量创建的同一任务合并keys，不逐字段发问。本工具返回有效问题后立即结束。不能用于尚未执行的任务。当只剩一个不涉及认可/付费的下一步时，本工具不返回问答而返回 autoProceed 指令：必须本轮直接执行该任务一次并用文字汇报收尾，不再调用本工具或 askUserQuestion 追问。", inputSchema: z.object({ keys: z.array(z.string().min(3).max(160).describe("本次实际产物的key，从工具回执changedKeys或getStoryWorkflow.artifacts读取，例如world:实际ID、character:实际ID、narrative:实际ID、chapter-outline:实际ID。简报可用phase:brainstorm；不能传phase:settings/plot/outline/writing等阶段key")).min(1).max(20), suggestions: z.array(z.object({ task: z.enum(["character", "plot", "world"]), scopeLabel: z.string().max(100), names: z.array(z.string().min(1).max(50)).max(4).optional(), sourceKey: z.string(), quote: z.string().min(1).max(300) })).max(3).optional().describe("可选：从真实产物引用具体缺口；未确认的身份只会作为澄清选项，不能自行确认作者意图") }), execute: input => storyOperationResult(async () => ({ ok: true, ...await prepareStoryTask(scope, input.keys, true, input.suggestions) })) }),
    requestStoryRemoval: tool({ description: "聊天回收任何创作资料（主题/世界及子级/设定/角色/物品/场景/伏笔/爽点/属性）以及卷章。返回完整影响范围和固定问答，作者确认后才执行，保留原ID可恢复快照。整章用chapter-outline:id，只清正文用chapter-content:id。不用表单。", inputSchema: z.object({ key }), execute: input => storyOperationResult(async () => {
      const prepared = await prepareStoryRemoval(scope, input.key)
      return { ok: true, details: prepared, question: { questions: [{ question: prepared.summary, options: [STORY_APPROVE_ANSWER, STORY_REVISE_ANSWER] }], markerStyle: "letters", contentApproval: { kind: "remove", key: input.key, hash: prepared.hash } } }
    }) }),
    listStoryRemovals: tool({ description: "查找本作品通过聊天回收的设定/角色/世界/伏笔等资料、卷章和正文及恢复状态。返回回收记录ID，供restoreStoryStructure恢复。", inputSchema: z.object({}), execute: () => storyOperationResult(async () => ({ ok: true, archives: await listStoryRemovals(scope) })) }),
    restoreStoryStructure: tool({ description: "作者反悔时恢复聊天回收记录的原内容与来源ID。不覆盖新稿或已占用位置；冲突时用问答请作者选择空闲序号/所属卷，再以placement恢复，无需表单。", inputSchema: z.object({ archiveId: z.string(), placement: z.object({ index: z.number().int().positive().max(2_000_000_000).optional(), volumeId: z.string().optional().describe("只用于整章恢复，必须是本书已有卷") }).optional() }), execute: input => storyOperationResult(async () => {
      const execution = currentChatExecution()
      if (!execution?.operationId) throw new ContentError("STORY_EXECUTION_REQUIRED", "恢复需要有效聊天回合", 409)
      return { ok: true, restored: await restoreStoryStructure(scope, input.archiveId, requestHash({ operation: execution.operationId, archiveId: input.archiveId }), input.placement) }
    }) }),
    requestContentApproval: tool({ description: "聊天内请求作者采用候选稿或定稿正文。先读取/展示候选差异与评分，或定稿清单；本工具只发问，必须等待作者真实回答。候选未完成不能采用，最终正文版本不允许模型代批。", inputSchema: z.object({ chapterId: z.string(), kind: z.enum(["candidate", "finalize"]), candidateId: z.string().optional() }), execute: input => storyOperationResult(async () => { const prepared = await prepareStoryContentApproval({ ...scope, chapterId: input.chapterId }, input.kind, input.candidateId); return { ok: true, storyFocus: prepared.focus, details: prepared.details, question: { questions: [{ question: prepared.summary, options: [STORY_APPROVE_ANSWER, STORY_REVISE_ANSWER] }], markerStyle: "letters", contentApproval: prepared.approval } } }) }),
    generateStoryChapters: tool({ description: "按作者已认可的写作方案持续生成整书：每批最多5章，逐章生成→评审→必要改进，达标才写下一章；逐章模式只写1章并等待作者。自动跳过已完成章节，断线后先getStoryWorkflow再续跑。作者要求高于平台默认分数时，每批和续跑均传minimumScore，例如超过85分传86；已有当前版评分未达该门槛的章节也会继续改进，不跳过。候选待决定或低分时保留结果并暂停，不视为达标。", inputSchema: z.object({ count: z.number().int().min(1).max(5).default(3), expectedVersion: z.number().int().positive(), minimumScore: z.number().int().min(storyPhaseDefinition("writing").checkpoints[0].threshold).max(100).optional().describe("本次批量及续跑的正文最低评分；须遵循作者要求，例如超过85分传86，不传沿用平台默认门槛；不能降低平台门槛") }), execute: input => storyOperationResult(() => generateStoryChapters(scope, input)) }),
    getStoryWorkflow: tool({ description: "读取六环节创作进度、当前版本审批/检查点、真实产物key和指纹、待关联修订。reviewProgress明确逐章列出passed/stale/unreviewed/improve；只有当前指纹的passed才有效，不能把直接修改范围当成全部失效范围。普通评审意见用getStoryArtifact({key})按目标读取，阻塞和待作者决定意见保留。剧情搭建完成证据是phase:plot:worldline与phase:plot:narrative。null表示未启动；继续或反悔时先读。", inputSchema: z.object({}), execute: () => storyOperationResult(async () => ({ ok: true, workflow: summarizeStoryWorkflow(await getStoryWorkflow(scope)) })) }),
    updateStoryWorkflow: tool({ description: "只保存创作简报、当前阶段、逐章/批量方式与规模；不修改任何设定/世界/角色的原文。必须填写要改变的字段，禁止空更新。修改具体产物请loadCreationTools启用对应写入工具。首次expectedVersion=0；不代表环节已通过。", inputSchema: updateStoryWorkflowSchema,
      execute: input => storyOperationResult(async () => ({ ok: true, message: "创作进度已保存", workflow: await updateStoryWorkflow(scope, input) })) }),
    reopenStoryPhase: tool({ description: "回到任意环节并记录原因，清除该阶段汇总检查；实际产物仍按内容与来源判断是否需重评。修改后读取getStoryImpact核对真实关联，不清空无关任务的认可。", inputSchema: z.object({ phase: storyPhaseSchema, reason: z.string().min(1).max(2000), expectedVersion: z.number().int().positive() }),
      execute: input => storyOperationResult(async () => ({ ok: true, message: "已回到指定环节，相关阶段需要重新检查", workflow: await reopenStoryPhase(scope, input.phase, input.reason, input.expectedVersion) })) }),
    reviewStoryCheckpoint: tool({ description: "检查真实产物并保存当前版本证据。依赖顺序必须串行：先phase:plot:worldline通过，再评phase:plot:narrative；大纲先逐个chapter-outline:真实ID评审，全部通过后才phase:outline汇总。不得同时调用互相依赖的检查点，也不得用阶段汇总代替各章独立评审。同一内容与来源的评审（包括低分）直接复用，修改后才重评。阶段汇总只做结构检查，不重复模型评分。子任务完成优先completeStoryTask一次收尾并给下一步选项。分数由服务端评审生成，不能由模型自报。", inputSchema: z.object({ key }), execute: input => storyOperationResult(() => reviewStoryCheckpoint(scope, input.key)) }),
    requestStoryApproval: tool({ description: "对当前版本已评审达标的一个产物/环节发起作者审核。自动打开内容并展示确认问题；必须结束本轮，只有作者的真实回答能批准，不能代替作者确认。", inputSchema: z.object({ key }),
      execute: input => storyOperationResult(async () => {
        if (input.key !== "policy:writing" && (!input.key.startsWith("phase:") || input.key === "phase:brainstorm")) {
          try {
            return { ok: true, ...await prepareStoryTask(scope, [input.key], true, [], false) }
          } catch (error) {
            // 产物由更早的任务完成（如规划提案落库）而非本轮产出：prepareStoryTask 的“本任务回执”门禁不适用——落到 prepareStoryApproval：评审达标且指纹当前即可直接发起作者认可；已认可会明确回报，不重复询问。
            if (!(error instanceof ContentError && error.code === "STORY_TASK_INCOMPLETE")) throw error
          }
        }
        const prepared = await prepareStoryApproval(scope, input.key); if (prepared.alreadyApproved) return { ok: true, alreadyApproved: true, key: input.key, message: `「${prepared.title}」的当前版本已获作者认可，不必重复询问。请 getStoryWorkflow 查看其他待处理项。` }; return { ok: true, message: "已请作者审核这一版，结束本轮等待回答", storyFocus: prepared.focus, question: { questions: [{ question: `你认可这一版「${prepared.title}」吗？`, options: [...STORY_APPROVAL_OPTIONS] }], markerStyle: "letters", storyApproval: prepared.approval } } }) }),
    getStoryArtifact: tool({ description: "根据产物key读取完整内容、内容指纹和完整评审意见checkpoint，并标明评审是否仍有效checkpointCurrent。阶段key返回简报、状态与完整评审；plot子键返回对应检查点。getStoryWorkflow中的普通意见引用可用本工具重读。修改前读取，不猜ID；来源关联用产物hash。", inputSchema: z.object({ key }), execute: input => storyOperationResult(async () => {
      if (input.key.startsWith("phase:")) {
        const workflow = await getStoryWorkflow(scope), phase = workflow?.phases.find(p => `phase:${p.id}` === input.key)
        const sub = workflow?.phases.flatMap(p => (p.subkeys ?? []).map(s => ({ ...s, phaseId: p.id, phaseLabel: p.label }))).find(s => s.key === input.key)
        if (!workflow || (!phase && !sub)) throw new ContentError("STORY_ARTIFACT_NOT_FOUND", "创作阶段尚未启动", 404)
        return { ok: true, phase: phase ?? { id: sub!.phaseId, label: `${sub!.phaseLabel} · ${sub!.label}`, status: sub!.status, hash: sub!.hash, score: sub!.score, blockers: sub!.blockers }, brief: workflow.brief, checkpoint: workflow.checkpoints[input.key], checkpointCurrent: workflow.checkpoints[input.key]?.hash === (sub?.hash ?? phase?.hash), approval: workflow.approvals[input.key], version: workflow.version }
      }
      const graph = await readStoryArtifacts(scope), artifact = graph.artifacts.find(a => a.key === input.key)
      if (!artifact) throw new ContentError("STORY_ARTIFACT_NOT_FOUND", "产物不存在或不属于本书", 404)
      const workflow = await getStoryWorkflow(scope)
      const evidence = workflow?.artifacts.find(a => a.key === input.key)
      return { ok: true, artifact, checkpoint: workflow?.checkpoints[input.key],
        checkpointCurrent: !!evidence && workflow?.checkpoints[input.key]?.hash === evidence.evidenceHash,
        approval: workflow?.approvals[input.key], version: workflow?.version }
    }) }),
    linkStoryArtifacts: tool({ description: "把实际产物关联为来源→目标，可多对多。叙事线分章投影由规划自动维护，手工补充来源用它。expectedSourceHash/expectedTargetHash 从getStoryArtifact读取。源变更后必须先核对并修订目标，再用新指纹确认关系，不能只消除提示。", inputSchema: z.object({ sourceKey: key, targetKey: key, reason: z.string().min(1).max(2000), expectedSourceHash: z.string(), expectedTargetHash: z.string() }),
      execute: input => storyOperationResult(async () => ({ ok: true, message: "故事来源关联已保存", link: await linkStoryArtifacts(scope, input.sourceKey, input.targetKey, input.reason, input.expectedSourceHash, input.expectedTargetHash) })) }),
    unlinkStoryArtifacts: tool({ description: "删除明确不再成立的一条补充来源关联；只解除关系，不删除产物。叙事线分章归属用 proposeNovelPlanning 修改。", inputSchema: z.object({ linkId: z.string() }), execute: input => storyOperationResult(async () => { await ownedStory(scope); const deleted = await prisma.storyArtifactLink.deleteMany({ where: { id: input.linkId, novelId: scope.novelId } }); if (!deleted.count) throw new ContentError("STORY_LINK_NOT_FOUND", "关系不存在或不属于本书", 404); return { ok: true, message: "已解除这条来源关联" } }) }),
    getStoryImpact: tool({ description: "反悔或改设定时分析其直接/传递关联，覆盖设定、角色、场景、物品、伏笔、世界线、叙事线、章纲和正文。明确关联逐项核对修改，可能关联及多解使用askUserQuestion。", inputSchema: z.object({ key }), execute: input => storyOperationResult(async () => ({ ok: true, ...await storyImpact(scope, input.key) })) }),
    getStorySources: tool({ description: "双向查询某产物的完整来源链与下游覆盖；可查正文来自哪些叙事卡片、某叙事线对应哪些正式章节。", inputSchema: z.object({ key }), execute: input => storyOperationResult(async () => ({ ok: true, ...await storySources(scope, input.key) })) }),
  }
}
