"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Loader2, Plus, Trash2, Users } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import type { CharacterRoleType } from "@/generated/prisma/enums"
import { buildTabId, useTabsStore } from "@/stores/tabs"
import { buildCharacterChip, startChipDrag } from "@/components/chat/chip-drag"

import { apiGet, apiSend } from "./api"
import { CroppedImage } from "./CroppedImage"
import { CHARACTER_ROLE_LABELS } from "./labels"
import type { ContentPanelProps } from "./registry"
import { normalizeCrop, type CharacterRecord } from "./types"

const ROLE_ORDER: CharacterRoleType[] = ["PROTAGONIST", "SUPPORTING", "ANTAGONIST"]

/** 角色分组卡片列表（type=characters） */
export function CharactersPanel({ novelId }: ContentPanelProps) {
  const queryClient = useQueryClient()
  const openTab = useTabsStore((s) => s.openTab)
  const closeTab = useTabsStore((s) => s.closeTab)

  const { data, isLoading, isError } = useQuery({
    queryKey: ["characters", novelId],
    queryFn: () =>
      apiGet<{ characters: CharacterRecord[] }>(
        `/api/novels/${novelId}/characters`,
        "加载角色失败"
      ),
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["characters", novelId] })
    queryClient.invalidateQueries({ queryKey: ["novels"] })
    queryClient.invalidateQueries({ queryKey: ["novels", novelId] })
  }

  const createMutation = useMutation({
    mutationFn: (roleType: CharacterRoleType) =>
      apiSend<{ character: CharacterRecord }>(
        `/api/novels/${novelId}/characters`,
        "POST",
        { name: "新角色", roleType },
        "创建角色失败"
      ),
    onSuccess: ({ character }) => {
      invalidate()
      openCharacter(character)
      toast.success(`已创建角色「${character.name}」，点击编辑资料`)
    },
    onError: (err) => toast.error(err.message),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiSend(`/api/novels/${novelId}/characters/${id}`, "DELETE", undefined, "删除失败"),
    onSuccess: (_data, id) => {
      closeTab(buildTabId("character", novelId, { refId: id }))
      invalidate()
      toast.success("角色已删除")
    },
    onError: (err) => toast.error(err.message),
  })

  const openCharacter = (c: Pick<CharacterRecord, "id" | "name">) =>
    openTab({
      id: buildTabId("character", novelId, { refId: c.id }),
      type: "character",
      novelId,
      refId: c.id,
      title: c.name,
    })

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    )
  }
  if (isError) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        角色加载失败，请稍后重试
      </div>
    )
  }

  const characters = data?.characters ?? []

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">角色管理</h2>
          <Button
            size="sm"
            disabled={createMutation.isPending}
            onClick={() => createMutation.mutate("PROTAGONIST")}
          >
            {createMutation.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
            新建角色
          </Button>
        </div>

        {characters.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <Users className="size-10 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              还没有角色，点击「新建角色」创建第一个人物吧
            </p>
          </div>
        ) : (
          ROLE_ORDER.map((roleType) => {
            const group = characters.filter((c) => c.roleType === roleType)
            if (group.length === 0) return null
            return (
              <section key={roleType} className="flex flex-col gap-3">
                <h3 className="text-sm font-medium text-muted-foreground">
                  {CHARACTER_ROLE_LABELS[roleType]}（{group.length}）
                </h3>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {group.map((c) => (
                    <Card
                      key={c.id}
                      role="button"
                      tabIndex={0}
                      draggable
                      title="可拖拽到对话输入框引用该角色"
                      onClick={() => openCharacter(c)}
                      onDragStart={(e) => startChipDrag(e, buildCharacterChip({ name: c.name, avatarUrl: c.avatarUrl }))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault()
                          openCharacter(c)
                        }
                      }}
                      className="group cursor-pointer transition-shadow hover:shadow-md"
                    >
                      <CardContent className="flex flex-col gap-1.5 p-4">
                        <div className="flex items-center gap-2">
                          {c.avatarUrl && (
                            <span className="relative size-10 shrink-0 overflow-hidden rounded-full">
                              <CroppedImage
                                src={c.avatarUrl}
                                crop={normalizeCrop(c.avatarCrop)}
                                alt={c.name}
                              />
                            </span>
                          )}
                          <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`删除角色 ${c.name}`}
                            className="size-7 opacity-0 group-hover:opacity-100"
                            disabled={deleteMutation.isPending}
                            onClick={(e) => {
                              e.stopPropagation()
                              deleteMutation.mutate(c.id)
                            }}
                          >
                            <Trash2 className="size-3.5 text-muted-foreground" />
                          </Button>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {[c.age, c.occupation].filter(Boolean).join(" · ") || "资料待完善"}
                        </p>
                        <p className="line-clamp-2 text-sm text-muted-foreground">
                          {c.bio || c.personality || "暂无简介"}
                        </p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </section>
            )
          })
        )}
      </div>
    </div>
  )
}
