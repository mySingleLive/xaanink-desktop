import {z} from "zod"
// Renderer draft content is data only. Recovery never executes saved requests.
export const draftSnapshotSchema=z.object({
 version:z.literal(1),revision:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),createdAt:z.iso.datetime(),
 autosaves:z.array(z.object({id:z.uuid(),draft:z.unknown()}).strict()).max(4096),
 sources:z.object({staged:z.unknown().optional(),scene:z.unknown().optional(),chat:z.unknown().optional(),workspace:z.unknown().optional(),recovery:z.unknown().optional(),comments:z.unknown().optional()}).strict(),
 issues:z.array(z.object({source:z.union([z.enum(["staged","scene","chat","workspace","recovery","comments"]),z.uuid()]),code:z.literal("DRAFT_SOURCE_UNREADABLE")}).strict()).max(4102),
}).strict()
export type DraftSnapshot=z.infer<typeof draftSnapshotSchema>
export interface DraftReceipt {revision:number;digest:string;clientRevision:number}
export const draftReceiptSchema=z.object({revision:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),digest:z.string().regex(/^[a-f0-9]{64}$/),clientRevision:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)}).strict()
