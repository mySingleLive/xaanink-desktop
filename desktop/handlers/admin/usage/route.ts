import { NextResponse } from "next/server"

import { prisma } from "@/lib/db"
import {
  forbidden,
  parseDate,
  parsePagination,
  requireAdmin,
  serverError,
} from "../lib"

export const dynamic = "force-dynamic"

function csvCell(value: string | number): string {
  const s = String(value)
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export async function GET(request: Request) {
  const session = await requireAdmin()
  if (!session) return forbidden()

  try {
    const url = new URL(request.url)
    const userId = url.searchParams.get("userId") || undefined
    const modelId = url.searchParams.get("modelId") || undefined
    const from = parseDate(url.searchParams.get("from"))
    const to = parseDate(url.searchParams.get("to"), true)
    const isCsv = url.searchParams.get("format") === "csv"

    const where = {
      ...(userId ? { userId } : {}),
      ...(modelId ? { modelId } : {}),
      ...(from || to
        ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
        : {}),
    }

    const include = {
      user: { select: { email: true } },
      model: { select: { name: true } },
      novel: { select: { title: true } },
    } as const

    // CSV 导出：上限 1 万条，防止一次性拉爆内存
    if (isCsv) {
      const records = await prisma.usageRecord.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: 10000,
        include,
      })
      const header = "id,用户邮箱,模型,动作,输入tokens,输出tokens,总tokens,成本,时间"
      const lines = records.map((r) =>
        [
          r.id,
          r.user.email,
          r.model.name,
          r.action,
          r.promptTokens,
          r.completionTokens,
          r.promptTokens + r.completionTokens,
          r.cost.toFixed(6),
          r.createdAt.toISOString(),
        ]
          .map(csvCell)
          .join(",")
      )
      // 开头加 BOM，Excel 打开 UTF-8 CSV 不乱码
      const csv = "\uFEFF" + [header, ...lines].join("\n")
      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="usage-${Date.now()}.csv"`,
        },
      })
    }

    const { page, pageSize, skip, take } = parsePagination(url)
    const [total, records] = await Promise.all([
      prisma.usageRecord.count({ where }),
      prisma.usageRecord.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
        include,
      }),
    ])

    return NextResponse.json({
      total,
      page,
      pageSize,
      records: records.map((r) => ({
        id: r.id,
        userId: r.userId,
        userEmail: r.user.email,
        modelId: r.modelId,
        modelName: r.model.name,
        novelTitle: r.novel?.title ?? null,
        action: r.action,
        promptTokens: r.promptTokens,
        completionTokens: r.completionTokens,
        totalTokens: r.promptTokens + r.completionTokens,
        cost: r.cost,
        createdAt: r.createdAt,
      })),
    })
  } catch {
    return serverError("用量记录加载失败")
  }
}
