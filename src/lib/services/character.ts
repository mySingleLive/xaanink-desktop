import type { Character, CharacterRoleType, Prisma } from "@/generated/prisma/client"
import { prisma } from "@/lib/db"
import { normalizeArcStages } from "@/lib/arc-stage"
import { triggerCascade } from "@/lib/services/cascade"
import { ContentError } from "@/lib/content-errors"

/** 变更描述中单字段值的最大长度，超出截断 */
const CHANGE_FIELD_MAX = 500

function truncate(value: string): string {
  return value.length > CHANGE_FIELD_MAX ? `${value.slice(0, CHANGE_FIELD_MAX)}…（截断）` : value
}

/** 字符串字段标签（顺序即变更描述与字段清单的顺序，按六大板块归组） */
export const CHARACTER_FIELD_LABELS = [
  // 身份
  ["姓名", "name"],
  ["角色类型", "roleType"],
  ["年龄", "age"],
  ["性别", "gender"],
  ["职业", "occupation"],
  ["角色简介", "bio"],
  ["人物描述", "personality"],
  // 外在
  ["外貌", "appearance"],
  ["身高", "height"],
  ["体重", "weight"],
  ["身材", "build"],
  ["脸型", "faceShape"],
  ["穿衣风格", "clothing"],
  ["品味偏好", "tastes"],
  ["行为习惯", "habits"],
  ["口头禅", "catchphrase"],
  ["对话风格", "dialogueStyle"],
  ["示例对话", "sampleDialogue"],
  // 心理
  ["核心欲望", "desires"],
  ["核心恐惧", "fears"],
  // 能力
  ["能力", "abilities"],
  // 弧线
  ["出场前经历", "backstory"],
  ["成长弧线", "growthArc"],
] as const

/** Json 字段标签（用 JSON.stringify 比较与展示） */
export const CHARACTER_JSON_FIELD_LABELS = [
  ["别名", "aliases"],
  ["性格标签", "personalityTags"],
  ["核心动机", "motivations"],
  ["观念", "beliefs"],
  ["性格五维", "bigFive"],
  ["人物关系", "relationships"],
  ["阶段弧线", "arcStages"],
] as const

/** 构造角色变更描述：逐字段列出「旧值 → 新值」 */
export function buildCharacterChangeDescription(before: Character, after: Character): string {
  const diffs: string[] = []
  for (const [label, key] of CHARACTER_FIELD_LABELS) {
    if (before[key] !== after[key]) {
      diffs.push(`- ${label}：「${truncate(before[key])}」→「${truncate(after[key])}」`)
    }
  }
  for (const [label, key] of CHARACTER_JSON_FIELD_LABELS) {
    const oldJson = JSON.stringify(before[key] ?? null)
    const newJson = JSON.stringify(after[key] ?? null)
    if (oldJson !== newJson) {
      diffs.push(`- ${label}：「${truncate(oldJson)}」→「${truncate(newJson)}」`)
    }
  }
  return [
    `角色「${after.name}」的资料已从 v${before.version} 更新到 v${after.version}，变更如下：`,
    ...diffs,
  ].join("\n")
}

export interface CharacterInput {
  name: string
  roleType: CharacterRoleType
  age: string
  gender: string
  occupation: string
  /** 角色简介：一句话概括角色的个人故事线 */
  bio: string
  personality: string
  /** 别名/外号字符串数组：["老陈", "沉默的大多数"]；不传则不更新 */
  aliases?: Prisma.InputJsonValue
  /** 性格标签字符串数组：["内向", "护短"]；不传则不更新 */
  personalityTags?: Prisma.InputJsonValue
  appearance: string
  height: string
  weight: string
  build: string
  faceShape: string
  clothing: string
  tastes: string
  habits: string
  catchphrase: string
  dialogueStyle: string
  sampleDialogue: string
  /** 核心动机层数组：[{ items: [{ text, importance }] }]；不传则不更新 */
  motivations?: Prisma.InputJsonValue
  desires: string
  fears: string
  /** 观念：{ worldview?, values?, outlook?, other? }；不传则不更新 */
  beliefs?: Prisma.InputJsonValue
  /** Big Five 五维：{ openness, conscientiousness, extraversion, agreeableness, neuroticism } 各 0~100；不传则不更新；传 Prisma.DbNull 表示清除（回到未评估） */
  bigFive?: Prisma.InputJsonValue | typeof Prisma.DbNull
  abilities: string
  backstory: string
  growthArc: string
  /** 阶段弧线卡片链（ArcStage[]，数组顺序=时间先后；服务层落库前经 normalizeArcStages 规整）；不传则不更新 */
  arcStages?: Prisma.InputJsonValue
  /** 人物关系条目数组：[{ target: "对象", description: "关系描述", characterId?: "角色id" }] */
  relationships: Prisma.InputJsonValue
  /** 自定义属性值条目：[{ definitionId: "属性定义id", value: "值" }]；不传则不更新 */
  attributes?: Prisma.InputJsonValue
}

