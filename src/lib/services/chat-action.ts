import { WRITE_TOOL_NAMES } from "@/lib/ai/tool-names"
import { STORY_TASK_TOOL_HINTS, materialTaskChapterIds } from "@/lib/story-task"
import type { Prisma } from "@/generated/prisma/client"
import type { ChatAction } from "@/lib/chat-parts"
import { parseStagedSaveAction } from "@/lib/staged-save"
import { ContentError } from "@/lib/content-errors"
import { REDRAW_WORD_LIMIT } from "@/lib/draw-redraw"
import { compileImproveFeedback } from "@/lib/improve-draw"
import { chapterMaterialReconciliationChapterId, chapterMaterialReconciliationReads } from "@/lib/chapter-material-reconciliation"
import { planningAdjustmentOf } from "@/lib/planning-adjustment"
import { materialTaskReadiness } from "@/lib/material-task-readiness"
export async function validateChatAction(tx: Prisma.TransactionClient, action: ChatAction | undefined, novelId: string | null) {
  if (planningAdjustmentOf(action)) throw new ContentError("STORY_CHOICE_REQUIRED", "请通过原规划提案的问答或恢复按钮调整", 400)
  if (!action || action.kind === "question") return
  if (!novelId) throw new ContentError("ACTION_SCOPE_INVALID", action.kind === "review" ? "请先关联要评审的作品" : "请先关联要改进的作品", 400)
  if (action.kind === "storyTask") {
    if (action.scope || action.requirements !== undefined || ["outline-board", "next-plot", "sample-outline", "scene", "item", "custom", "revise", "prepare-writing", "chapter-boards"].includes(action.task)) throw new ContentError("STORY_CHOICE_REQUIRED", "请通过当前任务菜单提交具体范围", 400)
    if (action.targetKey) {
      const { readStoryArtifacts } = await import("./story-artifacts")
      const novel = await tx.novel.findUniqueOrThrow({ where: { id: novelId }, select: { userId: true } })
      const graph = await readStoryArtifacts({ userId: novel.userId, novelId }, tx)
      if (action.targetKey !== "phase:brainstorm" && !graph.artifacts.some(a => a.key === action.targetKey)) throw new ContentError("ACTION_SCOPE_INVALID", "任务目标不属于本作品", 404)
    }
    return
  }
  if (action.kind === "improve" && action.draw) {
    if (action.targetType !== "CHAPTER_CONTENT") throw new ContentError("ACTION_SCOPE_INVALID", "正文改进抽卡仅支持章正文", 400)
    if (action.draw.wordMin > action.draw.wordBudget || action.draw.wordBudget > REDRAW_WORD_LIMIT) throw new ContentError("INVALID_INPUT", `字数范围须为 1 ≤ 下限 ≤ 上限 ≤ ${REDRAW_WORD_LIMIT} 的整数`, 400)
  }
  const found = action.targetType.startsWith("CHAPTER_") ? await tx.chapter.findFirst({ where: { id: action.targetId, volume: { novelId } }, select: { id: true } })
    : await tx.volume.findFirst({ where: { id: action.targetId, novelId }, select: { id: true } })
  if (!found) throw new ContentError("ACTION_SCOPE_INVALID", action.kind === "review" ? "评审对象不存在或不属于当前作品" : "改进对象不存在或不属于当前作品", 404)
}
export function chatActionNote(action: ChatAction | null | undefined) {
  if (!action) return ""
  const adjustment = planningAdjustmentOf(action)
  if (adjustment) return `\n【原规划提案调整】${JSON.stringify(adjustment)}。作者选择不采用，原候选保持未采用。只处理原范围，不切换世界/角色认可，不创建无关资料，不批准或写正文，不调用applyNovelPlanningProposal。${adjustment.phase === "clarify" ? "本轮仅澄清：用askUserQuestion给出针对原提案的有效调整选项，不能以裸文字要求作者说明收尾；不修改任何资料或提案。" : "作者已经通过原范围澄清题提供调整方向。先getNovelPlanning核对当前规划与pendingProposals，并读取原目标真实内容与关联资料，逐项核对候选问题；确需调整只提出有限proposeNovelPlanning新候选并askUserQuestion展示改动请作者确认，不自动采用。无法确定的事实先用askUserQuestion澄清；选择暂不调整时保留原候选并询问下一步。"}`
  // 三阶段保存：暂存批次（turn.action = { kind: "stagedSave", batches }）走专用流水线指令
  const staged = parseStagedSaveAction(action)
  if (staged) return stagedSavePipelineNote(staged)
  const reconciliationChapterId = chapterMaterialReconciliationChapterId(action)
  if (reconciliationChapterId) return `\n【作者已选择本章资料与伏笔核对】${JSON.stringify(action)}。先读取getChapterContent(chapterId=${reconciliationChapterId})、getNovelPlanning及范围内当前章纲；必须分别调用listItems、listScenes、listForeshadows(chapterId=${reconciliationChapterId}，不传status过滤)读取完整三类目录，不能凭部分档案、touch写入、getStoryWorkflow或口头判断声称齐全。逐项对照本章正文原句、实际讲述/关联事件及档案：关键物品、场景是否已有可用档案并有实际剧情引用，伏笔实际埋提收是否已按故事顺序登记；一般背景物件无需建档。档案先复用，确有缺项才按已有工具补齐；规划引用/事实矛盾先提出有限proposeNovelPlanning提案并askUserQuestion等作者采用，不把正文当世界真相，不自动改既存设定。真实正文伏笔缺登记时核对去重后addForeshadowTouch，不用候选或未来章补录。三类目录和本章正文/规划读回执齐全且无缺项时允许无额外写入收尾，如实汇报核对结果，completeStoryTask给出下一步；发现缺项先完成正常补齐或提案问答，不以读目录代替修复。不改正文、不定稿、不提前揭谜，只处理本章。`
  const materialChapterIds = action.kind === "storyTask" ? materialTaskChapterIds(action) : []
  const materialReferenceNote = materialChapterIds.length ? `\n【已选章正文的材料参考】必须本回合先对所选章节${materialChapterIds.join("、")}逐章调用getChapterContent读取正式全文，并读取对应章纲及scope中其他明确来源；读取listItems和listScenes核对已有档案，两类完整目录都须取得。所选正文、scope内章纲及两目录成功回执齐备后才可创建/更新材料及收尾；失败或空占位不算读取，工具返回缺项时先补读，不重复盲写。读取齐备不等于资料语义完备，必须逐项对照正文与章纲事实，不凭记忆声称匹配。仅补所选内容实际缺失的关键物品/场景，已有档案先复用，一般背景物件无需逐一建档。已存档案矛盾或需补充时先正常有限修订提案并askUserQuestion等作者确认；所选正文不视为世界真相，不自动改既存设定。scope.sourceKeys仅参考，不写正文、不批准、不定稿，也不拓展到未选章节。` : ""
  if (action.kind === "storyTask") return `\n【作者已选择本次子任务】${JSON.stringify(action)}。结合当前作品的设定、剧情、世界观、已有实体与别名执行；scope.sourceKeys是参考而不是写入目标，选定世界时upsertSetting使用对应worldId和category类型，正式卷章由叙事线投影生成（proposeNovelPlanning），空补充表示由你合理设计，不表示不知道任务。先读范围内真实进度；人物姓名和别名重复时不新建，身份不明先提问。scope.targetKeys与stageIds限制改动范围；arcMode=create/append/replace分别为首次生成/追加后续/修改指定阶段，必须原样传给generateCharacterArc的mode。plot任务在世界线与叙事线上工作：先getNovelPlanning读现状，世界线记录客观事实与时间，叙事线组织讲述顺序、视角与披露/保留，叙事卡片优先引用既有世界事件，确需新事实先建事件再关联；写入一律经proposeNovelPlanning提案；提案后同轮askUserQuestion请作者确认，作者明确同意后调applyNovelPlanningProposal采用生效并继续后续挂载。有依赖关系的对象（如世界线与挂载其上的事件）必须放同一提案批次，不得拆成前后两个提案。严禁以「请到面板采用/操作」收尾回合：回合收尾合法形态只有完成动作并completeStoryTask给出下一步、问答面板、或明确汇报正在进行的动作三种，禁止裸文字指示作者操作界面。outline任务先askUserQuestion询问每章字数范围（选项含2000～3000【默认推荐】/3000～5000/5000～8000，作者拒答或选默认时明示默认值再落库），再按主叙事线卡片树用proposeNovelPlanning提案分卷分章与各章wordMin/wordBudget，经问答确认后调applyNovelPlanningProposal采用生效；单章微调引导至卷章大纲面板。prepare-writing只准备targetKey所指章的写作条件：读取章纲及前文状态，缺失或过期的评审用reviewStoryCheckpoint补齐，不改写内容、不批准大纲、不生成正文；评审未达标或前文需作者认可时用askUserQuestion展示具体问题与处理选项等待作者选择，条件齐备后completeStoryTask展示生成正文选项，由作者确认本章与字数。next-plot以scope.anchorKey所指叙事卡片为续长位置：先getNovelPlanning核对世界线事件与已有卡片，提出2~4个方向互异的后续候选，askUserQuestion等作者选择，不直接落库，不调用completeStoryTask。custom先确认具体目标，不能以任意写入代替任务；revise按requirements修改指定对象，正文复用improveChapterContent候选政策。新建场景/物品/世界设定须结合scope选择；所有批量目标全部完成后才收尾。只执行所选任务，不被其他待认可产物阻塞。writing只写targetKey所指章节，字数以wordCount为准，先approveOutline再generateChapterContent；arc首次设计3–5个有剧情因果的阶段，追加时保留原链，替换时只修改指定阶段；improve读取当前评审建议并局部修订，不重复询问开始；discuss只接收作者补充，不修改内容、不重新问同一版认可；choose调用askUserQuestion给出世界、角色、剧情、弧线等下一步。其他任务完成实际写入后调用completeStoryTask，不以读工具或口头承诺代替完成。${materialReferenceNote}`
  if (action.kind === "review") return `\n作者从评分面板发起评审，目标经服务端验证：${JSON.stringify(action)}。按本轮请求完成评审并汇报评分与意见。`
  if (action.kind === "question") return "\n本轮明确请求结构化提问，请用 askUserQuestion 生成有效问题；口头承诺不能代替问题卡。"
  if (action.kind === "finalize") return `\n作者已在正文面板查看检查清单并确认此版本定稿：${JSON.stringify(action)}。调用 finalizeChapter 记录确认；若版本或清单过期，引导作者重新查看，不要自行更新确认的版本。`
  // 正文改进对话框（评审视图「改进正文」）：以当前正文为底稿的抽卡任务，参数全部来自对话框载荷
  if (action.kind === "improve" && action.draw) {
    const draw = action.draw
    return `\n【正文改进对话框·改进抽卡】作者已在评审视图的改进对话框中确认配置（结构化载荷存于本回合 action，为准）：以当前正文为底稿抽 ${draw.count} 张改进候选稿，字数范围 ${draw.wordMin}～${draw.wordBudget} 字（仅本批候选，不改卷章大纲）。\n执行：读取 getChapterContent 的 version 后调用 drawChapterCandidates，原样传 chapterId=${action.targetId}、baseOnCurrent=true、count=${draw.count}、wordMin=${draw.wordMin}、wordBudget=${draw.wordBudget}；feedback 必须完整传入下列勾选的改进项（未列出的一律不处理、不改动）：\n${compileImproveFeedback(draw.items)}\n抽卡完成后按既有选稿流程 askUserQuestion 请作者选稿；候选不自动采用、不替换正文、不自动定稿。本轮不得调用 improveChapterContent / handleTextComment / writeChapterContent。`
  }
  if (action.targetType === "CHAPTER_CONTENT") return `\n作者已明确授权改进正文 ${action.targetId}。读取 getChapterContent 的 version 后调用 improveChapterContent；该服务统一读取评论、前后章、生成候选和可比评审，只有真实 committed 回执才算已采用。不能先用 handleTextComment 修改当前评论，也不能用 writeChapterContent 或其他写入绕过候选比较。降分、检查问题及评审失败只交付候选；不反复调用刷分，本轮不自动定稿。`
  return `\n本轮由作者明确发起按意见改进，目标经服务端验证：${JSON.stringify(action)}。读取此目标的当前稿、评审与 OPEN 评论，跳过已拒绝意见；遵守精确替换与版本保护，以工具真实回执汇报，不把准备中的候选说成已保存，不自动定稿。内部 ID 与工具参数仅用于调用，不打印到作者正文。`
}

