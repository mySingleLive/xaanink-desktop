import { NextResponse } from "next/server"
import type { Session } from "@/lib/auth"

import type { Novel } from "@/generated/prisma/client"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"

/**
 * novels/[id] 子路由统一入口：auth() + 小说存在性与归属校验。
 * 返回 { novel, session } 或 { error }（直接 return 给客户端）。
 */
export async function getOwnedNovel(
  id: string
): Promise<{ novel: Novel; session: Session } | { error: NextResponse }> {
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

/** zod 校验失败时取第一条错误信息 */
export function firstIssueMessage(error: { issues: { message: string }[] }, fallback: string) {
  return error.issues[0]?.message ?? fallback
}
