/** Semantic worker request. Network addresses and credentials are never accepted. */
export interface ImageGenerationRequest {
  id: string
  modelId: string
  authRevision: number
  prompt: string
  sizes?: readonly string[]
  watermark?: boolean
}
export interface ImageGenerationHeader { id: string; status: 200; headers: { 'content-type': string; 'content-length': string } }
