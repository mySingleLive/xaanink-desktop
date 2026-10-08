import { z } from "zod"

import { CharacterRoleType } from "@/generated/prisma/enums"
import { arcStageListSchema } from "@/lib/arc-stage"
import { entityAttributesSchema } from "@/lib/services/attribute"

/**
 * 角色字段校验 schema 的单一来源：POST（创建，缺省值兜底）与 PATCH（部分更新，全部 optional）
 * 两个路由共用，避免字段上限在两处漂移。字符串上限与服务层/纯 TS 规整模块保持一致。
 */

export const relationshipSchema = z.object({
  target: z.string().max(100),
  description: z.string().max(500),
  /** 链接到已有角色的 id（自由文本目标为 null/缺省） */
  characterId: z.string().max(50).nullish(),
})

export const motivationLayerSchema = z.object({
  items: z
    .array(
      z.object({
        text: z.string().trim().min(1).max(200),
        importance: z.number().int().min(1).max(5).default(3),
      })
    )
    .min(1)
    .max(10),
})

export const beliefsSchema = z.object({
  worldview: z.string().max(1000).optional(),
  values: z.string().max(1000).optional(),
  outlook: z.string().max(1000).optional(),
  other: z.string().max(1000).optional(),
})

export const bigFiveSchema = z.object({
  openness: z.number().int().min(0).max(100),
  conscientiousness: z.number().int().min(0).max(100),
  extraversion: z.number().int().min(0).max(100),
  agreeableness: z.number().int().min(0).max(100),
  neuroticism: z.number().int().min(0).max(100),
})

/** 全部角色字段（未挂 default/optional 的裸定义） */
export const characterFieldSchemas = {
  name: z.string().trim().min(1, "角色姓名不能为空").max(50),
  roleType: z.enum(CharacterRoleType),
  aliases: z.array(z.string().trim().min(1).max(50)).max(10),
  age: z.string().max(50),
  gender: z.string().max(50),
  occupation: z.string().max(100),
  bio: z.string().max(300),
  personality: z.string().max(2000),
  personalityTags: z.array(z.string().trim().min(1).max(30)).max(20),
  appearance: z.string().max(2000),
  height: z.string().max(50),
  weight: z.string().max(50),
  build: z.string().max(50),
  faceShape: z.string().max(50),
  clothing: z.string().max(2000),
  tastes: z.string().max(2000),
  habits: z.string().max(500),
  catchphrase: z.string().max(500),
  dialogueStyle: z.string().max(1000),
  sampleDialogue: z.string().max(1000),
  motivations: z.array(motivationLayerSchema).max(6),
  desires: z.string().max(2000),
  fears: z.string().max(2000),
  beliefs: beliefsSchema,
  bigFive: bigFiveSchema.nullable(),
  abilities: z.string().max(2000),
  backstory: z.string().max(5000),
  growthArc: z.string().max(5000),
  arcStages: arcStageListSchema,
  relationships: z.array(relationshipSchema).max(50),
  attributes: entityAttributesSchema,
}

/** POST 创建用：除 name/roleType 外全部带缺省值 */
export const createCharacterSchema = z.object({
  name: characterFieldSchemas.name,
  roleType: characterFieldSchemas.roleType,
  aliases: characterFieldSchemas.aliases.default([]),
  age: characterFieldSchemas.age.default(""),
  gender: characterFieldSchemas.gender.default(""),
  occupation: characterFieldSchemas.occupation.default(""),
  bio: characterFieldSchemas.bio.default(""),
  personality: characterFieldSchemas.personality.default(""),
  personalityTags: characterFieldSchemas.personalityTags.default([]),
  appearance: characterFieldSchemas.appearance.default(""),
  height: characterFieldSchemas.height.default(""),
  weight: characterFieldSchemas.weight.default(""),
  build: characterFieldSchemas.build.default(""),
  faceShape: characterFieldSchemas.faceShape.default(""),
  clothing: characterFieldSchemas.clothing.default(""),
  tastes: characterFieldSchemas.tastes.default(""),
  habits: characterFieldSchemas.habits.default(""),
  catchphrase: characterFieldSchemas.catchphrase.default(""),
  dialogueStyle: characterFieldSchemas.dialogueStyle.default(""),
  sampleDialogue: characterFieldSchemas.sampleDialogue.default(""),
  motivations: characterFieldSchemas.motivations.default([]),
  desires: characterFieldSchemas.desires.default(""),
  fears: characterFieldSchemas.fears.default(""),
  beliefs: characterFieldSchemas.beliefs.default({}),
  bigFive: characterFieldSchemas.bigFive.default(null),
  abilities: characterFieldSchemas.abilities.default(""),
  backstory: characterFieldSchemas.backstory.default(""),
  growthArc: characterFieldSchemas.growthArc.default(""),
  arcStages: characterFieldSchemas.arcStages.default([]),
  relationships: characterFieldSchemas.relationships.default([]),
  attributes: characterFieldSchemas.attributes.default([]),
})

/** PATCH 部分更新用：全部字段 optional，不传 = 保留原值（路由内与现有记录合并） */
export const patchCharacterSchema = z.object({
  name: characterFieldSchemas.name.optional(),
  roleType: characterFieldSchemas.roleType.optional(),
  aliases: characterFieldSchemas.aliases.optional(),
  age: characterFieldSchemas.age.optional(),
  gender: characterFieldSchemas.gender.optional(),
  occupation: characterFieldSchemas.occupation.optional(),
  bio: characterFieldSchemas.bio.optional(),
  personality: characterFieldSchemas.personality.optional(),
  personalityTags: characterFieldSchemas.personalityTags.optional(),
  appearance: characterFieldSchemas.appearance.optional(),
  height: characterFieldSchemas.height.optional(),
  weight: characterFieldSchemas.weight.optional(),
  build: characterFieldSchemas.build.optional(),
  faceShape: characterFieldSchemas.faceShape.optional(),
  clothing: characterFieldSchemas.clothing.optional(),
  tastes: characterFieldSchemas.tastes.optional(),
  habits: characterFieldSchemas.habits.optional(),
  catchphrase: characterFieldSchemas.catchphrase.optional(),
  dialogueStyle: characterFieldSchemas.dialogueStyle.optional(),
  sampleDialogue: characterFieldSchemas.sampleDialogue.optional(),
  motivations: characterFieldSchemas.motivations.optional(),
  desires: characterFieldSchemas.desires.optional(),
  fears: characterFieldSchemas.fears.optional(),
  beliefs: characterFieldSchemas.beliefs.optional(),
  bigFive: characterFieldSchemas.bigFive.optional(),
  abilities: characterFieldSchemas.abilities.optional(),
  backstory: characterFieldSchemas.backstory.optional(),
  growthArc: characterFieldSchemas.growthArc.optional(),
  arcStages: characterFieldSchemas.arcStages.optional(),
  relationships: characterFieldSchemas.relationships.optional(),
  attributes: characterFieldSchemas.attributes.optional(),
})
