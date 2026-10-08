import { randomUUID } from "node:crypto"
import { z } from "zod"
import { prisma } from "@/lib/db"
import { ContentError } from "@/lib/content-errors"
import { arcStageSchema, normalizeArcStages, PROFILE_FIELD_SECTIONS } from "@/lib/arc-stage"
import { generateJSON, StructuredGenerationError } from "@/lib/ai/generate"
import { renderCharacter } from "@/lib/ai/context"
import { updateCharacter } from "./character"
import { readStoryArtifacts, type StoryScope } from "./story-artifacts"

export const generateCharacterArcSchema = z.object({
  characterId: z.string().min(1).describe("getCharacter 返回的角色 id"), expectedVersion: z.number().int().positive().describe("必须先 getCharacter，使用该角色的 version；不是 getStoryWorkflow.version"),
  sourceKeys: z.array(z.string().min(3)).max(12).default([]).describe("getStoryWorkflow.artifacts 中真实剧情 key，如 narrative:实际ID；不能传标题或裸ID。没有剧情时传空数组"),
  mode: z.enum(["create", "append", "replace"]).optional(),
  stageIds: z.array(z.string().min(1)).min(1).max(50).optional(),
  brief: z.string().max(2000).default(""),
})
const generatedSchema = z.object({ stages: z.array(arcStageSchema.extend({
  pressure: z.string().min(1).max(300), choice: z.string().min(1).max(300), cost: z.string().min(1).max(300),
})).min(1).max(50) })

