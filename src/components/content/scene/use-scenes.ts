"use client"
import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { useSceneUiStore } from "@/stores/scene-ui"
import { useChatStore } from "@/stores/chat"
import type { SceneFaction } from "@/lib/scene-context"
import { useStagedChangesStore } from "@/stores/staged-changes"
import { stagedDataFields } from "@/lib/staged-save"
import { apiGet } from "../api"
import type { SceneRecord } from "../types"
export function useScenes(novelId: string) {
 const query = useQuery({queryKey: ["scenes", novelId], queryFn: () => apiGet<{scenes: SceneRecord[]}>(`/api/novels/${novelId}/scenes`, "加载场景失败"), enabled: !!novelId})
 const account = useChatStore(s => s.accountId)
 const submissions = useSceneUiStore(s => s.submissions)
 const batches = useStagedChangesStore(s => s.batches)
 const pending = Object.values(submissions).filter(s => s.accountId === account && s.batch.novelId === novelId).flatMap(s => s.batch.changes)
 const changes = [...pending, ...Object.values(batches).filter(batch => batch.novelId === novelId).flatMap(b => b.changes).filter(c => c.targetKind === "SCENE")]
 const rows = useMemo(() => (query.data?.scenes ?? []).map(row => changes.filter(c => c.targetId === row.id && c.op === "modify").reduce((current, c) => ({...current, ...stagedDataFields(c.request.body)}) as SceneRecord, row)), [query.data, batches, submissions, account, novelId]) // eslint-disable-line react-hooks/exhaustive-deps
 return {...query, rows, baseRows: query.data?.scenes ?? [], changes}
}

export function useSceneFactions(novelId: string | null) {return useQuery({queryKey: ["scene-factions", novelId], queryFn: () => apiGet<{factions: (SceneFaction & {worldId?: string | null})[]}>(`/api/novels/${novelId}/scenes/factions`), enabled: !!novelId})}
