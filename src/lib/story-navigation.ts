import { normalizeArcStages } from "./arc-stage"
import { normalizeAliases } from "./aliases"
import type { StoryArtifact, StoryEdge } from "./story-workflow"
import { MAX_STORY_TASK_CHOICES, STORY_TASK_LABELS, type NavigationEntity, type StoryTaskNavigation, type TaskScope } from "./story-task"
import { materialHasContent, type StoryMaterial } from "./story-materials"
import { CHAPTER_MATERIAL_RECONCILIATION_LABEL, CHAPTER_MATERIAL_RECONCILIATION_DESCRIPTION } from "./chapter-material-reconciliation"

export function artifactFields(artifact: StoryArtifact): Record<string, unknown> {
  try { const value: unknown = JSON.parse(artifact.text); return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {} } catch { return {} }
}

/** 叙事线产物 JSON 中的卡片形态（story-artifacts 注入 { line, cards }） */
interface NarrativeCardFields { id: string; parent: string | null; title?: string; narrateSummary?: boolean; chapter?: string | null; order?: number }

/** 叙事线产物中的卡片数组（缺数据时为空数组） */
export function narrativeCardsOf(artifact: StoryArtifact): NarrativeCardFields[] {
  const cards = artifactFields(artifact).cards
  if (!Array.isArray(cards)) return []
  return cards.filter((c): c is NarrativeCardFields => !!c && typeof c === "object" && typeof (c as { id?: unknown }).id === "string")
}

/** 实际讲述卡片：narrateSummary 或叶子（与 planning/domain.ts readingCards 同口径）。有主线实际讲述卡片 = 有剧情构思。 */
export function tellingCardsOf(cards: NarrativeCardFields[]): NarrativeCardFields[] {
  return cards.filter(c => c.narrateSummary || !cards.some(o => o.parent === c.id))
}

/** 卡片是否已分章（自身或祖先挂 chapter；与 planning/domain.ts cardChapter 同口径） */
function cardAssigned(cards: NarrativeCardFields[], card: NarrativeCardFields): boolean {
  const seen = new Set<string>()
  let current: NarrativeCardFields | undefined = card
  while (current) {
    if (seen.has(current.id)) return false
    seen.add(current.id)
    if (current.chapter) return true
    current = cards.find(c => c.id === current!.parent)
  }
  return false
}

/** 按叙事顺序（父子层级 DFS、同级按 order）排好的实际讲述卡片 */
function orderedTellingCards(cards: NarrativeCardFields[]): NarrativeCardFields[] {
  const seen = new Set<string>()
  const walk = (parent: string | null): NarrativeCardFields[] =>
    cards.filter(c => c.parent === parent)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id))
      .flatMap(c => seen.has(c.id) ? [] : (seen.add(c.id), [c, ...walk(c.id)]))
  const ordered = walk(null)
  return ordered.filter(c => c.narrateSummary || !cards.some(o => o.parent === c.id))
}

