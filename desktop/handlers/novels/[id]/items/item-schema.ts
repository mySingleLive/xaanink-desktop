import { z } from "zod"

import { entityAttributesSchema } from "@/lib/services/attribute"

/**
 * 物品字段校验 schema 的单一来源：POST（创建）与 PATCH（全量更新）共用同一契约——
 * 仅 name 必填，其余字段带缺省值（旧客户端可只传 name 创建）。
 * 数组/字符串上限与服务层规整模块（aliases / item-tags / item-levels）保持一致。
 */

/** 等级引用：{ settingId, pathway, level }；单途径体系 pathway 为 null */
export const itemLevelRefSchema = z.object({
  settingId: z.string().trim().min(1),
  pathway: z.string().trim().min(1).max(50).nullable().default(null),
  level: z.string().trim().min(1).max(50),
})

/** 功效条目：name 可空（≤30），description 必填（≤500） */
export const itemEffectSchema = z.object({
  name: z.string().trim().max(30).default(""),
  description: z.string().trim().min(1).max(500),
})

/** 物品全量字段契约：POST/PATCH 共用（PATCH 现有契约为全量字段） */
export const itemSchema = z.object({
  name: z.string().trim().min(1, "物品名称不能为空").max(50),
  description: z.string().max(5000).default(""),
  aliases: z.array(z.string().trim().min(1).max(50)).max(10).default([]),
  tags: z.array(z.string().trim().min(1).max(20)).max(8).default([]),
  levels: z.array(itemLevelRefSchema).max(10).default([]),
  appearance: z.string().max(2000).default(""),
  acquisition: z.string().max(2000).default(""),
  effects: z.array(itemEffectSchema).max(20).default([]),
  attributes: entityAttributesSchema.default([]),
})

/** PATCH 与 POST 同一全量字段契约 */
export const patchItemSchema = itemSchema
