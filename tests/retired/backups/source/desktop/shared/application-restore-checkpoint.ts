import {z} from 'zod'
import {draftReceiptSchema} from './drafts'

export const applicationRestoreDraftConfirmationSchema=z.object({sessionId:z.uuid(),token:z.uuid(),phase:z.enum(['first','complete']),receipt:draftReceiptSchema}).strict()
export type ApplicationRestoreDraftConfirmation=z.infer<typeof applicationRestoreDraftConfirmationSchema>
export interface ApplicationRestoreProtectionNotice {token:string;afterRevision:number}
