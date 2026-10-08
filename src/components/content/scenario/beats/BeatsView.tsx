"use client"

/**
 * 情景试验场·分镜视图：分镜卡网格（由主干 AI 整理派生）。
 * 顶部「整理成分镜」全量重排；卡双击改文本、⋯ 删除。
 * 轻量版：无拖拽调序、无出图（列 v2）。
 */

import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Clapperboard, Loader2, MoreHorizontal, Sparkles, Trash2 } from "lucide-react"
import { toast } from "sonner"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

import { apiSend } from "../../api"
import { Button } from "@/components/ui/button"
import { invalidateScenarioDetail, useNovelScenes } from "../queries"
import type { ScenarioCardRecord, ScenarioDetail } from "../types"

interface BeatsViewProps {
  novelId: string
  labId: string
  detail: ScenarioDetail
}

export function BeatsView({ novelId, labId, detail }: BeatsViewProps) {
  const queryClient = useQueryClient()
  const { scenario: lab, nodes, cards } = detail
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState("")

  const scenesQuery = useNovelScenes(novelId)
  const characterNameById = new Map(lab.cast.map((m) => [m.characterId, m.name] as const))
  const sceneNameById = new Map(
    (scenesQuery.data?.scenes ?? []).map((s) => [s.id, s.name] as const)
  )

  const organizeMutation = useMutation({
    mutationFn: () =>
      apiSend<{ cards: ScenarioCardRecord[] }>(
        `/api/novels/${novelId}/scenarios/${labId}/organize`,
        "POST",
        undefined,
        "整理分镜失败"
      ),
    onSuccess: (data) => {
      toast.success(`已整理出 ${data.cards.length} 张分镜卡`)
      invalidateScenarioDetail(queryClient, labId)
    },
    onError: (err) => toast.error(err.message),
  })

  const updateMutation = useMutation({
    mutationFn: ({ cardId, text }: { cardId: string; text: string }) =>
      apiSend(
        `/api/novels/${novelId}/scenarios/${labId}/cards/${cardId}`,
        "PATCH",
        { text },
        "保存分镜卡失败"
      ),
    onSuccess: () => invalidateScenarioDetail(queryClient, labId),
    onError: (err) => toast.error(err.message),
  })

  const deleteMutation = useMutation({
    mutationFn: (cardId: string) =>
      apiSend(
        `/api/novels/${novelId}/scenarios/${labId}/cards/${cardId}`,
        "DELETE",
        undefined,
        "删除分镜卡失败"
      ),
    onSuccess: () => invalidateScenarioDetail(queryClient, labId),
    onError: (err) => toast.error(err.message),
  })

  const commitEdit = (card: ScenarioCardRecord) => {
    setEditingId(null)
    const text = editDraft.trim()
    if (text && text !== card.text) updateMutation.mutate({ cardId: card.id, text })
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 px-4 py-2">
        <span className="text-[11.5px] text-muted-foreground">
          {cards.length} 张分镜卡 · 从 {nodes.length} 个情节点整理
        </span>
        <div className="flex-1" />
        <Button
          size="sm"
          variant="outline"
          disabled={nodes.length === 0 || organizeMutation.isPending}
          title={nodes.length === 0 ? "先推进几回合长出情节点" : "按当前主干重新整理（全量替换）"}
          onClick={() => {
            if (cards.length > 0 && !window.confirm("将按当前主干重新整理，现有分镜卡会被全部替换。继续？"))
              return
            organizeMutation.mutate()
          }}
        >
          {organizeMutation.isPending ? (
            <Loader2 className="animate-spin" />
          ) : (
            <Sparkles className="size-3.5" />
          )}
          整理成分镜
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {cards.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-[13px] text-muted-foreground">
            <Clapperboard className="size-7 text-muted-foreground/50" />
            还没有分镜卡——点右上角「整理成分镜」，AI 会把主干情节点排成一组镜头。
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
            {cards.map((card, i) => (
              <div key={card.id} className="sc-card group">
                <div className="flex items-center gap-1.5">
                  <span className="sc-node-no">{i + 1}</span>
                  <div className="flex-1" />
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <button
                          type="button"
                          aria-label="分镜卡操作"
                          className="flex size-5 items-center justify-center rounded text-muted-foreground opacity-0 hover:bg-hover-wash group-hover:opacity-100 data-popup-open:opacity-100"
                        />
                      }
                    >
                      <MoreHorizontal className="size-3.5" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-auto min-w-24">
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => deleteMutation.mutate(card.id)}
                      >
                        <Trash2 />
                        删除
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                {editingId === card.id ? (
                  <textarea
                    autoFocus
                    value={editDraft}
                    onChange={(e) => setEditDraft(e.target.value)}
                    onBlur={() => commitEdit(card)}
                    onKeyDown={(e) => {
                      if (e.nativeEvent.isComposing) return
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault()
                        commitEdit(card)
                      } else if (e.key === "Escape") {
                        setEditingId(null)
                      }
                    }}
                    rows={4}
                    className="mt-1 w-full resize-none rounded-inner border border-input bg-chat-surface px-1.5 py-1 text-[12.5px] leading-relaxed outline-none focus:border-primary"
                  />
                ) : (
                  <p
                    className="mt-1 cursor-text text-[12.5px] leading-relaxed"
                    title="双击编辑"
                    onDoubleClick={() => {
                      setEditDraft(card.text)
                      setEditingId(card.id)
                    }}
                  >
                    {card.text}
                  </p>
                )}
                {(card.characterIds.length > 0 || card.sceneIds.length > 0) && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {card.characterIds.map((id) => (
                      <span key={id} className="sc-chip on">
                        {characterNameById.get(id) ?? "已删除角色"}
                      </span>
                    ))}
                    {card.sceneIds.map((id) => (
                      <span key={id} className="sc-chip">
                        {sceneNameById.get(id) ?? "已删除场景"}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
