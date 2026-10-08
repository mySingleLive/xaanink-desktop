import { z } from "zod"

export const worldNameSchema = z.string({ error: "请填写明确的世界名称" }).trim().min(1, "世界名称不能为空").max(100, "世界名称不能超过 100 个字符")
  .refine(name => !/^(null|undefined|\[object Object\])$/i.test(name), "请填写明确的世界名称，不能使用空值占位名")
export const worldIdSchema = z.string().trim().min(1, "世界编号不能为空")
export const createWorldSchema = z.object({ name: worldNameSchema, parentId: worldIdSchema.nullish(), description: z.string().max(200000).optional() })
export const patchWorldSchema = z.object({ name: worldNameSchema.optional(), parentId: worldIdSchema.nullable().optional(), description: z.string().max(200000).optional() })
  .refine(data => Object.values(data).some(value => value !== undefined), "没有需要更新的字段")
export function validWorldName(value: unknown): value is string { return worldNameSchema.safeParse(value).success }
export function worldDisplayName(value: unknown) { return validWorldName(value) ? value.trim() : "未命名世界" }
