"use client"
import { useQuery } from '@tanstack/react-query'
import type { NovelSummary } from '@/components/content/types'
import type { UnavailableWork } from '@desktop/shared/work-list'

export interface NovelList<T = NovelSummary> { novels: T[]; unavailableWorks: UnavailableWork[] }

/** All observers must store the same envelope under the shared list key. */
export async function fetchNovelList<T = NovelSummary>(): Promise<NovelList<T>> {
  const response = await fetch('/api/novels')
  if (!response.ok) throw new Error('加载小说列表失败')
  const data = await response.json() as NovelList<T>
  if (!Array.isArray(data.novels) || (data.unavailableWorks !== undefined && !Array.isArray(data.unavailableWorks))) throw new Error('作品列表格式无效')
  return { novels: data.novels, unavailableWorks: data.unavailableWorks ?? [] }
}

export function useNovelList<T = NovelSummary>() {
  return useQuery({ queryKey: ['novels'], queryFn: () => fetchNovelList<T>() })
}

export function appendCreatedNovel<T extends { id: string }>(current: NovelList<T> | undefined, novel: T): NovelList<T> {
  if (current?.novels.some(row => row.id === novel.id)) return current
  return { novels: [...(current?.novels ?? []), novel], unavailableWorks: current?.unavailableWorks ?? [] }
}
