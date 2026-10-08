import { z } from "zod"
import { globalPrisma as prisma } from "@/lib/db"
export const costConfigSchema = z.object({
  enabled: z.boolean(),
  inputBudgetTokens: z.number().int().min(4000).max(1000000),
  maxConcurrentTasks: z.number().int().min(1).max(8),
})
export type CostConfig = z.infer<typeof costConfigSchema>
export const DEFAULT_COST_CONFIG: CostConfig = { enabled: false, inputBudgetTokens: 24000, maxConcurrentTasks: 2 }
export const COST_CONFIG_KEY = "chat.cost.config"
export async function getCostConfig(): Promise<CostConfig> {
  try {
    const row = await prisma.systemConfig.findUnique({ where: { key: COST_CONFIG_KEY } })
    const parsed = costConfigSchema.safeParse(row?.value)
    return parsed.success ? parsed.data : { ...DEFAULT_COST_CONFIG }
  } catch { return { ...DEFAULT_COST_CONFIG } }
}
export async function setCostConfig(value: CostConfig) {
  const data = costConfigSchema.parse(value)
  await prisma.systemConfig.upsert({ where: { key: COST_CONFIG_KEY }, create: { key: COST_CONFIG_KEY, value: data }, update: { value: data } })
  return data
}
