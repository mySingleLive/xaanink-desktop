import {z} from 'zod'
import {draftSnapshotSchema,draftReceiptSchema} from './drafts'
import {rootIdentitySchema} from '../core/root-ownership'
export const applicationRestoreSourceKindSchema=z.enum(['healthy','missing','closed-source'])
export type ApplicationRestoreSourceKind=z.infer<typeof applicationRestoreSourceKindSchema>
export const applicationClosedSourceSummarySchema=z.object({kind:z.literal('closed-source'),health:z.literal('not-verified'),id:z.uuid(),checksum:z.string().regex(/^[a-f0-9]{64}$/),directory:rootIdentitySchema,data:rootIdentitySchema}).strict()
export type ApplicationClosedSourceSummary=z.infer<typeof applicationClosedSourceSummarySchema>
export const APPLICATION_DRAFT_RETENTION_LIMITS={bytes:16*1024*1024,snapshots:128} as const
export const applicationDraftRetentionEntrySchema=z.object({id:z.uuid(),operationId:z.uuid(),candidateId:z.uuid(),origin:z.enum(['current','backup']),createdAt:z.iso.datetime(),snapshot:draftSnapshotSchema}).strict()
export const applicationDraftBarrierSchema=z.object({type:z.literal('application'),reason:z.literal('APPLICATION_RESTORED'),token:z.uuid(),phase:z.enum(['protected','checkpointed','complete']),firstCheckpoint:draftReceiptSchema.optional(),secondCheckpoint:draftReceiptSchema.optional()}).strict().refine(value=>value.phase==='protected'?!value.firstCheckpoint&&!value.secondCheckpoint:value.phase==='checkpointed'?!!value.firstCheckpoint&&!value.secondCheckpoint:!!value.firstCheckpoint&&!!value.secondCheckpoint)
export const applicationDraftRetentionBodySchema=z.object({format:z.literal('xuanxiang-application-draft-retention'),schemaVersion:z.literal(1),type:z.literal('application'),appId:z.uuid(),operationId:z.uuid(),candidateId:z.uuid(),reason:z.literal('APPLICATION_RESTORED'),currentRootAvailable:z.boolean(),createdAt:z.iso.datetime(),barrier:applicationDraftBarrierSchema,snapshots:z.array(applicationDraftRetentionEntrySchema).max(APPLICATION_DRAFT_RETENTION_LIMITS.snapshots)}).strict()
export const applicationDraftRetentionSchema=applicationDraftRetentionBodySchema.extend({checksum:z.string().regex(/^[a-f0-9]{64}$/)}).strict()
export type ApplicationDraftRetention=z.infer<typeof applicationDraftRetentionSchema>
/** Whole original snapshots, provenance and saved requests are display-only
 * recovery data. This helper exposes no save or execution transport. */
export function applicationDraftRecoveryItems(retention:ApplicationDraftRetention){return retention.snapshots.map(row=>({id:`application:${row.id}`,source:'application',path:[row.operationId,row.candidateId,row.origin,row.id].join('/'),reason:'APPLICATION_RESTORED' as const,createdAt:row.createdAt,value:structuredClone(row.snapshot)}))}
