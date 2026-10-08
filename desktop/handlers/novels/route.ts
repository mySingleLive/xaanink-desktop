import { NextResponse } from "next/server"
import { createNovelOnce } from "@/lib/services/novel-create"
import { ContentError } from "@/lib/content-errors"

import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"

export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "未登录" }, { status: 401 })
    }

    const novels = await prisma.novel.findMany({
      where: { userId: session.user.id, status: { not: "DELETED" } },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        title: true,
        coverUrl: true,
        status: true,
        currentStage: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    return NextResponse.json({ novels })
  } catch {
    return NextResponse.json({ error: "获取小说列表失败" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "未登录" }, { status: 401 })
    }

    const novel = await createNovelOnce(session.user.id, await request.json().catch(() => null))
    return NextResponse.json({ novel }, { status: 201 })
  } catch (error) {
    if (error instanceof ContentError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    return NextResponse.json({ error: "创建小说失败，请稍后重试" }, { status: 500 })
  }
}
