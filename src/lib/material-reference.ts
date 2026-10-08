import { z } from "zod"

export const materialRefSchema = z.object({
  kind: z.enum(["setting", "item", "scene", "foreshadow"]),
  id: z.string().min(1).max(160),
  role: z.enum(["use", "plant", "mention", "payoff"]),
  note: z.string().trim().min(1).max(500),
}).refine(ref => ref.kind === "foreshadow" ? ref.role !== "use" : ref.role === "use", "普通资料用 use；伏笔用 plant/mention/payoff")
export type MaterialRef = z.infer<typeof materialRefSchema>
export const MATERIAL_LABELS = { setting: "设定", item: "物品", scene: "场景", foreshadow: "伏笔" } as const
export const MATERIAL_ROLE_LABELS = { use: "使用", plant: "首次埋入", mention: "提及", payoff: "回收" } as const
