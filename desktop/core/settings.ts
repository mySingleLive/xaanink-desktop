import { z } from "zod"

export const appearanceSchema = z.object({
  theme: z.enum(["paper", "ink", "system"]),
  uiFont: z.string().max(200), uiFontSize: z.number().int().min(11).max(24), zoom: z.number().min(0.75).max(2),
  bodyFont: z.string().max(200), bodyFontSize: z.number().int().min(12).max(40), lineHeight: z.number().min(1.2).max(3),
  lineNumbers: z.boolean(), wordWrap: z.boolean(),
}).strict()
export const modelSchema = z.object({
  id: z.string().uuid(), name: z.string().trim().min(1).max(120), provider: z.string().min(1).max(40),
  protocol: z.enum(["openai", "anthropic"]), providerName: z.string().trim().max(80).optional(), modelId: z.string().trim().min(1).max(200),
  endpoint: z.string().url().max(2048), kind: z.enum(["TEXT", "IMAGE"]),
  contextWindow: z.union([z.literal(0), z.number().int().min(1024).max(100_000_000)]), enabled: z.boolean(), authRevision: z.number().int().positive(),
  encryptedKey: z.string().min(1).max(32000), keyMask: z.string().max(30),
  thinkingLevels: z.array(z.string().max(30)).max(12), defaultThinking: z.string().max(30),
  inputCostPer1k: z.number().nonnegative().optional(), outputCostPer1k: z.number().nonnegative().optional(),
}).strict()
// Accept only the two known, validated legacy backup fields on reads/imports;
// never return them to the UI or persist them in subsequent settings updates.
export const generalSettingsInputSchema=z.object({defaultParent:z.string().max(4096),restoreSession:z.boolean(),backupIntervalMinutes:z.number().int().min(1).max(1440).optional(),backupRetention:z.number().int().min(1).max(1000).optional()}).strict()
export const settingsSchema = z.object({
  general: generalSettingsInputSchema.transform(({defaultParent,restoreSession})=>({defaultParent,restoreSession})),
  user: z.object({ penName: z.string().trim().min(1).max(80), email: z.union([z.literal(""), z.email()]), avatarAssetId: z.string().uuid().nullable() }).strict(),
  agent: z.object({ textModelId: z.string().uuid().nullable(), mode: z.enum(["standard", "plan"]), thinking: z.string().max(30), reviewModelId: z.string().uuid().nullable(), imageModelId: z.string().uuid().nullable() }).strict(),
  appearance: appearanceSchema,
  shortcuts: z.object({ darwin: z.record(z.string(), z.array(z.string()).max(12)), win32: z.record(z.string(), z.array(z.string()).max(12)) }).strict(),
}).strict()
export const stateSchema = z.object({ settings: settingsSchema, models: z.array(modelSchema).max(1000) }).strict()
export type Settings = z.infer<typeof settingsSchema>
export type StoredModel = z.infer<typeof modelSchema>
export type PublicModel = Omit<StoredModel, "encryptedKey">
export type AppState = z.infer<typeof stateSchema>
export const defaultState: AppState = {
  settings: {
    general: { defaultParent: "", restoreSession: true },
    user: { penName: "作者", email: "", avatarAssetId: null },
    agent: { textModelId: null, mode: "standard", thinking: "default", reviewModelId: null, imageModelId: null },
    appearance: { theme: "paper", uiFont: "system", uiFontSize: 14, zoom: 1, bodyFont: "serif", bodyFontSize: 16, lineHeight: 1.8, lineNumbers: false, wordWrap: false },
    shortcuts: { darwin: {}, win32: {} },
  },
  models: [],
}
export function publicModel(model: StoredModel): PublicModel { const { encryptedKey: _key, ...safe } = model; return { ...safe, keyMask: "••••••••" } }
export function publicState(state: AppState) { return { settings: structuredClone(state.settings), models: state.models.map(publicModel) } }
export function parseContextWindow(value: string): number {
  const match = /^\s*(\d+(?:\.\d+)?)\s*([kKmM])?\s*$/.exec(value)
  if (!match) throw new Error("上下文请输入如128K、1M或整数")
  const n = Number(match[1]) * (match[2]?.toUpperCase() === "M" ? 1_000_000 : match[2]?.toUpperCase() === "K" ? 1000 : 1)
  if (!Number.isSafeInteger(n) || n < 1024 || n > 100_000_000) throw new Error("上下文范围应为1024至100M")
  return n
}
