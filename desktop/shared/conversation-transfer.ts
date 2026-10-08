import {z} from 'zod'
const id=z.string().min(1).max(256),operation=z.string().min(8).max(140),revision=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
export const conversationLocationSchema=z.object({version:z.literal(1),conversationId:id,userId:z.literal('local-author'),workspaceId:id,novelId:id.nullable(),revision,historicalTransfers:z.array(operation).max(10_000),deleted:z.boolean()}).strict()
export type ConversationLocation=z.infer<typeof conversationLocationSchema>
export const conversationAssociationSchema=z.object({operationId:operation,novelId:id.nullable(),expectedLocationRevision:revision}).strict()
export type ConversationAssociation=z.infer<typeof conversationAssociationSchema>
export const conversationAssociationCommandSchema=z.object({conversationId:id,targetNovelId:id.nullable(),operationId:operation,expectedLocationRevision:revision}).strict()
export const conversationDirectoryRequestSchema=z.object({conversationId:id,operationId:operation,input:z.object({title:z.string().trim().min(1).max(100),premise:z.string().trim().min(1).max(500).optional(),requestId:operation}).strict()}).strict().refine(value=>value.operationId===value.input.requestId)
export type ConversationDirectoryRequest=z.infer<typeof conversationDirectoryRequestSchema>
export const createdConversationWorkSchema=z.object({workspaceId:z.uuid(),novelId:id,receipt:z.object({id,name:z.string().optional(),title:z.string(),status:z.string(),currentStage:z.string(),createdAt:z.string(),updatedAt:z.string()}).strict()}).strict().refine(value=>value.novelId===value.receipt.id)
export type CreatedConversationWork=z.infer<typeof createdConversationWorkSchema>
export const transferJournalSchema=z.object({version:z.literal(1),conversationId:id,userId:z.literal('local-author'),operationId:operation,requestHash:z.string().regex(/^[a-f0-9]{64}$/),source:conversationLocationSchema,target:z.object({workspaceId:id,novelId:id.nullable()}).strict().nullable(),phase:z.enum(['authorizing','prepared','copied','committed','cleanup-pending','complete','cancelled']),creationInput:conversationDirectoryRequestSchema.shape.input.optional(),creationReceipt:createdConversationWorkSchema.optional(),bundle:z.json().optional(),bundleDigest:z.string().regex(/^[a-f0-9]{64}$/).optional(),cleanupCode:z.enum(['SOURCE_CHANGED','SOURCE_UNAVAILABLE']).optional(),createdAt:z.iso.datetime(),updatedAt:z.iso.datetime()}).strict()
export type ConversationTransferJournal=z.infer<typeof transferJournalSchema>