export async function generateCharacterArc(scope: StoryScope, input: z.infer<typeof generateCharacterArcSchema>, deps = { generate: generateJSON }) {
  const graph = await readStoryArtifacts(scope)
  const character = await prisma.character.findFirst({ where: { id: input.characterId, novelId: scope.novelId } })
  if (!character) throw new ContentError("CHARACTER_NOT_FOUND", "角色不存在或不属于本书", 404)
  if (character.version !== input.expectedVersion) throw new ContentError("VERSION_CONFLICT", "角色已变化，请读取当前版本")
  const existing = normalizeArcStages(character.arcStages)
  const mode = input.mode ?? (existing.length ? "replace" : "create")
  if (mode === "create" && existing.length || mode === "replace" && !existing.length || mode === "append" && (!existing.length || !!input.stageIds?.length)) throw new ContentError("ARC_SCOPE_REQUIRED", "弧线设计方式与当前阶段不一致，请重新选择", 409)
  if (mode === "replace" && (!input.stageIds?.length || input.stageIds.some(id => !existing.some(s => s.id === id)))) throw new ContentError("ARC_SCOPE_REQUIRED", "已有弧线，请指定要调整的阶段；其他阶段保留", 409)
  if (!existing.length && input.stageIds?.length) throw new ContentError("ARC_SCOPE_REQUIRED", "初次生成不能指定不存在的阶段", 400)
  const sources = [...new Set(input.sourceKeys)].map(key => {
    const source = graph.artifacts.find(a => a.key === key && ["narrative", "narrative-card", "chapter-outline"].includes(a.kind))
    if (!source) throw new ContentError("STORY_SOURCE_NOT_FOUND", "剧情来源不存在或不属于本书", 404)
    return source
  })
  const chapters = graph.volumes.flatMap(v => v.chapters)
  const result = await deps.generate({ ...scope, action: "character.arc", schema: generatedSchema,
    prompt: `为角色设计因果连贯的弧线。${mode === "append" ? "追加1至5个后续阶段，衔接已有末尾阶段，不重复已有事件；id使用临时名称，isDebut全部false。" : existing.length ? `仅修改这些阶段，保留各自id与出场标记：${JSON.stringify(input.stageIds)}` : "创建3至5个阶段，从出场状态、冲突升级、选择到代价与变化；id用临时名称，仅第一张isDebut=true。"}
每阶段必须有事件markers、pressure压力、choice主动选择、cost代价、description变化原因，以及changes中的真实属性变化。不要改无关角色资料。无剧情来源时，事件必须明确标注“建议事件”，不能冒充已发生。startChapter只能引用下列实际章节，尚未定位用null。sources由服务端记录，不自行编造hash。
保持简洁：name、markers每条text最多50字；每阶段1至3条changes，description约100字，pressure/choice/cost各不超过100字。优先用psyche.fears、psyche.desires、identity.personality等文本字段表达变化，value必须是字符串。section和field必须分别填写，不能把psyche.fears整个写进field。
如确需复杂属性，value类型必须如下：tags用字符串数组；beliefs用{"worldview":"世界观","values":"价值观","outlook":"人生观","other":"其他"}；motivations用[{"items":[{"text":"动机","importance":3}]}]；bigfive用{"openness":50,"conscientiousness":50,"extraversion":50,"agreeableness":50,"neuroticism":50}；relationships用[{"target":"姓名","description":"关系","characterId":null}]。不要将上述对象或数组写成字符串。attributes只引用已有definitionId，不编造属性定义。
角色资料：${renderCharacter(character)}
作者要求：${input.brief}
剧情来源：${JSON.stringify(sources.map(s => ({ key: s.key, text: s.text })))}
章节定位：${JSON.stringify(chapters.map(c => ({ chapterId: c.id, volumeId: c.volumeId, label: c.title })))}
changes字段词表（section取板块key、field取属性key、value遵循kind；text/textarea用字符串，tags用字符串数组）：${JSON.stringify(PROFILE_FIELD_SECTIONS.map(section => ({ section: section.key, fields: section.fields.map(field => ({ field: field.key, kind: field.kind })) })))}
严格返回如下JSON形状，stages数量按上文要求；不要用before/after字段替代value：
{"stages":[{"id":"stage-1","name":"阶段名","markers":[{"kind":"event","text":"触发事件"}],"startChapter":null,"changes":[{"section":"psyche","field":"fears","value":"此阶段的恐惧"}],"description":"变化原因","tags":[],"isDebut":true,"pressure":"压力","choice":"选择","cost":"代价"}]}。`,
  }).catch(error => {
    if (error instanceof StructuredGenerationError) throw new ContentError("ARC_GENERATION_FORMAT", `弧线生成格式未通过校验，原稿保留。${error.message}。${error.feedback.join("；")}`, 422)
    throw error
  })
  const generated = generatedSchema.parse(result.data).stages
  if (!existing.length && (generated.length < 3 || generated.length > 5)) throw new ContentError("ARC_INVALID_STAGES", "初次弧线应有3至5个阶段", 422)
  if (mode === "append" && generated.length > 5) throw new ContentError("ARC_INVALID_STAGES", "一次追加不超过5个阶段", 422)
  if (mode === "replace" && (generated.length !== input.stageIds!.length || new Set(generated.map(s => s.id)).size !== generated.length || generated.some(s => !input.stageIds!.includes(s.id)))) throw new ContentError("ARC_INVALID_STAGES", "生成范围与指定阶段不一致，原稿保留", 422)
  const replacements = generated.map((stage, index) => {
    if (!stage.markers.some(m => m.kind === "event") || !stage.changes.length) throw new ContentError("ARC_INVALID_STAGES", "每个阶段必须包含事件与属性变化", 422)
    if (stage.startChapter && !chapters.some(c => c.id === stage.startChapter!.chapterId && c.volumeId === stage.startChapter!.volumeId)) throw new ContentError("ARC_INVALID_CHAPTER", "阶段引用了无效章节", 422)
    const { pressure, choice, cost, ...fields } = stage
    return { ...fields, id: mode === "replace" ? stage.id : randomUUID(), isDebut: mode === "replace" ? existing.find(s => s.id === stage.id)!.isDebut : mode === "create" && index === 0,
      // 预留三项因果说明的空间，不能让长简介把最后的选择与代价截掉。
      description: `${sources.length ? "" : "建议事件；待剧情确认。\n"}${stage.description.slice(0, 1000)}\n压力：${pressure}\n选择：${choice}\n代价：${cost}`,
      sources: sources.map(s => ({ key: s.key, hash: s.hash })),
    }
  })
  const fresh = await readStoryArtifacts(scope)
  if (sources.some(s => fresh.artifacts.find(a => a.key === s.key)?.hash !== s.hash)) throw new ContentError("VERSION_CONFLICT", "剧情来源已变化，生成结果不覆盖原稿")
  const stages = mode === "append" ? [...existing, ...replacements] : existing.length ? existing.map(stage => replacements.find(s => s.id === stage.id) ?? stage) : replacements
  const saved = await updateCharacter(character.id, { arcStages: JSON.parse(JSON.stringify(stages)) }, input.expectedVersion, { cascade: false, validate: async tx => {
    const current = await readStoryArtifacts(scope, tx)
    if (sources.some(s => current.artifacts.find(a => a.key === s.key)?.hash !== s.hash)) throw new ContentError("VERSION_CONFLICT", "剧情来源已变化，原稿保留")
  } })
  return { ok: true, characterId: character.id, version: saved.character.version, changedStageIds: replacements.map(s => s.id), mode, stageCount: stages.length, storyFocus: { key: `character:${character.id}`, kind: "character", id: character.id, title: character.name } }
}
