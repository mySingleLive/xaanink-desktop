import { z } from "zod"

import type { AttributeTarget, AttributeValueType, Prisma } from "@/generated/prisma/client"
import { prisma } from "@/lib/db"

/**
 * 实体（角色/物品/场景）上挂载的属性值条目。
 * definitionId 关联 AttributeDefinition，名称/介绍读取时联表取最新。
 */
export const entityAttributeSchema = z.object({
  definitionId: z.string().min(1),
  value: z.string().max(500),
})

export const entityAttributesSchema = z.array(entityAttributeSchema).max(100)

export interface AttributeDefinitionInput {
  name: string
  description: string
  targets: AttributeTarget[]
  valueType: AttributeValueType
  options: string[]
}

export async function listAttributeDefinitions(novelId: string) {
  return prisma.attributeDefinition.findMany({
    where: { novelId },
    orderBy: { createdAt: "asc" },
  })
}

export async function getAttributeDefinition(id: string) {
  return prisma.attributeDefinition.findUnique({ where: { id } })
}

export async function createAttributeDefinition(
  novelId: string,
  data: AttributeDefinitionInput
) {
  return prisma.attributeDefinition.create({
    data: { novelId, ...data },
  })
}

export async function updateAttributeDefinition(
  id: string,
  data: AttributeDefinitionInput
) {
  return prisma.attributeDefinition.update({
    where: { id },
    data,
  })
}

/**
 * 删除属性定义，并清理三本小说实体上引用了它的属性值，
 * 避免遗留无法解析的 definitionId。
 */
export async function deleteAttributeDefinition(id: string) {
  const definition = await prisma.attributeDefinition.findUnique({ where: { id } })
  if (!definition) return

  await prisma.$transaction(async (tx) => {
    await tx.attributeDefinition.delete({ where: { id } })
    await Promise.all([
      stripAttributeValues(tx.character, definition.novelId, id),
      stripAttributeValues(tx.item, definition.novelId, id),
      stripAttributeValues(tx.scene, definition.novelId, id),
    ])
  })
}

type AttributeHolderDelegate = {
  findMany: (args: {
    where: { novelId: string }
    select: { id: true; attributes: true }
  }) => Promise<{ id: string; attributes: Prisma.JsonValue }[]>
  update: (args: {
    where: { id: string }
    data: { attributes: Prisma.InputJsonValue }
  }) => Promise<unknown>
}

/** 把某实体表内所有引用了 definitionId 的属性值移除 */
async function stripAttributeValues(
  delegate: AttributeHolderDelegate,
  novelId: string,
  definitionId: string
) {
  const rows = await delegate.findMany({
    where: { novelId },
    select: { id: true, attributes: true },
  })
  for (const row of rows) {
    if (!Array.isArray(row.attributes)) continue
    const kept = row.attributes.filter(
      (item) =>
        !(
          item &&
          typeof item === "object" &&
          (item as { definitionId?: unknown }).definitionId === definitionId
        )
    )
    if (kept.length !== row.attributes.length) {
      await delegate.update({
        where: { id: row.id },
        data: { attributes: kept as Prisma.InputJsonValue },
      })
    }
  }
}
