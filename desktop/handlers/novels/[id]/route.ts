import { NextResponse } from "next/server"
import { z } from "zod"

import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { renameNovelTitle } from "@/lib/services/theme"
import { NovelStage, NovelStatus } from "@/generated/prisma/enums"

type RouteContext = { params: Promise<{ id: string }> }

const patchNovelSchema = z
  .object({
    title: z.string().trim().min(1, "书名不能为空").max(100, "书名最长 100 字").optional(),
    currentStage: z.enum(NovelStage).optional(),
    status: z.enum(NovelStatus).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: "没有需要更新的字段" })

async function getOwnedNovel(id: string) {
  const session = await auth()
  if (!session?.user?.id) {
    return { error: NextResponse.json({ error: "未登录" }, { status: 401 }) }
  }

  const novel = await prisma.novel.findUnique({ where: { id } })
  if (!novel || novel.status === "DELETED") {
    return { error: NextResponse.json({ error: "小说不存在" }, { status: 404 }) }
  }
  if (novel.userId !== session.user.id && session.user.role !== "ADMIN") {
    return { error: NextResponse.json({ error: "无权访问该小说" }, { status: 403 }) }
  }

  return { novel, session }
}

export async function GET(_request: Request, ctx: RouteContext) {
  try {
    const { id } = await ctx.params
    const result = await getOwnedNovel(id)
    if ("error" in result) return result.error

    const novel = await prisma.novel.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        coverUrl: true,
        status: true,
        currentStage: true,
        createdAt: true,
        updatedAt: true,
        theme: true,
        settings: {
          select: {
            id: true,
            type: true,
            name: true,
            version: true,
            updatedAt: true,
            worldId: true,
            parentId: true,
          },
          orderBy: { updatedAt: "desc" },
        },
        characters: {
          select: { id: true, name: true, roleType: true },
          orderBy: { createdAt: "asc" },
        },
        volumes: {
          select: {
            id: true,
            index: true,
            title: true,
            updatedAt: true,
            chapters: {
              select: { id: true, index: true, title: true, status: true, wordCount: true },
              orderBy: { index: "asc" },
            },
          },
          orderBy: { index: "asc" },
        },
      },
    })

    return NextResponse.json({ novel })
  } catch {
    return NextResponse.json({ error: "获取小说详情失败" }, { status: 500 })
  }
}

export async function PATCH(request: Request, ctx: RouteContext) {
  try {
    const { id } = await ctx.params
    const result = await getOwnedNovel(id)
    if ("error" in result) return result.error

    const body = await request.json()
    const parsed = patchNovelSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "参数不合法" },
        { status: 400 }
      )
    }

    const { title, ...rest } = parsed.data
    // 书名走 renameNovelTitle 单一入口：Novel.title 与 Theme.title 同事务同步（同名校守卫），
    // 消除「侧栏改名后下次 upsertTheme 用旧 Theme.title 回盖」的分叉。
    if (title !== undefined) await renameNovelTitle(id, title)
    const select = {
      id: true,
      title: true,
      status: true,
      currentStage: true,
      createdAt: true,
      updatedAt: true,
    } as const
    // 仅改名时不再 update：同名重写零变更（updatedAt 不动），幂等重放安全
    const novel = Object.keys(rest).length > 0
      ? await prisma.novel.update({ where: { id }, data: rest, select })
      : await prisma.novel.findUniqueOrThrow({ where: { id }, select })

    return NextResponse.json({ novel })
  } catch {
    return NextResponse.json({ error: "更新小说失败，请稍后重试" }, { status: 500 })
  }
}

export async function DELETE(_request: Request, ctx: RouteContext) {
  try {
    const { id } = await ctx.params
    const result = await getOwnedNovel(id)
    if ("error" in result) return result.error

    await prisma.novel.update({
      where: { id },
      data: { status: "DELETED" },
    })

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "删除小说失败，请稍后重试" }, { status: 500 })
  }
}
