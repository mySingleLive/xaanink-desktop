import type { NovelExportMetadata } from "./manuscript-export"

/** Shared wire format for ordered, current manuscript exports. */
export type OutlineExportKind = "content" | "outline"
export interface OutlineCollection extends NovelExportMetadata {
  novelId: string
  title: string
  kind: OutlineExportKind
  volumeId?: string
  volumes: {
    id: string
    index: number
    title: string
    summary: string
    chapters: { id: string; index: number; title: string; text: string }[]
  }[]
}

export interface OutlineDeletionPreview {
  revision: string
  volumeCount: number
  chapterCount: number
  wordCount: number
  finalizedCount: number
  chapterIds: string[]
}
export interface OutlineDeletionReceipt {
  operationId: string
  volumeIds: string[]
  chapterIds: string[]
}
