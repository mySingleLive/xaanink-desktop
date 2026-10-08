import {z} from 'zod'
export const workRestoreRequestSchema=z.discriminatedUnion('type',[
 z.object({type:z.literal('start'),workId:z.uuid(),backupId:z.uuid()}).strict(),
 z.object({type:z.literal('retry')}).strict(),
])
export const restoreDraftAckSchema=z.object({sessionId:z.uuid(),token:z.uuid(),receipt:z.object({revision:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),clientRevision:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),digest:z.string().regex(/^[a-f0-9]{64}$/)}).strict()}).strict()
export type WorkRestoreRequest=z.infer<typeof workRestoreRequestSchema>
export type WorkRestoreResult='restarting'|'cancelled'|'pending'
export type RestoreDraftAck=z.infer<typeof restoreDraftAckSchema>
export interface WorkRestoreNotice{token:string;outcome:{status:'pending'}|{status:'activated'}|{status:'failed';message:string}}
