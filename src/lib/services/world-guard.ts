import type { CommitTransaction } from "./content-commit"
import { ContentError } from "@/lib/content-errors"

export class WorldNameConflictError extends ContentError {
  constructor(name?: string) { super("WORLD_NAME_CONFLICT", name ? `同级已存在世界「${name}」` : "同级已存在相同名称的世界", 409); this.name = "WorldNameConflictError" }
}
export async function lockWorldTree(tx: CommitTransaction, novelId: string) {
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${'world-tree:' + novelId}, 0))`
}
/** 数据库守卫只返回约定的领域错误，不向前端暴露 Prisma/SQL 诊断。 */
export function worldWriteError(error: unknown): never {
  const message = error instanceof Error ? error.message : ""
  if (message.includes("WORLD_NAME_CONFLICT")) throw new WorldNameConflictError()
  if (message.includes("WORLD_INVALID_NAME")) throw new ContentError("INVALID_WORLD_NAME", "请填写明确、非空且不超过 100 字符的世界名称", 400)
  if (message.includes("WORLD_INVALID_PARENT")) throw new ContentError("WORLD_INVALID_PARENT", "父世界不存在或不属于本作品", 400)
  if (message.includes("WORLD_CYCLE")) throw new ContentError("WORLD_CYCLE", "不能把世界移动到自己、子世界或异常父链之下", 400)
  if (message.includes("WORLD_SCOPE_IMMUTABLE")) throw new ContentError("WORLD_SCOPE_IMMUTABLE", "世界不能转移到其他作品", 400)
  throw error
}
