import { NextResponse } from "next/server"
import { z } from "zod"
import { ContentError } from "@/lib/content-errors"

import { Prisma } from "@/generated/prisma/client"
import {
  deleteCharacter,
  getCharacter,
  updateCharacter,
} from "@/lib/services/character"

import { firstIssueMessage, getOwnedNovel } from "../../lib"
import { patchCharacterSchema } from "../character-schema"

type RouteContext = { params: Promise<{ id: string; characterId: string }> }

async function getOwnedCharacter(characterId: string, novelId: string) {
  const character = await getCharacter(characterId)
  if (!character || character.novelId !== novelId) return null
  return character
}

export async function PATCH(request: Request, ctx: RouteContext) {
  const { id, characterId } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const existing = await getOwnedCharacter(characterId, id)
  if (!existing) {
    return NextResponse.json({ error: "角色不存在" }, { status: 404 })
  }

  const body = await request.json().catch(() => null)
  const parsed = patchCharacterSchema.extend({ expectedVersion: z.number().int().positive().optional() }).safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: firstIssueMessage(parsed.error, "参数不合法") },
      { status: 400 }
    )
  }

  // 真·部分更新：未传的字段用现有值补齐（字符串字段不再因缺省值被清空）；
  // Json 字段传了用新值、没传保留原值；bigFive 传 null 表示清除（回到未评估）
  const p = parsed.data
  try {
  const { character, cascadeJob } = await updateCharacter(characterId, {
    name: p.name ?? existing.name,
    roleType: p.roleType ?? existing.roleType,
    age: p.age ?? existing.age,
    gender: p.gender ?? existing.gender,
    occupation: p.occupation ?? existing.occupation,
    bio: p.bio ?? existing.bio,
    personality: p.personality ?? existing.personality,
    appearance: p.appearance ?? existing.appearance,
    height: p.height ?? existing.height,
    weight: p.weight ?? existing.weight,
    build: p.build ?? existing.build,
    faceShape: p.faceShape ?? existing.faceShape,
    clothing: p.clothing ?? existing.clothing,
    tastes: p.tastes ?? existing.tastes,
    habits: p.habits ?? existing.habits,
    catchphrase: p.catchphrase ?? existing.catchphrase,
    dialogueStyle: p.dialogueStyle ?? existing.dialogueStyle,
    sampleDialogue: p.sampleDialogue ?? existing.sampleDialogue,
    desires: p.desires ?? existing.desires,
    fears: p.fears ?? existing.fears,
    abilities: p.abilities ?? existing.abilities,
    backstory: p.backstory ?? existing.backstory,
    growthArc: p.growthArc ?? existing.growthArc,
    aliases: (p.aliases ?? existing.aliases) as Prisma.InputJsonValue,
    personalityTags: (p.personalityTags ?? existing.personalityTags) as Prisma.InputJsonValue,
    motivations: (p.motivations ?? existing.motivations) as Prisma.InputJsonValue,
    beliefs: (p.beliefs ?? existing.beliefs) as Prisma.InputJsonValue,
    relationships: (p.relationships ?? existing.relationships) as Prisma.InputJsonValue,
    arcStages: (p.arcStages ?? existing.arcStages) as Prisma.InputJsonValue,
    ...(p.attributes !== undefined
      ? { attributes: p.attributes as Prisma.InputJsonValue }
      : {}),
    ...(p.bigFive !== undefined
      ? { bigFive: p.bigFive === null ? Prisma.DbNull : (p.bigFive as Prisma.InputJsonValue) }
      : {}),
  }, p.expectedVersion ?? existing.version)
  // 字段实际变更且已有大纲时会触发级联修订，响应带回 cascadeJobId 供前端跳转
  return NextResponse.json({
    character,
    cascadeJobId: cascadeJob?.id ?? null,
    cascadeAffectedCount: Array.isArray(cascadeJob?.affectedItems)
      ? cascadeJob.affectedItems.length
      : 0,
  })
  } catch (error) {
    return NextResponse.json({ error: error instanceof ContentError ? error.message : "角色保存失败，请保留草稿后重试" }, { status: error instanceof ContentError ? error.status : 500 })
  }
}

export async function DELETE(_request: Request, ctx: RouteContext) {
  const { id, characterId } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const existing = await getOwnedCharacter(characterId, id)
  if (!existing) {
    return NextResponse.json({ error: "角色不存在" }, { status: 404 })
  }

  await deleteCharacter(characterId)
  return NextResponse.json({ ok: true })
}