/** 三阶段保存流水线指令：随系统提示注入（不落库模板、不经模板缓存） */
function stagedSavePipelineNote(staged: { batches: { label: string; changes: { targetKind: string; targetLabel: string; op: string; items: { fieldLabel: string }[] }[] }[] }) {
  const manifest = staged.batches.map(b =>
    `批次「${b.label}」：${b.changes.map(c => `${c.op === "delete" ? "删除" : c.op === "create" ? "新增" : "修改"}${c.targetLabel}（${c.items.map(i => i.fieldLabel).join("、")}）`).join("；")}`
  ).join("\n")
  return `
【三阶段保存·落库流水线】作者在面板确认了以下修改（结构化载荷已存于本回合 action，工具内可直接读取）：\n${manifest}
本轮必须严格按序执行，不得跳过步骤，除本流水线外不得用其它写工具改写这些内容：
1) 先调 analyzeStagedImpact 分析影响面（引用这些对象的章大纲/正文/世界线/叙事线数量与清单）。
2) 若影响面有破坏性风险（核心设定改写、影响章节≥5、含删除实体），先用 askUserQuestion 提示风险，选项含「撤销修改」「强制继续」；按作者回答继续或中止。
3) 调 commitStagedChanges 落库（唯一落库口；版本/幂等/快照由服务层保障，冲突如实报告）。
4) 对落库目标做对应评审（章正文→requestAIReview；设定/角色/题材等→reviewStoryCheckpoint 对应检查点；世界线/叙事线→reviewStoryCheckpoint 的 phase:plot:worldline / phase:plot:narrative 子键）；评审不达标按既有改进流程自愈（≤2 轮），上限未收敛如实报告。自愈只做最小必要的阻塞项修复：必须原样保留作者本次修改的表述与新增内容，不得整段重写覆盖；确需删改作者刚写入的内容时，先 askUserQuestion 说明原因并等作者选择。
5) 若 commitStagedChanges 回执给出 cascade 候选：先 askUserQuestion 询问是否级联及方案取舍（含「不级联」选项），作者确认后才可调 triggerCascadeRevision；只修改相关位置，无关内容不得改。
6) 级联已应用项逐一评审（不达标同样自愈），最后输出修改报告：落库清单 + 评审分 + 级联清单 + 未决项。`
}
/** 各改进目标的回执工具（hasActionReceipt 判定与 compact 预装同源，避免两处名单漂移）。 */
const ACTION_RECEIPT_TOOLS = { CHAPTER_CONTENT: ["improveChapterContent"], CHAPTER_OUTLINE: ["updateChapterOutline"], VOLUME_OUTLINE: ["updateVolumeOutline"] } as const

