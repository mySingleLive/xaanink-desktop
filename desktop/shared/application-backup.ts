import {z} from 'zod'
import {safeRelative,rootIdentitySchema} from '../core/root-ownership'
import {APPLICATION_BACKUP_LIMITS} from './application-backup-limits'
export {APPLICATION_BACKUP_LIMITS} from './application-backup-limits'

const sha=z.string().regex(/^[a-f0-9]{64}$/)
export const applicationBackupFileSchema=z.object({path:z.string().refine(safeRelative),size:z.number().int().nonnegative().max(APPLICATION_BACKUP_LIMITS.fileBytes),sha256:sha}).strict()
export const applicationBackupBodySchema=z.object({format:z.literal('xuanxiang-application-backup'),schemaVersion:z.literal(1),id:z.uuid(),appId:z.uuid(),createdAt:z.iso.datetime(),phase:z.enum(['captured','verified']),engine:z.object({pglite:z.string().min(1).max(40),postgresMajor:z.number().int().positive()}).strict(),files:z.array(applicationBackupFileSchema).max(APPLICATION_BACKUP_LIMITS.files),directories:z.array(z.string().refine(safeRelative)).max(APPLICATION_BACKUP_LIMITS.directories),bytes:z.number().int().nonnegative().max(APPLICATION_BACKUP_LIMITS.bytes)}).strict()
export const applicationBackupSchema=applicationBackupBodySchema.extend({checksum:sha}).strict()
export type ApplicationBackup=z.infer<typeof applicationBackupSchema>
const fileIdentity=z.object({device:z.string().regex(/^\d+$/),inode:z.string().regex(/^\d+$/)}).strict()
export const applicationCandidateBodySchema=z.object({format:z.literal('xuanxiang-application-candidate'),schemaVersion:z.literal(1),id:z.uuid(),appId:z.uuid(),backupId:z.uuid(),backupChecksum:sha,createdAt:z.iso.datetime(),phase:z.enum(['ready','cancelled']),directory:rootIdentitySchema,engine:z.object({pglite:z.string().min(1).max(40),postgresMajor:z.number().int().positive()}).strict(),migrations:z.array(z.object({id:z.string().min(1).max(200),checksum:sha}).strict()).max(1000),files:z.array(applicationBackupFileSchema.extend({identity:fileIdentity,revision:z.object({size:z.string().regex(/^\d+$/),mtimeNs:z.string().regex(/^\d+$/),ctimeNs:z.string().regex(/^\d+$/)}).strict()}).strict()).max(APPLICATION_BACKUP_LIMITS.files),directories:z.array(rootIdentitySchema).max(APPLICATION_BACKUP_LIMITS.directories),activation:z.object({operationId:z.uuid(),initialChecksum:sha,retentionChecksum:sha,barrierToken:z.uuid()}).strict().optional()}).strict()
export const applicationCandidateSchema=applicationCandidateBodySchema.extend({checksum:sha}).strict()
export type ApplicationRestoreCandidate=z.infer<typeof applicationCandidateSchema>
