"use client"

/**
 * 新建情景试验场对话框：标题 + 参演角色多选（添加/删除，选中后可切「AI 演 / 我来演」，至多一人我演）。
 * 场景与开场剧情仍在创建后的面板里配置（ConfigForm）。
 * 注意：Dialog 走 portal 渲染在 .scpane 之外，内部一律用 ui 组件与全局 Tailwind 令牌（不用 sc-* 作用域类）。
 */

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Bot, Loader2, UserRound } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { SCENARIO_CAST_MAX } from "@/lib/scenario-lab"
import { cn } from "@/lib/utils"

import type { CharacterRecord, NovelSummary } from "../content/types"

export interface ScenarioCreatePayload {
  title: string
  cast: { characterId: string; control: "ai" | "user" }[]
}

interface ScenarioCreateDialogProps {
  novel: NovelSummary
  open: boolean
  pending: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (payload: ScenarioCreatePayload) => void
}

interface CastDraft {
  characterId: string
  name: string
  control: "ai" | "user"
}

export function ScenarioCreateDialog({
  novel,
  open,
  pending,
  onOpenChange,
  onSubmit,
}: ScenarioCreateDialogProps) {
  const [title, setTitle] = useState("")
  const [cast, setCast] = useState<CastDraft[]>([])

  const charactersQuery = useQuery({
    queryKey: ["characters", novel.id],
    queryFn: async () => {
      const res = await fetch(`/api/novels/${novel.id}/characters`)
      if (!res.ok) throw new Error("加载角色失败")
      return (await res.json()) as { characters: CharacterRecord[] }
    },
    enabled: open,
  })

  const reset = () => {
    setTitle("")
    setCast([])
  }

  const handleOpenChange = (next: boolean) => {
    if (!next) reset()
    onOpenChange(next)
  }

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
        // 用户至多扮演一人：别人设为「我来演」时，原先的扮演者交还 AI
        if (control === "user" && m.control === "user") return { ...m, control: "ai" }
        return m
      })
    )
  }

  const characters = charactersQuery.data?.characters ?? []

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新建情景试验场</DialogTitle>
          <DialogDescription>
            一个试验场 = 一组角色 + 场景 + 可选开场剧情，AI 分角色扮演推演会发生什么。这里先起标题、挑角色；场景与开场剧情创建后在面板里配置。
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            const trimmed = title.trim()
            if (!trimmed) return
            onSubmit({
              title: trimmed,
              cast: cast.map((m) => ({ characterId: m.characterId, control: m.control })),
            })
            reset()
          }}
          className="flex flex-col gap-4"
        >
          <Input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="标题，如：雨夜客栈的相遇、如果张三提前知道真相"
            maxLength={100}
          />

          <div className="flex flex-col gap-1.5">
            <div className="text-xs font-medium text-muted-foreground">
              参演角色（已选 {cast.length}/{SCENARIO_CAST_MAX}，可选「我来演」其中一名；也可先不选，创建后再配）
            </div>
            {charactersQuery.isLoading ? (
              <div className="flex justify-center py-3 text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
              </div>
            ) : characters.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                这部小说还没有角色——可以先创建试验场，之后去角色面板建完再回来配置。
              </p>
            ) : (
              <div className="flex max-h-52 flex-col gap-1 overflow-y-auto pr-0.5">
                {characters.map((c) => {
                  const member = memberById.get(c.id)
                  const selected = Boolean(member)
                  return (
                    <div
                      key={c.id}
                      className={cn(
                        "flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 transition-colors",
                        selected ? "border-primary/40 bg-primary/5" : "border-border hover:bg-muted/50"
                      )}
                      onClick={() => toggleMember(c.id, c.name)}
                    >
                      <span
                        className={cn(
                          "flex size-[15px] shrink-0 items-center justify-center rounded border text-[10px] leading-none",
                          selected
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-input text-transparent"
                        )}
                      >
                        ✓
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[13px]">{c.name}</span>
                      {selected && member && (
                        <span
                          className="flex shrink-0 overflow-hidden rounded-full border border-input text-[11px]"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            className={cn(
                              "flex items-center gap-0.5 px-2 py-0.5",
                              member.control === "ai"
                                ? "bg-accent text-foreground"
                                : "text-muted-foreground"
                            )}
                            title="由 AI 扮演"
                            onClick={() => setControl(c.id, "ai")}
                          >
                            <Bot className="size-3" />
                            AI 演
                          </button>
                          <button
                            type="button"
                            className={cn(
                              "flex items-center gap-0.5 px-2 py-0.5",
                              member.control === "user"
                                ? "bg-accent text-foreground"
                                : "text-muted-foreground"
                            )}
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

          <DialogFooter>
            <Button type="submit" disabled={!title.trim() || pending}>
              {pending && <Loader2 className="animate-spin" />}
              创建
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
