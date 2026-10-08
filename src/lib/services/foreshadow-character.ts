import type { ForeshadowCharacter } from "@/generated/prisma/client"
import { prisma } from "@/lib/db"
import { createCharacter } from "@/lib/services/character"

/** 伏笔角色不存在或不属于该小说 */
export class ForeshadowCharacterNotFoundError extends Error {
  constructor(message = "伏笔角色不存在") {
    super(message)
    this.name = "ForeshadowCharacterNotFoundError"
  }
}

/** 已揭示/转正过的伏笔角色不能重复转正 */
export class ForeshadowCharacterRevealedError extends Error {
  constructor(message = "该伏笔角色已关联正式角色，不能重复转正") {
    super(message)
    this.name = "ForeshadowCharacterRevealedError"
  }
}

export interface ForeshadowCharacterDTO {
  id: string
  novelId: string
  name: string
  note: string
  avatarUrl: string | null
  revealedCharacterId: string | null
  createdAt: string
  updatedAt: string
}

function toDTO(row: ForeshadowCharacter): ForeshadowCharacterDTO {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** 小说的伏笔角色列表（按创建时间升序） */
export async function listForeshadowCharacters(novelId: string): Promise<ForeshadowCharacterDTO[]> {
  const rows = await prisma.foreshadowCharacter.findMany({
    where: { novelId },
    orderBy: { createdAt: "asc" },
  })
  return rows.map(toDTO)
}

/** 按 id 取伏笔角色（路由做归属校验用） */
export async function getForeshadowCharacter(id: string): Promise<ForeshadowCharacterDTO | null> {
  const row = await prisma.foreshadowCharacter.findUnique({ where: { id } })
  return row ? toDTO(row) : null
}

export async function createForeshadowCharacter(
  novelId: string,
  data: { name: string; note?: string }
): Promise<ForeshadowCharacterDTO> {
  const row = await prisma.foreshadowCharacter.create({
    data: { novelId, name: data.name, note: data.note ?? "" },
  })
  return toDTO(row)
}

export async function updateForeshadowCharacter(
  id: string,
  data: { name?: string; note?: string }
): Promise<ForeshadowCharacterDTO> {
  const existing = await prisma.foreshadowCharacter.findUnique({ where: { id } })
  if (!existing) throw new ForeshadowCharacterNotFoundError()

  const row = await prisma.foreshadowCharacter.update({
    where: { id },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.note !== undefined ? { note: data.note } : {}),
    },
  })
  return toDTO(row)
}

/** 删除伏笔角色（故事板退役后无其他标量引用需要级联清理） */
export async function deleteForeshadowCharacter(id: string): Promise<void> {
  const existing = await prisma.foreshadowCharacter.findUnique({ where: { id } })
  if (!existing) throw new ForeshadowCharacterNotFoundError()
  await prisma.foreshadowCharacter.delete({ where: { id } })
}

/**
 * 揭示为某个已存在的正式角色：回填 revealedCharacterId，
 * 之后引用该伏笔角色的地方经此归属到正式角色。
 */
export async function revealForeshadowCharacter(
  id: string,
  characterId: string
): Promise<ForeshadowCharacterDTO> {
  const existing = await prisma.foreshadowCharacter.findUnique({ where: { id } })
  if (!existing) throw new ForeshadowCharacterNotFoundError()

  const character = await prisma.character.findUnique({ where: { id: characterId } })
  if (!character || character.novelId !== existing.novelId) {
    throw new Error("正式角色不存在")
  }

  const row = await prisma.foreshadowCharacter.update({
    where: { id },
    data: { revealedCharacterId: characterId },
  })
  return toDTO(row)
}

/**
 * 转为正式角色：由 name 建正式 Character（roleType=SUPPORTING，其余文本字段按契约定为空串，
 * relationships/extra 走 schema 惯例 []/{ }），随后 revealedCharacterId 回填。
 * note 保留在伏笔角色自身记录里，不回填到正式角色字段（契约 §2 的字段清单不含它）。
 */
export async function promoteForeshadowCharacter(id: string) {
  const existing = await prisma.foreshadowCharacter.findUnique({ where: { id } })
  if (!existing) throw new ForeshadowCharacterNotFoundError()
  if (existing.revealedCharacterId) throw new ForeshadowCharacterRevealedError()

  const character = await createCharacter(existing.novelId, {
    name: existing.name,
    roleType: "SUPPORTING",
    age: "",
    gender: "",
    occupation: "",
    bio: "",
    personality: "",
    appearance: "",
    height: "",
    weight: "",
    build: "",
    faceShape: "",
    clothing: "",
    tastes: "",
    habits: "",
    catchphrase: "",
    dialogueStyle: "",
    sampleDialogue: "",
    desires: "",
    fears: "",
    abilities: "",
    backstory: "",
    growthArc: "",
    relationships: [],
  })

  const row = await prisma.foreshadowCharacter.update({
    where: { id },
    data: { revealedCharacterId: character.id },
  })
  return { foreshadowCharacter: toDTO(row), character }
}
