import {z} from 'zod'
const id=z.string().min(1).max(256)
export const conversationRequestOriginSchema=z.object({requestId:z.uuid(),nonce:z.uuid()}).strict()
export type ConversationRequestOrigin=z.infer<typeof conversationRequestOriginSchema>
export const conversationTaskTupleSchema=z.object({conversationId:id,turnId:id,attemptId:id,epoch:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)}).strict()
export type ConversationTaskTuple=z.infer<typeof conversationTaskTupleSchema>
const previousClaim=z.object({task:conversationTaskTupleSchema,claimId:z.uuid()}).strict()
export const conversationClaimSchema=z.object({origin:conversationRequestOriginSchema,task:conversationTaskTupleSchema,previous:previousClaim.optional()}).strict()
export const conversationClaimReceiptSchema=z.object({claimId:z.uuid()}).strict()
export const conversationReleaseSchema=z.object({origin:conversationRequestOriginSchema,task:conversationTaskTupleSchema,claimId:z.uuid()}).strict()
export const conversationChooseDirectorySchema=conversationReleaseSchema.extend({operationId:z.string().min(8).max(140),input:z.object({title:z.string().trim().min(1).max(100),premise:z.string().trim().min(1).max(500).optional(),requestId:z.string().min(8).max(140)}).strict()}).strict().refine(value=>value.operationId===value.input.requestId)
/** Worker/main only. The renderer cannot supply origin, claims, paths or leases. */
export const conversationDirectoryProofSchema=z.object({path:z.string().min(1).max(32768),device:z.string().regex(/^\d+$/),inode:z.string().regex(/^\d+$/)}).strict()
export const conversationCreateAdmissionSchema=conversationReleaseSchema.extend({operationId:z.string().min(8).max(140),selection:conversationDirectoryProofSchema}).strict()
export const conversationCreateAdmissionReceiptSchema=z.object({admissionId:z.uuid(),revocation:z.instanceof(SharedArrayBuffer).refine(value=>value.byteLength===Int32Array.BYTES_PER_ELEMENT)}).strict()
export const conversationCreateFinishedSchema=conversationReleaseSchema.extend({admissionId:z.uuid()}).strict()
