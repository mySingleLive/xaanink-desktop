import { NextResponse } from "next/server"

import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"

/**
 * 会话列表（按最近活跃排序）。可选 ?novelId= 过滤某本小说的会话。
 */
export async function GET(request: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "未登录" }, { status: 401 })
  }

  const novelId = new URL(request.url).searchParams.get("novelId")
  const conversations = await prisma.conversation.findMany({
    where: { userId: session.user.id, ...(novelId ? { novelId } : {}) },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      novelId: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { messages: true } },
    },
  })

  return NextResponse.json({ conversations })
}