/** compact 工具按需加载时，按回合动作预装执行链（读当前稿 → 回执工具）；面板动作的工具名单服务端已知，不应让模型先空转一轮 loadCreationTools。 */
export function actionToolHints(action: ChatAction | null | undefined): string[] {
  const adjustment = planningAdjustmentOf(action)
  if (adjustment) return adjustment.phase === "clarify" ? ["getNovelPlanning", "getStoryArtifact", "askUserQuestion"] : ["getNovelPlanning", "getStoryArtifact", "getChapterContent", "getOutline", "listItems", "listScenes", "listForeshadows", "proposeNovelPlanning", "askUserQuestion"]
  if (!action || action.kind === "question") return []
  // 三阶段保存回合：预装流水线工具（analyze → commit → 评审 → 级联），askUserQuestion/reviewStoryCheckpoint 已在 CORE
  if (parseStagedSaveAction(action)) return ["analyzeStagedImpact", "commitStagedChanges", "requestAIReview", "triggerCascadeRevision"]
  if (chapterMaterialReconciliationChapterId(action)) return ["getChapterContent", "getNovelPlanning", "getStoryArtifact", "listItems", "listScenes", "listForeshadows", "completeStoryTask", "askUserQuestion"]
  if (action.kind === "storyTask" && materialTaskChapterIds(action).length) return [...new Set([...STORY_TASK_TOOL_HINTS[action.task] ?? [], "getChapterContent", "getOutline", "getStoryArtifact", "listItems", "listScenes", "completeStoryTask", "askUserQuestion"])]
  if (action.kind === "storyTask") return [...STORY_TASK_TOOL_HINTS[action.task] ?? [], "completeStoryTask"]
  if (action.kind === "finalize") return ["getChapterFinalizationChecklist", "finalizeChapter"]
  if (action.kind === "review") return ["requestAIReview"]
  if (action.kind === "improve" && action.draw) return ["getChapterContent", "drawChapterCandidates"]
  const readers = { CHAPTER_CONTENT: "getChapterContent", CHAPTER_OUTLINE: "getOutline", VOLUME_OUTLINE: "getOutline" } as const
  const reader = readers[action.targetType as keyof typeof readers], receipts = ACTION_RECEIPT_TOOLS[action.targetType as keyof typeof ACTION_RECEIPT_TOOLS]
  return reader && receipts ? [reader, ...receipts] : []
}

