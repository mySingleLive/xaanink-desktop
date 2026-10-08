import {z} from 'zod'
export const applicationRestoreHandoffCommandSchema=z.union([
 z.object({type:z.literal('status')}).strict(),
 z.object({type:z.literal('select'),backupId:z.uuid()}).strict(),
 z.object({type:z.enum(['start','cancel']),operationId:z.uuid()}).strict(),
])
export type ApplicationRestoreHandoffCommand=z.infer<typeof applicationRestoreHandoffCommandSchema>
export const applicationRestoreHandoffStateSchema=z.object({phase:z.enum(['idle','selecting','prepared','closing','armed','inspection']),operationId:z.uuid().nullable(),backupId:z.uuid().nullable(),targetPath:z.string().max(8192).nullable()}).strict()
export type ApplicationRestoreHandoffState=z.infer<typeof applicationRestoreHandoffStateSchema>
