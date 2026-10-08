"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Loader2, Package, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { buildItemChip, startChipDrag } from "@/components/chat/chip-drag"
import { buildTabId, useTabsStore } from "@/stores/tabs"

import { apiGet, apiSend } from "./api"
import { ItemIcon } from "./ItemIcon"
import { itemLevelLabel, normalizeItemLevels } from "./item-levels"
import type { ContentPanelProps } from "./registry"
import { normalizeAliases, normalizeTags, type ItemRecord } from "./types"

/** 卡片等级 chip：金色调（与等级气泡/悬停卡同色系，取 --gold 语义令牌） */
function LevelChip({ label }: { label: string }) {
  return (
    <span className="inline-flex max-w-full items-center truncate rounded-full border border-gold/50 bg-gold/10 px-2 py-0.5 text-[11px] leading-none text-gold">
      {label}
    </span>
  )
}

/** 卡片标签 chip：accent 浅底小丸 */
function TagChip({ label }: { label: string }) {
  return (
    <span className="inline-flex max-w-full items-center truncate rounded-full border border-border bg-accent px-2 py-0.5 text-[11px] leading-none text-accent-foreground">
      {label}
    </span>
  )
}

/** 溢出计数 chip：虚线小丸「+N」 */
function MoreChip({ count }: { count: number }) {
  return (
    <span className="inline-flex items-center rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] leading-none text-muted-foreground">
      +{count}
    </span>
  )
}

/** 物品卡片列表（type=items） */
export function ItemsPanel({ novelId }: ContentPanelProps) {
  const queryClient = useQueryClient()
  const openTab = useTabsStore((s) => s.openTab)
  const closeTab = useTabsStore((s) => s.closeTab)

  const { data, isLoading, isError } = useQuery({
    queryKey: ["items", novelId],
    queryFn: () =>
      apiGet<{ items: ItemRecord[] }>(`/api/novels/${novelId}/items`, "加载物品失败"),
  })

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["items", novelId] })

  const createMutation = useMutation({
    mutationFn: () =>
      apiSend<{ item: ItemRecord }>(
        `/api/novels/${novelId}/items`,
        "POST",
        { name: "新物品" },
        "创建物品失败"
      ),
    onSuccess: ({ item }) => {
      invalidate()
      openItem(item)
      toast.success(`已创建物品「${item.name}」，点击编辑资料`)
    },
    onError: (err) => toast.error(err.message),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiSend(`/api/novels/${novelId}/items/${id}`, "DELETE", undefined, "删除失败"),
    onSuccess: (_data, id) => {
      closeTab(buildTabId("item", novelId, { refId: id }))
      invalidate()
      toast.success("物品已删除")
    },
    onError: (err) => toast.error(err.message),
  })

  const openItem = (item: Pick<ItemRecord, "id" | "name">) =>
    openTab({
      id: buildTabId("item", novelId, { refId: item.id }),
      type: "item",
      novelId,
      refId: item.id,
      title: item.name,
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
        物品加载失败，请稍后重试
      </div>
    )
  }

  const items = data?.items ?? []

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">物品管理</h2>
          <Button size="sm" disabled={createMutation.isPending} onClick={() => createMutation.mutate()}>
            {createMutation.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
            新建物品
          </Button>
        </div>

        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <Package className="size-10 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              还没有物品，点击「新建物品」创建第一个吧
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(240px,100%),1fr))] items-start gap-3">
            {items.map((item) => {
              const aliases = normalizeAliases(item.aliases)
              const tags = normalizeTags(item.tags)
              const levels = normalizeItemLevels(item.levels)
              return (
                <Card
                  key={item.id}
                  role="button"
                  tabIndex={0}
                  draggable
                  title="可拖拽到对话输入框引用该物品"
                  onClick={() => openItem(item)}
                  onDragStart={(e) =>
                    startChipDrag(e, buildItemChip({ name: item.name, iconUrl: item.iconUrl }))
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault()
                      openItem(item)
                    }
                  }}
                  className="group cursor-pointer py-0 transition-shadow hover:shadow-md"
                >
                  <CardContent className="flex flex-col px-3.5 py-3">
                    {/* 首行：44px 圆角方形图标位 + 名称 + 悬停删除钮 */}
                    <div className="flex items-center gap-2.5">
                      <ItemIcon name={item.name} iconUrl={item.iconUrl} iconCrop={item.iconCrop} />
                      <span className="min-w-0 flex-1 truncate font-medium">{item.name}</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`删除物品 ${item.name}`}
                        className="size-7 shrink-0 opacity-0 group-hover:opacity-100"
                        disabled={deleteMutation.isPending}
                        onClick={(e) => {
                          e.stopPropagation()
                          deleteMutation.mutate(item.id)
                        }}
                      >
                        <Trash2 className="size-3.5 text-muted-foreground" />
                      </Button>
                    </div>
                    {/* 别名行（空省略） */}
                    {aliases.length > 0 && (
                      <p className="mt-1.5 truncate text-xs text-muted-foreground">
                        {aliases.join(" / ")}
                      </p>
                    )}
                    {/* 简介两行截断 */}
                    <p className="mt-1 line-clamp-2 min-h-[2.6em] text-[12.5px] leading-[1.65] text-muted-foreground">
                      {item.description || "暂无介绍"}
                    </p>
                    {/* 等级行（≤2 + +N，金色 chip；空省略） */}
                    {levels.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-[5px]">
                        {levels.slice(0, 2).map((ref) => (
                          <LevelChip
                            key={`${ref.settingId} ${ref.pathway ?? ""} ${ref.level}`}
                            label={itemLevelLabel(ref)}
                          />
                        ))}
                        {levels.length > 2 && <MoreChip count={levels.length - 2} />}
                      </div>
                    )}
                    {/* 标签行（≤3 + +N；空省略，与等级行独立） */}
                    {tags.length > 0 && (
                      <div
                        className={cn(
                          "flex flex-wrap gap-[5px]",
                          levels.length > 0 ? "mt-[5px]" : "mt-2"
                        )}
                      >
                        {tags.slice(0, 3).map((tag) => (
                          <TagChip key={tag} label={tag} />
                        ))}
                        {tags.length > 3 && <MoreChip count={tags.length - 3} />}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
