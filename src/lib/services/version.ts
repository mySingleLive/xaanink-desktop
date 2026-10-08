import { prisma } from "@/lib/db"
import type { Prisma } from "@/generated/prisma/client"

/**
 * 写入一条 ContentVersion 快照（主题/设定/角色等内容更新时调用）。
 * 级联更新（CascadeJob）在 Phase 8 实现，本阶段只负责快照落库。
 */
export async function writeContentSnapshot(input: {
  targetType: "Theme" | "Setting" | "Character" | "Volume" | "Chapter"
  targetId: string
  version: number
  snapshot: unknown
  reason: string
}, tx: Pick<Prisma.TransactionClient, "contentVersion"> = prisma) {
  await tx.contentVersion.create({
    data: {
      targetType: input.targetType,
      targetId: input.targetId,
      version: input.version,
      snapshot: JSON.parse(JSON.stringify(input.snapshot)) as Prisma.InputJsonValue,
      reason: input.reason,
    },
  })
}
