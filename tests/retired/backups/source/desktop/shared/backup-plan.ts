import {z} from 'zod'

// Shared with the original scheduler's VersionedStore; this is persisted
// success metadata, not an executable backup job or imported timer settings.
export const backupPlanSchema=z.object({lastSuccess:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable()}).strict()
export type BackupPlan=z.infer<typeof backupPlanSchema>
