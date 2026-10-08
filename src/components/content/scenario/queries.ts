/**
 * 情景试验场面板共享的 react-query hooks 与缓存失效助手。
 * characters/scenes 的 queryFn 与既有面板（CharactersPanel/ScenesPanel）
 * 逐字一致，命中共享缓存零额外请求。
 */

import { useQuery, type QueryClient } from "@tanstack/react-query"

import { apiGet } from "../api"
import type { CharacterRecord, SceneRecord } from "../types"
import type { ScenarioDetail } from "./types"

/** 试验场详情：lab + 回合 + 主干节点 + 分镜卡（一次取） */
export function useScenarioDetail(novelId: string, labId: string | undefined) {
  return useQuery({
    queryKey: ["scenario", labId],
    queryFn: () =>
      apiGet<ScenarioDetail>(`/api/novels/${novelId}/scenarios/${labId}`, "加载情景试验场失败"),
    enabled: !!labId,
  })
}

export function invalidateScenarioDetail(queryClient: QueryClient, labId: string) {
  queryClient.invalidateQueries({ queryKey: ["scenario", labId] })
  // 侧栏树试验场分组带 turnCount 角标
  queryClient.invalidateQueries({ queryKey: ["scenarios"] })
}

/** 角色全量记录（与 CharactersPanel 共享缓存；配置参演名单用） */
export function useNovelCharacters(novelId: string) {
  return useQuery({
    queryKey: ["characters", novelId],
    queryFn: () =>
      apiGet<{ characters: CharacterRecord[] }>(
        `/api/novels/${novelId}/characters`,
        "加载角色失败"
      ),
  })
}

/** 场景列表（与 ScenesPanel 共享缓存；配置参演场景用） */
export function useNovelScenes(novelId: string) {
  return useQuery({
    queryKey: ["scenes", novelId],
    queryFn: () =>
      apiGet<{ scenes: SceneRecord[] }>(`/api/novels/${novelId}/scenes`, "加载场景失败"),
  })
}
