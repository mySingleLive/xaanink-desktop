"use client"
import { useEffect } from "react"
import type { TextReceipt } from "@/lib/services/target-text"

export interface CommentSaveCoordinator {
  identity: object
  flush(): Promise<void>
  revision(): number
  read(): { text: string; version: number | null; updatedAt?: string }
  pause(): void
  receive(receipt: TextReceipt, text: string, localRevision: number): void
  conflict(message: string): void
}
const editors = new Map<string, Set<CommentSaveCoordinator>>()
const keyFor = (novelId: string, targetType: string, targetId: string) => `${novelId}:${targetType}:${targetId}`

/** 评审/编辑/预览共享同一已挂载编辑器的保存边界；卸载立即移除，跨目标不复用。 */
export function useRegisterCommentSave(novelId: string, targetType: string, targetId: string, coordinator: CommentSaveCoordinator) {
  useEffect(() => {
    const key = keyFor(novelId, targetType, targetId)
    const group = editors.get(key) ?? new Set<CommentSaveCoordinator>()
    group.add(coordinator); editors.set(key, group)
    return () => { group.delete(coordinator); if (!group.size) editors.delete(key) }
  }, [novelId, targetType, targetId, coordinator])
}
export function commentEditors(novelId: string, targetType: string, targetId: string) { return [...(editors.get(keyFor(novelId, targetType, targetId)) ?? [])] }
