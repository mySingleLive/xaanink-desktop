import { z } from "zod"
import type { Settings } from "../core/settings"
export type ModelRole = "text" | "review" | "image"
export const taskDefaultsSchema = z.object({
  version: z.literal(1), revision: z.number().int().nonnegative(), capturedAt: z.iso.datetime(),
  textModelId: z.string().max(200).nullable(), mode: z.enum(["standard", "plan"]), thinking: z.string().max(30),
  reviewModelId: z.string().max(200).nullable(), imageModelId: z.string().max(200).nullable(),
}).strict()
export type TaskDefaults = Readonly<z.infer<typeof taskDefaultsSchema>>
export function freezeTaskDefaults(agent: Settings["agent"], revision: number): TaskDefaults {
  // Explicit fields prevent credentials or future mutable settings entering a
  // task record. The five primitive defaults share one committed revision.
  return Object.freeze(taskDefaultsSchema.parse({ version: 1, revision, capturedAt: new Date().toISOString(),
    textModelId: agent.textModelId, mode: agent.mode, thinking: agent.thinking,
    reviewModelId: agent.reviewModelId, imageModelId: agent.imageModelId }))
}
export function modelIdForRole(defaults: TaskDefaults, role: ModelRole, explicit?: string | null): string | null {
  return explicit !== undefined ? explicit : defaults[role === "image" ? "imageModelId" : role === "review" ? "reviewModelId" : "textModelId"]
}
export function restoreTaskDefaults(value: unknown): TaskDefaults | null {
  if (value === null || value === undefined) return null
  return Object.freeze(taskDefaultsSchema.parse(value))
}
export function overrideTaskDefaults(defaults: TaskDefaults, changes: { modelId?: string | null; thinkingEffort?: string | null; mode?: "standard" | "plan" }): TaskDefaults {
  return Object.freeze(taskDefaultsSchema.parse({ ...defaults,
    ...(changes.modelId !== undefined ? { textModelId: changes.modelId } : {}),
    ...(changes.thinkingEffort !== undefined ? { thinking: changes.thinkingEffort ?? "default" } : {}),
    ...(changes.mode !== undefined ? { mode: changes.mode } : {}),
  }))
}
/** Old records have no provenance for review/image defaults. Preserve their
 * explicit text choice; never retrofit today's global settings into history. */
export function legacyTaskDefaults(modelId: string | null, thinkingEffort: string | null): TaskDefaults {
  return Object.freeze(taskDefaultsSchema.parse({ version: 1, revision: 0, capturedAt: new Date(0).toISOString(),
    textModelId: modelId, thinking: thinkingEffort ?? "default", mode: "standard", reviewModelId: null, imageModelId: null }))
}
