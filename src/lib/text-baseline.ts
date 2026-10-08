/** 浏览器/服务端共享协议；hash 针对原始字段，不归一化换行。 */
import { z } from "zod"
export const textBaselineSchema = z.object({ version: z.number().int().positive().nullable(), updatedAt: z.iso.datetime(), hash: z.string().regex(/^[a-f0-9]{64}$/) })
export async function browserTextHash(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("")
}