export function navigationEntities(artifacts: StoryArtifact[], _edges: StoryEdge[] = []): NavigationEntity[] {
  return artifacts.filter(a => a.kind !== "chapter-content" || a.text.trim()).map(a => ({
    key: a.key, title: a.title, kind: a.kind, hash: a.hash, worldId: a.worldId,
    ...(a.kind === "narrative" ? { primary: (artifactFields(a).line as { primary?: boolean } | undefined)?.primary === true, tellingCardCount: tellingCardsOf(narrativeCardsOf(a)).length } : {}),
    ...(a.kind === "character" ? { stages: normalizeArcStages(artifactFields(a).arcStages).map(s => ({ id: s.id, name: s.name })) } : {}),
  }))
}
export function existingCharacterNames(artifacts: StoryArtifact[]) {
  return new Set(artifacts.filter(a => a.kind === "character").flatMap(a => [a.title, ...normalizeAliases(artifactFields(a).aliases)]).map(s => s.trim().normalize("NFKC")))
}
export type NavigationSuggestion = { task: "character" | "plot" | "world"; scopeLabel: string; names?: string[]; sourceKey: string; quote: string }
/** 显示ID无需承担授权：原选择和完整范围仍由服务端快照/证据校验。 */
function boundedChoiceId(task: string, value: string) {
  if (value.length <= 300) return value
  let first = 0x811c9dc5, second = 0x9e3779b9
  for (let i = 0; i < value.length; i++) {
    first = Math.imul(first ^ value.charCodeAt(i), 0x01000193)
    second = Math.imul(second ^ value.charCodeAt(i), 0x85ebca6b)
  }
  return `${task}:${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`
}
/** Suggestions are evidence for clarification, never sufficient authorization to invent missing entities. */
export function navigationRecommendations(input: {
  artifacts: StoryArtifact[]; edges: StoryEdge[]; focusKeys: string[]; ready: boolean; accept: boolean; words: number;
  suggestions?: NavigationSuggestion[]; writingReadyKeys?: Set<string>; maxChoices?: number;
}): StoryTaskNavigation["choices"] {
  const { artifacts, edges, focusKeys } = input
  const focus = artifacts.find(a => a.key === focusKeys[0])
  const scope = (extra: Partial<TaskScope>): TaskScope => ({ targetKeys: [], sourceKeys: [], ...extra })
  const choices: StoryTaskNavigation["choices"] = []
  let reconciliationId: string | undefined
  function add(task: StoryTaskNavigation["choices"][number]["task"], label: string, description: string, taskScope: TaskScope, targetKey?: string, accept = input.accept) {
    const id = boundedChoiceId(task, `${task}:${targetKey ?? taskScope.sourceKeys.join(",") ?? "current"}:${taskScope.anchorKey ?? ""}${taskScope.category ? `:${taskScope.category}` : ""}${task === "custom" ? `:${label}` : ""}`)
    choices.push({ id, task, label: `${accept ? "认可并" : ""}${label}`, description, accept, scope: taskScope, ...(targetKey ? { targetKey } : {}), ...(task === "writing" ? { wordCount: input.words } : {}) })
  }
  // An explicit but unverified textual gap asks for clarification, not creation.
  for (const suggestion of input.suggestions ?? []) {
    const source = artifacts.find(a => a.key === suggestion.sourceKey)
    if (!source || !suggestion.quote.trim() || !source.text.includes(suggestion.quote)) continue
    const names = suggestion.names?.filter(n => !existingCharacterNames(artifacts).has(n.trim().normalize("NFKC"))) ?? []
    if (suggestion.task === "character" && !names.length) continue
    const label = suggestion.task === "character" ? `核对角色需求（${names.join("、")}）` : `确认${suggestion.scopeLabel}`
    choices.push({ id: `clarify:${suggestion.task}:${suggestion.sourceKey}:${label}`, label: label.slice(0, 200), description: "根据关联内容提出，先确认具体身份与范围，再开始创作。", task: "custom", accept: false, scope: scope({ sourceKeys: [source.key], intendedNames: names }) })
  }
  const worldlines = artifacts.filter(a => a.kind === "worldline")
  const narratives = artifacts.filter(a => a.kind === "narrative")
  const primary = narratives.find(a => (artifactFields(a).line as { primary?: boolean } | undefined)?.primary === true)
  const primaryTelling = primary ? orderedTellingCards(narrativeCardsOf(primary)) : []
  const assignedKeys = new Set(edges.filter(e => primaryTelling.some(c => e.sourceKey === `narrative-card:${c.id}`)).map(e => e.targetKey))
  // 修订世界线/叙事线后，已有卷章应继续写作准备，不把未写正文的故事引向下一卷。
  const pendingAssignedVolume = focus && ["worldline", "narrative"].includes(focus.kind)
    && primaryTelling.length && primaryTelling.every(c => cardAssigned(narrativeCardsOf(primary!), c))
    ? artifacts.find(v => v.kind === "volume" && edges.some(e => e.sourceKey === v.key && assignedKeys.has(e.targetKey)
      && artifacts.some(a => a.key === e.targetKey && a.kind === "chapter-outline" && a.text.trim()
        && !artifacts.find(content => content.key === `chapter-content:${a.id}`)?.text.trim()))) : undefined
  // A completed volume opens writing of its next unwritten chapter.
  const volumes = artifacts.filter(a => a.kind === "volume")
  const formalFocus = focusKeys.some(key => artifacts.some(a => a.key === key && ["volume", "chapter-outline", "chapter-content"].includes(a.kind)))
  const unwrittenChapters = artifacts.filter(a => a.kind === "chapter-outline"
    && !artifacts.find(content => content.key === `chapter-content:${a.id}`)?.text.trim())
    .sort((a, b) => (a.chapterIndex ?? 0) - (b.chapterIndex ?? 0) || a.id.localeCompare(b.id))
  const pendingChapter = input.ready && !formalFocus
    ? unwrittenChapters.find(a => a.text.trim()) : undefined
  // 章正文完成（focus=chapter-content:X）同样要能带出下一章抽卡：经 chapter-content:X → chapter-outline:X → 卷归属解析焦点卷。
  const focusedChapterOutlines = focusKeys.filter(key => key.startsWith("chapter-content:")).map(key => `chapter-outline:${key.slice("chapter-content:".length)}`)
  const focusedVolume = volumes.find(v => focusKeys.includes(v.key))
    ?? volumes.find(v => edges.some(e => e.sourceKey === v.key && focusKeys.includes(e.targetKey) && artifacts.some(a => a.key === e.targetKey && ["chapter-outline", "chapter-content"].includes(a.kind))))
    ?? volumes.find(v => focusedChapterOutlines.length && edges.some(e => e.sourceKey === v.key && focusedChapterOutlines.includes(e.targetKey)))
    ?? pendingAssignedVolume
    ?? (pendingChapter ? volumes.find(v => edges.some(e => e.sourceKey === v.key && e.targetKey === pendingChapter.key)) : undefined)
  if (focusedVolume) {
    const chapterKeys = new Set(edges.filter(e => e.sourceKey === focusedVolume.key).map(e => e.targetKey))
    const chapters = artifacts.filter(a => a.kind === "chapter-outline" && chapterKeys.has(a.key)).sort((a, b) => (a.chapterIndex ?? 0) - (b.chapterIndex ?? 0))
    const unwritten = (a: StoryArtifact) => !artifacts.find(c => c.key === `chapter-content:${a.id}`)?.text.trim()
    const next = chapters.find(a => focusKeys.includes(a.key) && unwritten(a))
      ?? (pendingChapter && chapterKeys.has(pendingChapter.key) ? pendingChapter : chapters.find(unwritten))
    if (next?.text.trim()) {
      const writingReady = input.writingReadyKeys?.has(next.key) ?? (focusKeys.includes(next.key) && input.ready)
      add(writingReady ? "writing" : "prepare-writing", `${writingReady ? "正文抽卡" : "准备正文抽卡"}（${focusedVolume.title} · 从《${next.title}》开始）`,
        writingReady ? `确认本章当前大纲及约${input.words}字的写作范围；先检查本章叙事卡（不足先补卡），本次为《${next.title}》抽 3 份正文候选，选稿采用后按逐章评审与认可流程继续，不自动定稿。` : "先补齐本章叙事卡、关联资料和章纲评审，再请作者正式认可本章当前版本后抽卡。",
        scope({ targetKeys: [next.key], sourceKeys: [focusedVolume.key], volumeKey: focusedVolume.key }), next.key)
      if (!writingReady) { const choice = choices.at(-1)!; choice.accept = false; choice.label = choice.label.replace(/^认可并/u, "") }
    }
  }
  if (!focusedVolume && focus?.kind === "chapter-outline" && focus.text.trim() && input.ready) {
    const content = artifacts.find(a => a.key === `chapter-content:${focus.id}`)
    if (!content?.text.trim()) add("writing", `正文抽卡（${focus.title}，约${input.words}字）`, "先检查本章叙事卡（不足先补卡），按本章当前细纲抽 3 份正文候选，选稿采用，不自动定稿。", scope({ targetKeys: [focus.key], sourceKeys: [focus.key] }), focus.key)
  }
  if (!focusedVolume && pendingChapter) {
    const writingReady = input.writingReadyKeys?.has(pendingChapter.key) ?? false
    add(writingReady ? "writing" : "prepare-writing", `${writingReady ? "正文抽卡" : "准备正文抽卡"}（${pendingChapter.title}，约${input.words}字）`,
      writingReady ? "先检查本章叙事卡和关联资料，按当前章纲抽三份候选，由作者选稿，不自动定稿。" : "先补齐本章叙事卡、关联资料和章纲评审，再请作者认可本章当前版本后抽卡。",
      scope({ targetKeys: [pendingChapter.key], sourceKeys: [pendingChapter.key] }), pendingChapter.key, writingReady && input.accept)
  }
  // 已采用正文可能引入规划外的关键资料；全书已有档案不能替代本章采用后的核对。
  // 只沿显式焦点章纲/正文找该章正式正文，不从全书任意已写章推断。
  const reconciliationContent = focusKeys.map(key => {
    const artifact = artifacts.find(a => a.key === key)
    if (!artifact || !["chapter-outline", "chapter-content"].includes(artifact.kind)) return undefined
    return artifacts.find(a => a.key === `chapter-content:${artifact.id}` && a.kind === "chapter-content" && a.text.trim())
  }).find((artifact): artifact is StoryArtifact => !!artifact)
  if (reconciliationContent) {
    const outline = artifacts.find(a => a.key === `chapter-outline:${reconciliationContent.id}`)
    add("custom", CHAPTER_MATERIAL_RECONCILIATION_LABEL, CHAPTER_MATERIAL_RECONCILIATION_DESCRIPTION,
      scope({ sourceKeys: [reconciliationContent.key, ...(outline ? [outline.key] : [])] }), reconciliationContent.key, false)
    reconciliationId = choices.at(-1)!.id
  }
  // 剧情搭建：世界线 → 叙事线 → 卷章投影
  if (focus?.kind === "character") {
    const fields = artifactFields(focus), stages = normalizeArcStages(fields.arcStages)
    const plotSources = primary && primaryTelling.length ? [primary.key] : artifacts.filter(a => a.kind === "chapter-outline" && a.text.trim()).slice(0, 3).map(a => a.key)
    if (!stages.length && !String(fields.growthArc ?? "").trim() && plotSources.length) add("arc", `设计角色弧线（${focus.title}）`, "角色尚无弧线阶段，结合已有剧情设计变化。", scope({ targetKeys: [focus.key], sourceKeys: plotSources, arcMode: "create" }), focus.key)
    else if (stages.length) {
      const stale = stages.filter(s => s.sources?.some(source => artifacts.find(a => a.key === source.key)?.hash !== source.hash))
      if (stale.length) add("arc", `对齐角色弧线（${focus.title} · ${stale.map(s => s.name).join("、")}）`.slice(0, 180), "这些阶段的剧情来源已变化，仅核对并调整指定阶段。", scope({ targetKeys: [focus.key], sourceKeys: [...new Set(stale.flatMap(s => s.sources?.map(source => source.key) ?? []))].filter(key => artifacts.some(a => a.key === key)), stageIds: stale.map(s => s.id), arcMode: "replace" }), focus.key)
    }
  }
  if (!formalFocus && !pendingChapter) {
    if (!artifacts.some(a => a.kind === "character") && focus && ["theme", "world", "setting"].includes(focus.kind)) {
      add("character", "创建核心角色", "尚无角色档案：按已确认故事建立主角及剧情需要的人物，先核对姓名与身份。", scope({ sourceKeys: focusKeys }))
    }
    if (!worldlines.length) {
      add("plot", "搭建世界线", "尚无世界线：先把客观发生的事件与时间落到世界线，再编排叙事线。", scope({ sourceKeys: focus ? [focus.key] : [] }))
    } else if (!primary) {
      add("plot", "搭建主叙事线", "世界线已有客观事件，尚未指定主叙事线：确定主线并添加实际讲述卡片。", scope({ sourceKeys: worldlines.slice(0, 3).map(a => a.key) }))
    } else if (!primaryTelling.length) {
      add("plot", `补全主叙事线卡片（${primary.title}）`, "主叙事线尚无实际讲述卡片；卡片优先引用既有世界事件。", scope({ sourceKeys: [primary.key] }))
    } else {
      const unassigned = primaryTelling.filter(c => !cardAssigned(narrativeCardsOf(primary!), c))
      if (unassigned.length) add("outline", `整理卷章大纲（${primary.title} · ${unassigned.length} 张卡待分章）`, "主线卡片已就绪：询问每章字数范围后分配卷章与字数。", scope({ sourceKeys: [primary.key] }))
      const last = primaryTelling[primaryTelling.length - 1]
      if (!pendingAssignedVolume && !unwrittenChapters.length) add("next-plot", `推荐后续剧情（${(last.title ?? "").slice(0, 45)}之后）`, "先核对世界线事件与已有卡片，再提供后续方向；由你选择后展开。", scope({ sourceKeys: [primary.key], anchorKey: `narrative-card:${last.id}` }))
    }
  }
  // 当前资料达标后检查作品的已知缺口；仅提供选择，不强制扩写或代批。
  if (input.ready || formalFocus) {
    const usable = (kind: StoryMaterial["kind"], type?: string) => artifacts.some(a => {
      if (a.kind !== kind || type && a.settingType !== type) return false
      const fields = artifactFields(a)
      return fields.dropped !== true && materialHasContent({ kind, id: a.id, title: a.title,
        type: a.settingType as StoryMaterial["type"], content: kind === "setting" || kind === "foreshadow" ? fields.content : kind === "scene" ? fields.description : fields })
    })
    if (!artifacts.some(a => a.kind === "world" && String(artifactFields(a).description ?? "").trim())) {
      add("world", "补充世界观", "尚无世界观：先搭建世界框架（时代、地域与势力基调），再按需细化条目。", scope({ sourceKeys: focusKeys }), undefined, false)
    }
    if (!usable("setting", "STYLE")) {
      add("custom", "补齐文风", "尚无可用文风：结合当前题材简短确定语言、叙述节奏与参考风格。", scope({ sourceKeys: focusKeys }), undefined, false)
    }
    if (!usable("foreshadow")) {
      add("custom", "生成伏笔", "尚无可用伏笔：只登记当前目标需要的线索，并关联首次埋入的世界事件和叙事卡；后续回收可暂留。", scope({ sourceKeys: pendingChapter ? [pendingChapter.key] : focusKeys }), undefined, false)
    }
    if (!usable("item")) {
      add("item", "生成物品", "尚无可用物品：只补当前章节或剧情实际会用到的物品，已有档案先复用。", scope({ sourceKeys: pendingChapter ? [pendingChapter.key] : focusKeys }), undefined, false)
    }
    if (!usable("scene")) {
      add("scene", "生成场景", "尚无可用场景：只补当前章节或剧情涉及的地点、氛围与用途，不展开全书场景。", scope({ sourceKeys: pendingChapter ? [pendingChapter.key] : focusKeys }), undefined, false)
    }
    if (formalFocus && !usable("setting", "GOLD_FINGER")) {
      add("world", "设定金手指", "可按题材需要选择：明确主角的核心能力、代价与限制规则。", scope({ sourceKeys: focusKeys, category: "GOLD_FINGER" }), undefined, false)
    }
  }
  const uniqueChoices = [...new Map(choices.map(c => [c.id, c])).values()]
  // 已采用正文后保留续写和本章核对入口，避免澄清建议占满菜单。
  if (reconciliationId) {
    const priority = (choice: StoryTaskNavigation["choices"][number]) => choice.task === "writing" || choice.task === "prepare-writing" ? 0 : choice.id === reconciliationId ? 1 : 2
    uniqueChoices.sort((a, b) => priority(a) - priority(b))
  }
  return uniqueChoices.slice(0, input.maxChoices ?? MAX_STORY_TASK_CHOICES).map(c => ({ ...c, label: c.label.slice(0, 200) }))
}

