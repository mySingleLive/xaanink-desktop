import type { Prisma, SettingType } from "@/generated/prisma/client"
import { PrismaClientKnownRequestError } from "@/generated/prisma/internal/prismaNamespace"
import { normalizeFactionIdentity } from "@/lib/faction-identity"
import { prisma } from "@/lib/db"
import { triggerCascade } from "@/lib/services/cascade"
import { commitSettingRevision, type SettingSaveOptions } from "./setting-commit"

/** 变更描述里内容摘要的最大长度，超出截断 */
const CHANGE_SUMMARY_MAX = 2000

function summarizeContent(content: unknown): string {
  const text = typeof content === "string" ? content : JSON.stringify(content)
  return text.length > CHANGE_SUMMARY_MAX ? `${text.slice(0, CHANGE_SUMMARY_MAX)}…（截断）` : text
}

export interface ListSettingsFilter {
  type?: SettingType
  /** 传世界 id 返回该世界的设定；不传则只返回小说级设定（worldId 为空） */
  worldId?: string
}

export async function listSettings(novelId: string, filter: ListSettingsFilter = {}) {
  const { type, worldId } = filter
  return prisma.setting.findMany({
    where: {
      novelId,
      ...(type ? { type } : {}),
      worldId: worldId ?? null,
    },
    orderBy: [{ type: "asc" }, { createdAt: "asc" }],
  })
}

export interface UpsertSettingInput {
  novelId: string
  type: SettingType
  name: string
  /** 各类型结构不同（Json）：纯文本 { text } / 条目数组 / 金手指三要素等 */
  content: Prisma.InputJsonValue
  saveOptions?: SettingSaveOptions
  /** 世界级设定的所属世界；小说级（金手指/文风）为空 */
  worldId?: string | null
  /** 仅 MAP 类型：父地图 id（子地图嵌套） */
  parentId?: string | null
}

/** 设定重名冲突（同一作用域内） */
export class SettingNameConflictError extends Error {
  constructor(name: string) {
    super(`已存在同名设定「${name}」`)
    this.name = "SettingNameConflictError"
  }
}

/** 作用域判重条件：子地图 (parentId,name) / 世界级 (worldId,type,name) / 小说级 (novelId,type,name) */
function scopeWhere(input: { novelId: string; type: SettingType; name: string; worldId?: string | null; parentId?: string | null }) {
  if (input.parentId) {
    return { parentId: input.parentId, name: input.name }
  }
  if (input.worldId) {
    return { worldId: input.worldId, parentId: null, type: input.type, name: input.name }
  }
  return { novelId: input.novelId, worldId: null, parentId: null, type: input.type, name: input.name }
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof PrismaClientKnownRequestError && err.code === "P2002"
}

/**
 * 按作用域唯一键创建或更新设定。
 * 已存在时 version+1 并写入 ContentVersion 快照（reason="设定更新"）。
 * 唯一性由迁移中的部分唯一索引兜底（P2002 → SettingNameConflictError）。
 */
export async function upsertSetting(input: UpsertSettingInput) {
  const { novelId, type, name, content, worldId = null, parentId = null } = input
  try {
    const existing = await prisma.setting.findFirst({ where: scopeWhere({ novelId, type, name, worldId, parentId }) })
    if (!existing) return await prisma.setting.create({ data: { novelId, type, name, content: type === "FACTION" ? normalizeFactionIdentity(content) as Prisma.InputJsonValue : content, worldId, parentId } })
    return await commitSettingRevision(existing.id, { content }, input.saveOptions)
  } catch (err) {
    if (isUniqueViolation(err)) throw new SettingNameConflictError(name)
    throw err
  }
}

export async function deleteSetting(id: string) {
  return prisma.setting.delete({ where: { id } })
}

/**
 * 按 id 原地更新设定（可改名）：version+1 并写入 ContentVersion 快照。
 * 改名撞同作用域同名设定时抛 SettingNameConflictError。
 * 内容有实际变更且该小说已有大纲时，提交后触发级联修订（CascadeJob），
 * 返回值附带新 job（未触发则为 null）；级联失败不影响主更新。
 */
export async function updateSetting(
  id: string,
  data: { name?: string; content?: Prisma.InputJsonValue; parentId?: string | null },
  options?: SettingSaveOptions & { cascade?: boolean }
) {
  const existing = await prisma.setting.findUnique({ where: { id } })
  if (!existing) {
    throw new Error("设定不存在")
  }

  if (data.name && data.name !== existing.name) {
    const conflict = await prisma.setting.findFirst({
      where: {
        ...scopeWhere({
          novelId: existing.novelId,
          type: existing.type,
          name: data.name,
          worldId: existing.worldId,
          parentId: existing.parentId,
        }),
        id: { not: id },
      },
    })
    if (conflict) {
      throw new SettingNameConflictError(data.name)
    }
  }

  let setting
  try {
    setting = await commitSettingRevision(id, data, options)
  } catch (err) {
    if (isUniqueViolation(err)) throw new SettingNameConflictError(data.name ?? existing.name)
    throw err
  }

  // 主更新已提交，再触发级联修订；内容无实际变更时不触发
  const changed =
    setting.name !== existing.name ||
    (data.content !== undefined &&
      JSON.stringify(existing.content) !== JSON.stringify(setting.content))
  // 三阶段保存的对话流水线传 cascade:false：级联改由流水线问答门控后单独触发
  const cascadeJob = changed && options?.cascade !== false
    ? await triggerCascade({
        novelId: setting.novelId,
        triggerType: "SETTING",
        triggerId: setting.id,
        changeDescription: [
          `设定「${setting.name}」已从 v${existing.version} 更新到 v${setting.version}。`,
          `旧内容：${summarizeContent(existing.content)}`,
          `新内容：${summarizeContent(setting.content)}`,
        ].join("\n"),
      })
    : null

  return { setting, cascadeJob }
}
