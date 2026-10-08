import {z} from 'zod'
export const workLeaseRequestSchema=z.discriminatedUnion('type',[
 z.object({type:z.literal('start'),workId:z.uuid()}).strict(),
 z.object({type:z.literal('retry')}).strict(),
])
export type WorkLeaseRequest=z.infer<typeof workLeaseRequestSchema>
export type WorkLeaseResult='restarting'|'pending'|'cancelled'
