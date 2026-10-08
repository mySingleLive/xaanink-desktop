import { z } from "zod"
import type { WizardTemplate } from "../../src/lib/creation-wizard/taxonomy"

export const MAX_TEMPLATE_FILE_BYTES = 4 * 1024 * 1024
export const templateIdSchema = z.string().min(1).max(100).regex(/^[a-z0-9_.-]+$/)
export const templateSourceSchema = z.enum(["builtin", "customized", "user"])
export type TemplateSource = z.infer<typeof templateSourceSchema>
export const promptInputSchema = z.object({ key: templateIdSchema, name: z.string().trim().min(1).max(100), content: z.string().min(1).max(256 * 1024), variables: z.array(z.string().min(1).max(50)).max(200).optional(), enabled: z.boolean().default(true) }).strict()
export const wizardTemplateSchema: z.ZodType<WizardTemplate> = z.object({ id: templateIdSchema, cat: z.enum(["theme", "world", "character", "plot"]), title: z.string().trim().min(1).max(100), summary: z.string().max(2000), channels: z.array(z.string().min(1).max(100)).max(50), genres: z.array(z.string().min(1).max(100)).max(100), tags: z.array(z.string().min(1).max(100)).max(200), lengths: z.array(z.string().min(1).max(100)).max(50).optional(), archetype: z.string().max(100).optional(), prompt: z.string().min(1).max(256 * 1024) }).strict()
export const wizardInputSchema = z.object({ template: wizardTemplateSchema, enabled: z.boolean().default(true) }).strict()
const version = z.number().int().min(1).max(2147483647)
export const portablePromptSchema = promptInputSchema.extend({ version, source: templateSourceSchema }).strict()
export const portableWizardSchema = wizardInputSchema.extend({ version, source: templateSourceSchema }).strict()
export const templateDocumentSchema = z.object({ format: z.enum(["xuanxiang-local-templates", "xaanink-local-templates"]), schemaVersion: z.literal(1), prompts: z.array(portablePromptSchema).max(1000), wizardTemplates: z.array(portableWizardSchema).max(2000) }).strict()
export type TemplateDocument = z.infer<typeof templateDocumentSchema>
export interface LocalPromptItem { id: string; key: string; name: string; content: string; variables: string[]; version: number; enabled: boolean; updatedAt: string; source: TemplateSource }
export interface LocalWizardItem { template: WizardTemplate; version: number; enabled: boolean; source: TemplateSource }
export interface TemplateLibrarySnapshot { revision: number; prompts: LocalPromptItem[]; wizardTemplates: LocalWizardItem[] }
export interface TemplateImportEntry { kind: "prompt" | "wizard"; id: string; name: string; conflict: boolean; existingVersion: number | null; incomingVersion: number }
export interface TemplateImportPreview { baseRevision: number; document: TemplateDocument; entries: TemplateImportEntry[] }
export interface TemplateImportChoice { kind: "prompt" | "wizard"; id: string; action: "keep" | "add" | "replace" | "copy"; copyId?: string }
export const templateImportChoiceSchema = z.object({ kind: z.enum(["prompt", "wizard"]), id: templateIdSchema, action: z.enum(["keep", "add", "replace", "copy"]), copyId: templateIdSchema.optional() }).strict()