export function hasActionReceipt(action: ChatAction | null | undefined, calls: Array<{ toolName: string; input: unknown; output: unknown }>, hasQuestion: boolean): boolean {
  if (!action) return true
  if (action.kind === "storyTask") {
    if (materialTaskReadiness(action, calls)?.missing.length) return false
    if (action.task === "discuss") return true
    const reconciliation = chapterMaterialReconciliationReads(action, calls)
    if (reconciliation) return hasQuestion || reconciliation.missing.length === 0
    if (action.task === "choose" || action.task === "custom") return hasQuestion
    if (action.task === "prepare-writing") return calls.some(call => call.toolName === "reviewStoryCheckpoint" && (call.input as { key?: string })?.key === action.targetKey && (call.output as { ok?: boolean; checkpoint?: unknown })?.ok === true && !!(call.output as { checkpoint?: unknown }).checkpoint) || hasQuestion && calls.some(call => call.toolName === "getStoryWorkflow" && !!call.output && (call.output as { ok?: boolean }).ok !== false)
    if (action.task === "next-plot") return hasQuestion && calls.some(call => call.toolName === "getNovelPlanning" && (call.output as { ok?: boolean } | null)?.ok !== false)
    if (action.scope?.targetKeys.length && ["improve", "revise"].includes(action.task)) return action.scope.targetKeys.every(targetKey => hasActionReceipt({ ...action, task: "improve", targetKey, scope: undefined }, calls, hasQuestion))
    const kinds: Record<string, string[]> = { world: ["world", "setting", "theme"], character: ["character"], plot: ["worldline", "world-event", "narrative", "narrative-card"], arc: ["character"], outline: ["volume", "chapter-outline"], writing: ["chapter-content"], scene: ["scene"], item: ["item"] }
    return calls.some(call => {
      const out = call.output as { ok?: boolean; committed?: boolean; storyFocus?: { key?: string; kind?: string }; storyWorkflow?: { changedKeys?: string[] }; candidate?: unknown; candidateId?: string } | null
      if (!out || out.ok === false || !WRITE_TOOL_NAMES.has(call.toolName)) return false
      const input = call.input as Record<string, unknown> | null
      if (action.task === "plot") return call.toolName === "proposeNovelPlanning" && out.ok === true
      // 规划类目标（世界线/叙事线）的改进与修订同样经提案写入
      if (["improve", "revise"].includes(action.task) && action.targetKey && ["worldline", "world-event", "narrative", "narrative-card"].some(kind => action.targetKey!.startsWith(`${kind}:`))) {
        return call.toolName === "proposeNovelPlanning" && out.ok === true
      }
      if (action.task === "arc") {
        const result = out as typeof out & { mode?: string; changedStageIds?: string[] }
        return call.toolName === "generateCharacterArc" && (!action.targetKey || out.storyFocus?.key === action.targetKey)
          && (!action.scope?.arcMode || result.mode === action.scope.arcMode)
          && (!action.scope?.stageIds?.length || action.scope.stageIds.every(id => result.changedStageIds?.includes(id)))
      }
      if (action.task === "outline" && action.scope) {
        // 卷章由叙事线投影管理：提案（作者面板采用）或单章细纲修订均为有效回执
        if (!["proposeNovelPlanning", "updateChapterOutline"].includes(call.toolName)) return false
        if (call.toolName === "updateChapterOutline" && !(typeof input?.outline === "string" && input.outline.trim())) return false
        return true
      }
      if (action.task === "world" && action.scope?.category && (call.toolName !== "upsertSetting" || input?.type !== action.scope.category)) return false
      if (action.task === "world" && action.scope?.worldKey && input?.worldId !== action.scope.worldKey.split(":")[1]) return false
      if (action.task === "writing" && call.toolName === "drawChapterCandidates") {
        const chapterId = action.targetKey?.replace(/^chapter-(?:outline|content):/, "")
        const draw = (out as typeof out & { draw?: { chapterId?: string; candidates?: unknown[] } }).draw
        return !!draw && !!draw.candidates?.length && draw.chapterId === input?.chapterId && (!chapterId || draw.chapterId === chapterId)
      }
      if (["improve", "revise"].includes(action.task)) {
        if (!action.targetKey || ["getStoryArtifact", "reviewStoryCheckpoint", "completeStoryTask", "requestStoryApproval"].includes(call.toolName)) return false
        // 子对象的焦点是其自身；服务端指纹差异回执才记录所属容器的实际变化。
        return out.storyFocus?.key === action.targetKey || (out.committed !== false && out.storyWorkflow?.changedKeys?.includes(action.targetKey) === true)
      }
      const expected = action.task === "writing" ? action.targetKey?.replace("chapter-outline:", "chapter-content:") : action.targetKey
      return !!out.storyFocus && (!expected || out.storyFocus.key === expected) && (kinds[action.task] ?? []).includes(out.storyFocus.kind ?? "") && !["getStoryArtifact", "reviewStoryCheckpoint", "completeStoryTask", "requestStoryApproval"].includes(call.toolName)
    })
  }
  if (action.kind === "review") return true
  if (action.kind === "question") return hasQuestion
  if (action.kind === "finalize") return calls.some(call => call.toolName === "finalizeChapter" && (call.input as { chapterId?: string })?.chapterId === action.targetId && (call.output as { ok?: boolean })?.ok === true)
  // 改进对话框抽卡回合：回执 = drawChapterCandidates 成功且产出 draw 结果、章节匹配
  if (action.kind === "improve" && action.draw) {
    return calls.some(call => call.toolName === "drawChapterCandidates"
      && (call.input as { chapterId?: unknown } | null)?.chapterId === action.targetId
      && !!call.output && typeof call.output === "object"
      && !("ok" in call.output && (call.output as { ok?: boolean }).ok === false)
      && !!(call.output as { draw?: unknown }).draw)
  }
  const names: ReadonlySet<string> = new Set(ACTION_RECEIPT_TOOLS[action.targetType])
  return calls.some(call => {
    if (!names.has(call.toolName) || !call.output || typeof call.output !== "object" || ("ok" in call.output && call.output.ok === false)) return false
    const input = call.input as Record<string, unknown> | null
    return [input?.chapterId, input?.targetId, input?.volumeId].includes(action.targetId)
  })
}