export const TASK_TEMPLATES: Record<string, string> = {
  character: "姓名：\n身份：\n性格：\n动机：\n与已有角色的关系：\n在剧情中的作用：\n其他要求：",
  arc: "起点状态：\n关键事件：\n期望转变：\n其他要求：", world: "设定主题：\n需要解决的问题：\n规则与限制：\n其他要求：",
  plot: "世界线范围：\n主叙事线视角与顺序：\n核心冲突：\n预期走向：", scene: "场景名称：\n地点与氛围：\n发生的事件：\n其他要求：",
  item: "物品名称：\n主要用途：\n能力与代价：\n剧情作用：", outline: "期望章节数：\n每章字数范围：\n节奏要求：\n其他要求：",
  custom: "创作目标：\n期望产物：\n范围与要求：", revise: "希望改进：\n需要保留：\n其他要求：",
}
export function meaningfulRequirements(task: string, value: string) {
  const labels = new Set((TASK_TEMPLATES[task] ?? "").split("\n").map(s => s.replace(/[：:]\s*$/, "")))
  return value.split("\n").filter(line => !labels.has(line.trim().replace(/[：:]\s*$/, ""))).join("\n").trim()
}
export const TASK_CATALOG = [
  { task: "character", label: "创建其他角色", group: "人物与设定" }, { task: "arc", label: "设计其他角色弧线", group: "人物与设定" }, { task: "world", label: "补充其他世界设定", group: "人物与设定" },
  { task: "plot", label: "搭建世界线与叙事线", group: "剧情与素材" }, { task: "scene", label: "创建新场景", group: "剧情与素材" }, { task: "item", label: "创建新物品", group: "剧情与素材" },
  { task: "outline", label: "整理正式卷章大纲", group: "整理与自定义" }, { task: "custom", label: STORY_TASK_LABELS.custom, group: "整理与自定义" }, { task: "revise", label: "重新设计已有内容", group: "整理与自定义" },
] as const
