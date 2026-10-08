import { NextResponse } from "next/server"
import { z } from "zod"

import type { Prisma } from "@/generated/prisma/client"
import { CharacterRoleType } from "@/generated/prisma/enums"
import { createCharacter, listCharacters } from "@/lib/services/character"

import { firstIssueMessage, getOwnedNovel } from "../lib"
import { createCharacterSchema } from "./character-schema"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const roleParam = new URL(request.url).searchParams.get("roleType")
  const roleParsed = z.enum(CharacterRoleType).safeParse(roleParam ?? undefined)
  const characters = await listCharacters(
    id,
    roleParsed.success ? roleParsed.data : undefined
  )

  return NextResponse.json({ characters })
}

export async function POST(request: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const body = await request.json().catch(() => null)
  const parsed = createCharacterSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: firstIssueMessage(parsed.error, "参数不合法") },
      { status: 400 }
    )
  }

  // bigFive 拆出单独处理：null（未评估）时不传该字段，列默认即 NULL（可空 Json 列不接受裸 JS null）
  const { bigFive, ...rest } = parsed.data
  const character = await createCharacter(id, {
    ...rest,
    aliases: rest.aliases as Prisma.InputJsonValue,
    personalityTags: rest.personalityTags as Prisma.InputJsonValue,
    motivations: rest.motivations as Prisma.InputJsonValue,
    beliefs: rest.beliefs as Prisma.InputJsonValue,
    ...(bigFive !== null ? { bigFive: bigFive as Prisma.InputJsonValue } : {}),
    relationships: rest.relationships as Prisma.InputJsonValue,
    arcStages: rest.arcStages as unknown as Prisma.InputJsonValue,
    attributes: rest.attributes as Prisma.InputJsonValue,
  })
  return NextResponse.json({ character })
}
