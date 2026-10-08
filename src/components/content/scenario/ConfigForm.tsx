"use client"

/**
 * 情景试验场配置表单：参演角色（多选 + 每个角色「AI 演 / 我来演」）+ 参演场景多选 + 开场剧情。
 * draft 态由聊天视图内联展示；active 后经面板头部「配置」按钮以浮层打开，改动影响后续回合。
 * 保存 = PATCH /api/novels/[id]/scenarios/[labId]（服务端 resolveScenarioCast 兜底校验）。
 */

import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Bot, Loader2, UserRound, X } from "lucide-react"
import { toast } from "sonner"

import { SCENARIO_CAST_MAX, SCENARIO_SCENES_MAX } from "@/lib/scenario-lab"
import { cn } from "@/lib/utils"
import { sceneForest } from "@/lib/scene-tree"

import { apiSend } from "../api"
import { Button } from "@/components/ui/button"
import { invalidateScenarioDetail, useNovelCharacters, useNovelScenes } from "./queries"
import type { ScenarioCastMember, ScenarioLabRecord } from "./types"

interface ConfigFormProps {
  novelId: string
  lab: ScenarioLabRecord
  onClose: () => void
}

export function ConfigForm({ novelId, lab, onClose }: ConfigFormProps) {
  const queryClient = useQueryClient()
  const charactersQuery = useNovelCharacters(novelId)
  const scenesQuery = useNovelScenes(novelId)

  const [cast, setCast] = useState<ScenarioCastMember[]>(lab.cast)
  const [sceneIds, setSceneIds] = useState<string[]>(lab.sceneIds)
  const [premise, setPremise] = useState(lab.premise)

  const saveMutation = useMutation({
    mutationFn: () =>
      apiSend<{ scenario: ScenarioLabRecord }>(
        `/api/novels/${novelId}/scenarios/${lab.id}`,
        "PATCH",
        {
          cast: cast.map((m) => ({ characterId: m.characterId, control: m.control })),
          sceneIds,
          premise: premise.trim(),
        },
        "保存配置失败"
      ),
    onSuccess: () => {
      toast.success("配置已保存")
      invalidateScenarioDetail(queryClient, lab.id)
      onClose()
    },
    onError: (err) => toast.error(err.message),
  })

  const characters = charactersQuery.data?.characters ?? []
  const scenes = scenesQuery.data?.scenes ?? []
  const forest = sceneForest(scenes)
  const memberById = new Map(cast.map((m) => [m.characterId, m]))

  const toggleMember = (characterId: string, name: string) => {
    setCast((prev) => {
      const existing = prev.find((m) => m.characterId === characterId)
      if (existing) return prev.filter((m) => m.characterId !== characterId)
      if (prev.length >= SCENARIO_CAST_MAX) return prev
      return [...prev, { characterId, name, control: "ai" }]
    })
  }

  const setControl = (characterId: string, control: "ai" | "user") => {
    setCast((prev) =>
      prev.map((m) => {
        if (m.characterId === characterId) return { ...m, control }
        // 用户至多扮演一人：别人设为「我演」时，原先的扮演者交还 AI
        if (control === "user" && m.control === "user") return { ...m, control: "ai" }
        return m
      })
    )
  }

  const toggleScene = (sceneId: string) => {
    setSceneIds((prev) => {
      if (prev.includes(sceneId)) return prev.filter((id) => id !== sceneId)
      if (prev.length >= SCENARIO_SCENES_MAX) return prev
      return [...prev, sceneId]
    })
  }

  return (
    <div className="sc-config" data-testid="scenario-config">
      <div className="flex items-center gap-2">
        <h2 className="font-serif text-[15px] font-bold">试验场配置</h2>
        <span className="text-[11.5px] text-muted-foreground">
          {cast.length} 角色 · {sceneIds.length} 场景
        </span>
        <div className="flex-1" />
        <button
          type="button"
          aria-label="关闭配置"
          onClick={onClose}
          className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-hover-wash"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="sc-config-section">
        <div className="sc-config-label">
          参演角色（{cast.length}/{SCENARIO_CAST_MAX}，可选「我来演」其中一名）
        </div>
        {charactersQuery.isLoading ? (
          <div className="flex justify-center py-3 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
          </div>
        ) : characters.length === 0 ? (
          <p className="text-xs text-muted-foreground">这部小说还没有角色，先去角色面板建几个。</p>
        ) : (
          <div className="flex flex-col gap-1">
            {characters.map((c) => {
              const member = memberById.get(c.id)
              const selected = Boolean(member)
              return (
                <div
                  key={c.id}
                  className={cn("sc-cast-row", selected && "on")}
                  onClick={() => toggleMember(c.id, c.name)}
                >
                  <span className={cn("sc-cast-check", selected && "on")}>
                    {selected ? "✓" : ""}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px]">{c.name}</span>
                  {selected && member && (
                    <span
                      className="flex shrink-0 overflow-hidden rounded-full border border-(--chat-line-strong) text-[11px]"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        className={cn("sc-cast-ctl", member.control === "ai" && "on")}
                        title="由 AI 扮演"
                        onClick={() => setControl(c.id, "ai")}
                      >
                        <Bot className="size-3" />
                        AI 演
                      </button>
                      <button
                        type="button"
                        className={cn("sc-cast-ctl", member.control === "user" && "on")}
                        title="由我扮演"
                        onClick={() => setControl(c.id, "user")}
                      >
                        <UserRound className="size-3" />
                        我来演
                      </button>
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="sc-config-section">
        <div className="sc-config-label">
          参演场景（{sceneIds.length}/{SCENARIO_SCENES_MAX}）
        </div>
        {scenesQuery.isLoading ? (
          <div className="flex justify-center py-3 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
          </div>
        ) : scenes.length === 0 ? (
          <p className="text-xs text-muted-foreground">这部小说还没有场景，先去场景面板建一个。</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {forest.cards.map((s) => {
              const selected = sceneIds.includes(s.id)
              return (
                <button
                  key={s.id}
                  type="button"
                  className={cn("sc-chip max-w-full text-left", selected && "on")}
                  title={forest.path(s.id)}
                  aria-label={forest.path(s.id)}
                  aria-pressed={selected}
                  onClick={() => toggleScene(s.id)}
                >
                  <span className="break-words">{forest.path(s.id)}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      <div className="sc-config-section">
        <div className="sc-config-label">开场剧情（可选——留白则由导演自然切入）</div>
        <textarea
          value={premise}
          onChange={(e) => setPremise(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="如：雨夜，三人先后走进同一家客栈，桌上放着一封没有署名的信……"
          className="w-full resize-y rounded-inner border border-input bg-chat-surface px-2.5 py-2 text-[13px] leading-relaxed outline-none focus:border-primary"
        />
      </div>

      <div className="flex items-center gap-2">
        <Button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          size="sm"
        >
          {saveMutation.isPending && <Loader2 className="animate-spin" />}
          保存配置
        </Button>
        {(lab.status === "draft" || cast.length === 0 || sceneIds.length === 0) && (
          <span className="text-[11.5px] text-muted-foreground">
            开局需要至少 1 名角色与 1 个场景
          </span>
        )}
      </div>
    </div>
  )
}
