import {z} from 'zod'
import {DataRootManager,rootAuthorityFileSchema} from '../core/data-root'
import {rootIdentitySchema} from '../core/root-ownership'
import {draftReceiptSchema} from './drafts'

export const APPLICATION_RESTORE_REQUEST_LIMITS={operations:16,controls:512,requestBytes:512*1024,phaseBytes:256*1024} as const
export const applicationRestoreRequestPhaseSchema=z.enum(['prepared','armed','executing','activated','consumed','cancelled','unknown'])
const pointer=z.unknown().transform(value=>DataRootManager.parsePointer(value))
export const applicationRestoreSelectionSchema=z.object({backup:z.object({directory:rootIdentitySchema,backupId:z.uuid()}).strict(),parent:rootIdentitySchema}).strict()
export const applicationRestoreProcessSchema=z.object({pid:z.number().int().positive().max(2**31-1),instanceNonce:z.uuid(),startedAt:z.iso.datetime()}).strict()
export const applicationRestoreExecutionSchema=z.object({attemptId:z.uuid(),ownerNonce:z.uuid(),process:applicationRestoreProcessSchema}).strict()
export const applicationRestoreActivationWitnessSchema=z.object({receiptId:z.uuid(),receiptFile:rootAuthorityFileSchema,pointer,pointerFile:rootAuthorityFileSchema,candidateId:z.uuid(),barrierToken:z.uuid()}).strict()
export const applicationRestoreCheckpointKindSchema=z.enum(['first-checkpoint','checkpointed-session-restart','completed-barrier-restart'])
export const applicationRestoreCheckpointWitnessSchema=z.object({kind:applicationRestoreCheckpointKindSchema,receipt:draftReceiptSchema,sessionId:z.uuid(),journalFile:rootAuthorityFileSchema,retentionFile:rootAuthorityFileSchema,snapshotChecksum:z.string().regex(/^[a-f0-9]{64}$/),recoveryChecksum:z.string().regex(/^[a-f0-9]{64}$/)}).strict()
export const applicationRestoreRequestBodySchema=z.object({
 operationId:z.uuid(),ownerNonce:z.uuid(),oldProcess:applicationRestoreProcessSchema,source:pointer,sourcePointerFile:rootAuthorityFileSchema,
 backup:z.object({directory:rootIdentitySchema,backupId:z.uuid(),appId:z.uuid(),checksum:z.string().regex(/^[a-f0-9]{64}$/),receiptFile:rootAuthorityFileSchema}).strict(),
 parent:rootIdentitySchema,createdAt:z.iso.datetime(),phase:applicationRestoreRequestPhaseSchema,
 execution:applicationRestoreExecutionSchema.optional(),activation:applicationRestoreActivationWitnessSchema.optional(),firstCheckpoint:applicationRestoreCheckpointWitnessSchema.optional(),secondCheckpoint:applicationRestoreCheckpointWitnessSchema.optional(),
 reason:z.enum(['IO_PENDING','WORKER_EXIT','COMMIT_UNCERTAIN','CONTROL_UNCERTAIN']).optional(),
}).strict().superRefine((request,context)=>{
 const forbidden={prepared:['execution','activation','firstCheckpoint','secondCheckpoint','reason'],armed:['execution','activation','firstCheckpoint','secondCheckpoint','reason'],executing:['secondCheckpoint','reason'],unknown:['secondCheckpoint'],activated:['secondCheckpoint','reason'],consumed:['reason'],cancelled:['activation','firstCheckpoint','secondCheckpoint','reason']} as const
 const required={prepared:[],armed:[],executing:['execution'],unknown:['execution','reason'],activated:['execution','activation'],consumed:['execution','activation','firstCheckpoint','secondCheckpoint'],cancelled:[]} as const
 for(const field of forbidden[request.phase])if(request[field]!==undefined)context.addIssue({code:'custom',path:[field],message:'Field is invalid for this phase'})
 for(const field of required[request.phase])if(request[field]===undefined)context.addIssue({code:'custom',path:[field],message:'Field is required for this phase'})
 if(request.firstCheckpoint&&!request.activation)context.addIssue({code:'custom',path:['activation'],message:'Checkpoint attestation requires activation'})
 if(request.phase==='consumed'&&request.firstCheckpoint&&request.secondCheckpoint){
  const first=request.firstCheckpoint,second=request.secondCheckpoint
  if(second.receipt.revision<=first.receipt.revision||second.receipt.clientRevision<=first.receipt.clientRevision||first.kind!==second.kind||first.sessionId!==second.sessionId||first.recoveryChecksum!==second.recoveryChecksum)context.addIssue({code:'custom',path:['secondCheckpoint'],message:'Checkpoints must be one ordered actual session'})
 }
})
export const applicationRestorePhaseReferenceSchema=z.object({name:z.string().regex(/^application-recovery-phase-[0-9a-f-]{36}\.json$/),file:rootAuthorityFileSchema}).strict()
export const applicationRestoreRequestSchema=applicationRestoreRequestBodySchema.safeExtend({history:z.array(applicationRestorePhaseReferenceSchema).min(1).max(APPLICATION_RESTORE_REQUEST_LIMITS.controls)}).strict()
export const applicationRestoreRequestSnapshotSchema=z.object({schemaVersion:z.literal(1),revision:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),operations:z.array(applicationRestoreRequestSchema).max(APPLICATION_RESTORE_REQUEST_LIMITS.operations)}).strict()
export const applicationRestorePhaseRecordSchema=z.object({schemaVersion:z.literal(1),receiptId:z.uuid(),revision:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),kind:z.enum(['phase','first-checkpoint','checkpointed-session-restart','completed-barrier-restart']),previous:applicationRestorePhaseReferenceSchema.nullable(),request:applicationRestoreRequestBodySchema,createdAt:z.iso.datetime()}).strict()
export type ApplicationRestoreRequest=z.infer<typeof applicationRestoreRequestSchema>
export type ApplicationRestoreRequestSnapshot=z.infer<typeof applicationRestoreRequestSnapshotSchema>
export type ApplicationRestoreExecution=z.infer<typeof applicationRestoreExecutionSchema>
export type ApplicationRestoreActivationWitness=z.infer<typeof applicationRestoreActivationWitnessSchema>
export type ApplicationRestoreCheckpointWitness=z.infer<typeof applicationRestoreCheckpointWitnessSchema>
export type ApplicationRestoreProcess=z.infer<typeof applicationRestoreProcessSchema>
export type ApplicationRestoreSelection=z.infer<typeof applicationRestoreSelectionSchema>
