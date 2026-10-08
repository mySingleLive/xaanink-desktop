import {z} from 'zod'
import {APPLICATION_BACKUP_LIMITS as limits} from './application-backup-limits'
export const applicationBackupActionSchema=z.discriminatedUnion('type',[
 z.object({type:z.literal('now'),retention:z.number().int().min(1).max(limits.packages)}).strict(),
 z.object({type:z.literal('list')}).strict(),
])
export type ApplicationBackupAction=z.infer<typeof applicationBackupActionSchema>
export const applicationBackupSummarySchema=z.object({id:z.uuid(),appId:z.uuid(),createdAt:z.iso.datetime(),bytes:z.number().int().nonnegative().max(limits.bytes)}).strict()
export const applicationBackupControlResultSchema=z.discriminatedUnion('type',[
 z.object({type:z.literal('list'),backups:z.array(applicationBackupSummarySchema).max(limits.packages)}).strict(),
 z.object({type:z.literal('now'),backup:applicationBackupSummarySchema.extend({retained:z.array(z.uuid()).max(limits.packages),cleanupPending:z.number().int().nonnegative().max(limits.packages)}).strict()}).strict(),
])
export type ApplicationBackupSummary=z.infer<typeof applicationBackupSummarySchema>
export type ApplicationBackupControlResult=z.infer<typeof applicationBackupControlResultSchema>