export async function listCharacters(novelId: string, roleType?: CharacterRoleType) {
  return prisma.character.findMany({
    where: { novelId, ...(roleType ? { roleType } : {}) },
    orderBy: [{ roleType: "asc" }, { createdAt: "asc" }],
  })
}

export async function getCharacter(id: string) {
  return prisma.character.findUnique({ where: { id } })
}

export async function createCharacter(novelId: string, data: CharacterInput) {
  return prisma.character.create({
    data: {
      novelId,
      ...data,
      // 阶段卡片链落库前规整：非法项丢弃、isDebut 排他（AI 草稿/工具产出乱结构不阻断）
      ...(data.arcStages !== undefined
        ? { arcStages: normalizeArcStages(data.arcStages) as unknown as Prisma.InputJsonValue }
        : {}),
      extra: {},
    },
  })
}

/**
 * 更新角色：version+1 并写入 ContentVersion 快照（reason="角色更新"）。
 * 字段有实际变更且该小说已有大纲时，提交后触发级联修订（CascadeJob），
 * 返回值附带新 job（未触发则为 null）；级联失败不影响主更新。
 */
export async function updateCharacter(id: string, data: Partial<CharacterInput>, expectedVersion?: number, options?: { cascade?: boolean; validate?: (tx: Prisma.TransactionClient) => Promise<void> }) {
  const existing = await prisma.character.findUnique({ where: { id } })
  if (!existing) {
    throw new Error("角色不存在")
  }

  if (expectedVersion !== undefined && expectedVersion !== existing.version) throw new ContentError("VERSION_CONFLICT", "角色已被更新，当前草稿已保留，请核对最新内容")
  const commit = () => prisma.$transaction(async tx => {
    await options?.validate?.(tx)
    const changed = await tx.character.updateMany({
      where: { id, version: expectedVersion ?? existing.version },
      data: {
        ...data,
        ...(data.arcStages !== undefined
          ? { arcStages: normalizeArcStages(data.arcStages) as unknown as Prisma.InputJsonValue }
          : {}),
        version: { increment: 1 },
      },
    })
    if (!changed.count) throw new ContentError("VERSION_CONFLICT", "角色已被更新，请读取新版本后修改")
    const after = await tx.character.findUniqueOrThrow({ where: { id } })
    for (const row of [existing, after]) {
      const prior = await tx.contentVersion.findFirst({ where: { targetType: "Character", targetId: id, version: row.version } })
      if (!prior) await tx.contentVersion.create({ data: { targetType: "Character", targetId: id, version: row.version, snapshot: JSON.parse(JSON.stringify(row)), reason: row.version === existing.version ? "修改前角色" : "角色更新" } })
    }
    return after
  }, options?.validate ? { isolationLevel: "Serializable" } : undefined)

  // 可串行化来源校验可能与并发写入冲突；只重试尚未提交的事务，不重跑生成。
  let character: Character
  for (let attempt = 0; ; attempt++) {
    try { character = await commit(); break }
    catch (error) {
      if (!options?.validate || attempt >= 2 || !error || typeof error !== "object" || !("code" in error) || error.code !== "P2034") throw error
    }
  }
  // 主更新已提交，再触发级联修订；无实际变更时不触发
  const changed =
    CHARACTER_FIELD_LABELS.some(([, key]) => character[key] !== existing[key]) ||
    CHARACTER_JSON_FIELD_LABELS.some(
      ([, key]) => JSON.stringify(character[key] ?? null) !== JSON.stringify(existing[key] ?? null)
    )
  // 三阶段保存的对话流水线传 cascade:false：级联改由流水线问答门控后单独触发
  const cascadeJob = changed && options?.cascade !== false
    ? await triggerCascade({
        novelId: character.novelId,
        triggerType: "CHARACTER",
        triggerId: character.id,
        changeDescription: buildCharacterChangeDescription(existing, character),
      })
    : null

  return { character, cascadeJob }
}

export async function deleteCharacter(id: string) {
  return prisma.character.delete({ where: { id } })
}
