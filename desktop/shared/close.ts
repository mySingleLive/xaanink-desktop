import {z} from "zod"
import {draftSnapshotSchema} from "./drafts"
export const draftReceiptSchema=z.object({revision:z.number().int().positive(),digest:z.string().regex(/^[a-f0-9]{64}$/),clientRevision:z.number().int().nonnegative()}).strict()
export const closeReplySchema=z.discriminatedUnion("status",[
 z.object({status:z.literal("saved"),receipt:draftReceiptSchema}).strict(),
 z.object({status:z.literal("failed")}).strict(),
 z.object({status:z.literal("unmodified")}).strict(),
 z.object({status:z.literal("export"),snapshot:draftSnapshotSchema}).strict(),
])
export type CloseReply=z.infer<typeof closeReplySchema>
export interface PrepareClose {type:"prepare-close";id:string;sessionId:string;action:"flush"|"export";retryFailures:boolean}
