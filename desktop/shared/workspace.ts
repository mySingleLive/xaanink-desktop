import {z} from 'zod'
export const workManifestSchema=z.object({schemaVersion:z.literal(1),id:z.uuid(),phase:z.enum(['creating','ready']),novelId:z.string().nullable(),title:z.string(),requestId:z.string(),requestHash:z.string(),createdAt:z.string()}).strict()
export type WorkManifest=z.infer<typeof workManifestSchema>
export const workspaceImagePattern=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(png|jpg|webp|gif)$/
