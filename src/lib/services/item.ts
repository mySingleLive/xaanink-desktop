import type { Prisma } from "@/generated/prisma/client"
import { prisma } from "@/lib/db"
import { normalizeAliases } from "@/lib/aliases"
import { normalizeTags } from "@/lib/item-tags"
import { normalizeItemLevels, type ItemLevelRef } from "@/components/content/item-levels"
import { normalizeContent, type LevelSystemContent } from "@/components/content/setting-content"

export interface ItemInput {
  name: string
  description: string
  /** 别名字符串数组：["青锋剑", "小剑"]；不传则不更新 */
  aliases?: Prisma.InputJsonValue
  /** 标签字符串数组：["法宝", "成长型"]；不传则不更新 */
  tags?: Prisma.InputJsonValue
  /** 等级引用数组：[{ settingId, pathway, level }]；不传则不更新 */
  levels?: Prisma.InputJsonValue
  /** 外形；不传则不更新 */
  appearance?: string
  /** 获取方式；不传则不更新 */
  acquisition?: string
  /** 功效条目数组：[{ name, description }]；不传则不更新 */
  effects?: Prisma.InputJsonValue
  /** 属性值条目数组：[{ "definitionId": "属性定义id", "value": "值" }] */
  attributes: Prisma.InputJsonValue
}

/** 等级引用校验失败（settingId 不指向本书物品类等级体系 / 多途径缺途径），路由层转 400 */
export class ItemLevelValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ItemLevelValidationError"
  }
}

/**
 * 校验等级引用：settingId 须指向本书 type=LEVEL_SYSTEM 且 scope 含物品（ITEM/GENERAL）的设定；
 * MULTI_PATHWAY 体系必须带非空 pathway。等级节点存在性不做硬校验（改名容忍，前端失效态兜底）。
 */
async function validateItemLevels(novelId: string, levels: ItemLevelRef[]) {
  if (levels.length === 0) return
  const ids = [...new Set(levels.map((l) => l.settingId))]
  const settings = await prisma.setting.findMany({ where: { id: { in: ids }, novelId } })
  const byId = new Map(settings.map((s) => [s.id, s]))
  for (const ref of levels) {
    const setting = byId.get(ref.settingId)
    if (!setting) {
      throw new ItemLevelValidationError("等级引用无效：等级体系不存在或不属于本书")
    }
    if (setting.type !== "LEVEL_SYSTEM") {
      throw new ItemLevelValidationError(`等级引用无效：「${setting.name}」不是等级体系设定`)
    }
    const content = normalizeContent("LEVEL_SYSTEM", setting.content) as LevelSystemContent
    if (content.scope !== "ITEM" && content.scope !== "GENERAL") {
      throw new ItemLevelValidationError(`等级引用无效：体系「${setting.name}」的适用对象不含物品`)
    }
    if (content.form === "MULTI_PATHWAY" && !ref.pathway) {
      throw new ItemLevelValidationError(`等级引用无效：体系「${setting.name}」为多途径形态，必须指定途径`)
    }
  }
}

/** 服务端再规整一遍数组字段（去重/去空/限额），保持幂等 */
function normalizeJsonFields(data: ItemInput) {
  const { aliases, tags, levels, ...rest } = data
  return {
    ...rest,
    ...(aliases !== undefined ? { aliases: normalizeAliases(aliases) } : {}),
    ...(tags !== undefined ? { tags: normalizeTags(tags) } : {}),
    ...(levels !== undefined ? { levels: normalizeItemLevels(levels) } : {}),
  }
}

export async function listItems(novelId: string) {
  return prisma.item.findMany({
    where: { novelId },
    orderBy: { createdAt: "asc" },
  })
}

export async function getItem(id: string) {
  return prisma.item.findUnique({ where: { id } })
}

export async function createItem(novelId: string, data: ItemInput) {
  const normalized = normalizeJsonFields(data)
  if (normalized.levels) await validateItemLevels(novelId, normalized.levels)
  return prisma.item.create({
    data: { novelId, ...normalized },
  })
}

export async function updateItem(id: string, data: ItemInput) {
  const normalized = normalizeJsonFields(data)
  if (normalized.levels) {
    const item = await prisma.item.findUnique({ where: { id } })
    if (!item) throw new Error("物品不存在")
    await validateItemLevels(item.novelId, normalized.levels)
  }
  return prisma.item.update({
    where: { id },
    data: normalized,
  })
}

export async function deleteItem(id: string) {
  return prisma.item.delete({ where: { id } })
}
