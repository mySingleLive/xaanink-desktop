import { NextResponse } from "next/server"

import { auth } from "@/lib/auth"
import { decrypt } from "@/lib/crypto"

export type AdminSession = NonNullable<Awaited<ReturnType<typeof requireAdmin>>>

/** Local template/settings handlers run only within the trusted worker context.
 * Work ownership still uses the USER identity; this does not grant an ADMIN role. */
export async function requireAdmin() {
  const session = await auth()
  if (!session?.user) {
    return null
  }
  return session
}

export function forbidden() {
  return NextResponse.json({ error: "无权限访问" }, { status: 403 })
}

export function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

export function notFound(message = "资源不存在") {
  return NextResponse.json({ error: message }, { status: 404 })
}

export function serverError(message = "服务器内部错误") {
  return NextResponse.json({ error: message }, { status: 500 })
}

const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 100

/** 从密文解密出明文后生成掩码（如 sk-****abcd），永不返回 key 本体 */
export function maskApiKey(apiKeyEncrypted: string): string {
  try {
    const plain = decrypt(apiKeyEncrypted)
    if (plain.length <= 7) return "****"
    return `${plain.slice(0, 3)}****${plain.slice(-4)}`
  } catch {
    return "****"
  }
}

/** 解析 ?page=&pageSize= 分页参数 */
export function parsePagination(url: URL) {
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1)
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number(url.searchParams.get("pageSize")) || DEFAULT_PAGE_SIZE)
  )
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize }
}

/** 解析日期参数（YYYY-MM-DD），无效返回 null */
export function parseDate(value: string | null, endOfDay = false): Date | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  if (endOfDay) date.setHours(23, 59, 59, 999)
  return date
}
