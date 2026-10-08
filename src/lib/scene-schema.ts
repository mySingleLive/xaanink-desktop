import { z } from "zod"
import { entityAttributesSchema } from "@/lib/services/attribute"

const fields = {
  name: z.string().trim().min(1, "场景名称不能为空").max(50),
  parentId: z.string().min(1).nullable(),
  description: z.string().max(5000), coordinates: z.string().max(200),
  attributes: entityAttributesSchema,
  backstory: z.string().max(20000), entryMethod: z.string().max(5000),
  exteriorDescription: z.string().max(20000), interiorDescription: z.string().max(20000),
  factionSettingId: z.string().min(1).nullable(), factionId: z.string().min(1).nullable(),
}
export const sceneFieldsSchema = z.object(fields).partial().strict()
export const createSceneSchema = sceneFieldsSchema.extend({ name: fields.name })
export const sceneControlSchema = z.object({ expectedVersion: z.number().int().positive(), operationId: z.string().min(1).max(160) })
export const patchSceneSchema = sceneFieldsSchema.extend(sceneControlSchema.shape)
export type SceneInput = z.infer<typeof createSceneSchema>
export type ScenePatch = z.infer<typeof sceneFieldsSchema>
export type SceneImageKind = "exterior" | "interior"
export const sceneImageKindSchema = z.enum(["exterior", "interior"])
