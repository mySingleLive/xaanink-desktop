import { z } from 'zod'
const id = z.string().min(1).max(256)
/** Keyless identity supplied by the trusted service invocation, never a renderer target. */
export const modelTaskSchema = z.object({ conversationId: id, turnId: id, attemptId: id }).strict()
export type ModelTask = z.infer<typeof modelTaskSchema>
export const reviewSelectionSchema = modelTaskSchema.omit({ conversationId: true }).extend({ type: z.literal('review-selection'), modelId: id }).strict()
