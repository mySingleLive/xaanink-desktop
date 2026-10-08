"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Loader2, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"

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
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ALIAS_MAX, ALIASES_MAX } from "@/lib/aliases"
import { ITEM_TAG_MAX, ITEM_TAGS_MAX } from "@/lib/item-tags"
import { buildTabId, useTabsStore } from "@/stores/tabs"

import { apiGet, apiSend } from "./api"
import { BubbleInput } from "./BubbleInput"
import { EntityAttributesEditor } from "./EntityAttributesEditor"
import { ItemIcon } from "./ItemIcon"
import { ItemLevelPicker } from "./ItemLevelPicker"
import { normalizeItemLevels, type ItemLevelRef } from "./item-levels"
import type { ContentPanelProps } from "./registry"
import {
  normalizeAliases,
  normalizeEntityAttributes,
  normalizeTags,
  type EntityAttributeItem,
  type ItemEffect,
  type ItemRecord,
} from "./types"
import { SaveStatusIndicator, useAutosave } from "./use-autosave"

/** 功效条数/单条长度上限（与 item-schema 的 itemEffectSchema 一致） */
const EFFECTS_MAX = 20
const EFFECT_NAME_MAX = 30
const EFFECT_DESCRIPTION_MAX = 500

interface ItemForm {
  name: string
  aliases: string[]
  tags: string[]
  levels: ItemLevelRef[]
  description: string
  appearance: string
  acquisition: string
  effects: ItemEffect[]
  attributes: EntityAttributeItem[]
}

/** DB Json → 功效条目数组（宽容处理历史/异常数据，保留有一项非空的条目） */
function normalizeEffects(raw: unknown): ItemEffect[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    .map((x) => ({
      name: typeof x.name === "string" ? x.name : "",
      description: typeof x.description === "string" ? x.description : "",
    }))
    .filter((x) => x.name || x.description)
}

function toForm(item: ItemRecord): ItemForm {
  return {
    name: item.name,
    aliases: normalizeAliases(item.aliases),
    tags: normalizeTags(item.tags),
    levels: normalizeItemLevels(item.levels),
    description: item.description,
    appearance: item.appearance ?? "",
    acquisition: item.acquisition ?? "",
    effects: normalizeEffects(item.effects),
    attributes: normalizeEntityAttributes(item.attributes),
  }
}

/**
 * PATCH 是全量字段契约（patchItemSchema）：保存带上所有字段当前值。
 * 功效说明必填（itemEffectSchema description min(1)）：空说明条目不进载荷，
 * 否则整次保存 400。
 */
function toPayload(form: ItemForm) {
  return {
    name: form.name.trim(),
    aliases: form.aliases,
    tags: form.tags,
    levels: form.levels,
    description: form.description,
    appearance: form.appearance,
    acquisition: form.acquisition,
    effects: form.effects
      .map((e) => ({ name: e.name.trim(), description: e.description.trim() }))
      .filter((e) => e.description),
    attributes: form.attributes,
  }
}

function ItemFormEditor({
  novelId,
  item,
  onSaved,
  onDeleted,
}: {
  novelId: string
  item: ItemRecord
  onSaved: () => void
  onDeleted: () => void
}) {
  const openTab = useTabsStore((s) => s.openTab)
  const closeTab = useTabsStore((s) => s.closeTab)
  const [form, setForm] = useState<ItemForm>(() => toForm(item))
  const [confirmDelete, setConfirmDelete] = useState(false)

  const save = async (value: ItemForm) => {
    await apiSend(
      `/api/novels/${novelId}/items/${item.id}`,
      "PATCH",
      toPayload(value),
      "保存物品失败"
    )
    onSaved()
  }

  const { status, schedule, saveNow } = useAutosave<ItemForm>(save)

  const update = (patch: Partial<ItemForm>) => {
    const next = { ...form, ...patch }
    setForm(next)
    if (next.name.trim()) schedule(next)
  }

  /** 离散增删（气泡/等级/功效删除）：立即保存，与角色面板别名同款交互 */
  const commitNow = (patch: Partial<ItemForm>) => {
    const next = { ...form, ...patch }
    setForm(next)
    if (next.name.trim()) saveNow(next)
  }

  /** 添加功效只进本地态：空说明条目会被保存载荷过滤，立即保存的往返重挂载会把新行抹掉 */
  const addEffect = () => {
    if (form.effects.length >= EFFECTS_MAX) return
    setForm({ ...form, effects: [...form.effects, { name: "", description: "" }] })
  }

  const patchEffect = (i: number, patch: Partial<ItemEffect>) =>
    update({ effects: form.effects.map((x, j) => (j === i ? { ...x, ...patch } : x)) })

  /** 打开图标生成面板 tab（与角色头像「点击进入生成面板」一致） */
  const openImageTab = () =>
    openTab({
      id: buildTabId("item-image", novelId, { refId: item.id }),
      type: "item-image",
      novelId,
      refId: item.id,
      title: `${form.name.trim() || item.name} · 图标`,
    })

  const deleteMutation = useMutation({
    mutationFn: () =>
      apiSend(`/api/novels/${novelId}/items/${item.id}`, "DELETE", undefined, "删除失败"),
    onSuccess: () => {
      closeTab(buildTabId("item", novelId, { refId: item.id }))
      toast.success("物品已删除")
      onDeleted()
    },
    onError: (err) => toast.error(err.message),
  })

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-3 border-b px-6 py-3">
        <span className="text-lg font-medium">{item.name}</span>
        <SaveStatusIndicator status={status} />
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            aria-label="删除物品"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 className="text-muted-foreground" />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="mx-auto grid max-w-3xl gap-5">
          {/* 档案区：左 120px 图标位 + 右 名称/别名/标签/等级 */}
          <div className="flex items-start gap-4">
            <button
              type="button"
              onClick={openImageTab}
              title={item.iconUrl ? "点击编辑图标" : "点击打开图标生成面板"}
              className="group relative shrink-0"
            >
              <ItemIcon
                name={form.name.trim() || item.name}
                iconUrl={item.iconUrl}
                iconCrop={item.iconCrop}
                variant="detail"
              />
              {item.iconUrl && <span className="item-icon-veil rounded-[14px]">编辑图标</span>}
            </button>
            <div className="grid min-w-0 flex-1 gap-4">
              <div className="grid gap-2">
                <Label>名称</Label>
                <Input
                  value={form.name}
                  onChange={(e) => update({ name: e.target.value })}
                  onBlur={() => form.name.trim() && saveNow()}
                  maxLength={50}
                />
              </div>
              <div className="grid gap-2">
                <Label className="text-xs text-muted-foreground">
                  别名 <span className="text-[11px] opacity-75">回车添加，≤10 个</span>
                </Label>
                <BubbleInput
                  value={form.aliases}
                  onChange={(aliases) => commitNow({ aliases })}
                  onBlur={() => saveNow()}
                  max={ALIASES_MAX}
                  itemMaxLength={ALIAS_MAX}
                  placeholder="输入别名后回车…"
                  ariaLabel="别名"
                />
              </div>
              <div className="grid gap-2">
                <Label className="text-xs text-muted-foreground">
                  标签 <span className="text-[11px] opacity-75">≤{ITEM_TAGS_MAX} 个</span>
                </Label>
                <BubbleInput
                  value={form.tags}
                  onChange={(tags) => commitNow({ tags })}
                  onBlur={() => saveNow()}
                  max={ITEM_TAGS_MAX}
                  itemMaxLength={ITEM_TAG_MAX}
                  placeholder="输入标签后回车…"
                  ariaLabel="标签"
                />
              </div>
              <div className="grid gap-2">
                <Label className="text-xs text-muted-foreground">
                  等级 <span className="text-[11px] opacity-75">从世界观的物品等级体系中选择，可多选</span>
                </Label>
                <ItemLevelPicker
                  novelId={novelId}
                  value={form.levels}
                  onChange={(levels) => commitNow({ levels })}
                />
              </div>
            </div>
          </div>

          <div className="grid gap-2">
            <Label>介绍</Label>
            <Textarea
              value={form.description}
              onChange={(e) => update({ description: e.target.value })}
              onBlur={() => saveNow()}
              rows={4}
              maxLength={5000}
              placeholder="物品的来历、外观、用途等"
            />
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>外形</Label>
              <Textarea
                value={form.appearance}
                onChange={(e) => update({ appearance: e.target.value })}
                onBlur={() => saveNow()}
                rows={3}
                maxLength={2000}
                placeholder="形制、材质、纹路、破损痕迹等"
              />
            </div>
            <div className="grid gap-2">
              <Label>获取方式</Label>
              <Textarea
                value={form.acquisition}
                onChange={(e) => update({ acquisition: e.target.value })}
                onBlur={() => saveNow()}
                rows={3}
                maxLength={2000}
                placeholder="持有者如何得到它"
              />
            </div>
          </div>

          {/* 功效：复刻 LevelSystemEditor 能力表现列表模式 */}
          <div className="grid gap-2">
            <Label>功效（{form.effects.length}）</Label>
            {form.effects.map((effect, i) => (
              <div
                key={i}
                className="flex flex-col gap-1.5 rounded-lg border border-border bg-muted/40 p-2.5 dark:bg-accent/40"
              >
                <div className="flex items-center gap-2">
                  <Input
                    value={effect.name}
                    onChange={(e) => patchEffect(i, { name: e.target.value })}
                    onBlur={() => saveNow()}
                    maxLength={EFFECT_NAME_MAX}
                    placeholder="功效名称（可空）"
                    className="bg-transparent dark:bg-transparent"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="删除该功效"
                    onClick={() =>
                      commitNow({ effects: form.effects.filter((_, j) => j !== i) })
                    }
                  >
                    <Trash2 className="text-muted-foreground" />
                  </Button>
                </div>
                <Textarea
                  value={effect.description}
                  onChange={(e) => patchEffect(i, { description: e.target.value })}
                  onBlur={() => saveNow()}
                  maxLength={EFFECT_DESCRIPTION_MAX}
                  placeholder="功效说明"
                  rows={1}
                  className="resize-none overflow-hidden bg-transparent dark:bg-transparent"
                />
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              disabled={form.effects.length >= EFFECTS_MAX}
              onClick={addEffect}
            >
              <Plus />
              添加功效
            </Button>
          </div>

          <div className="grid gap-2">
            <Label>属性</Label>
            <EntityAttributesEditor
              novelId={novelId}
              target="ITEM"
              value={form.attributes}
              onChange={(attributes) => update({ attributes })}
              onBlurSave={() => saveNow()}
            />
          </div>
        </div>
      </div>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除物品</DialogTitle>
            <DialogDescription>
              确定要删除物品「{item.name}」吗？该操作不可撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate()}
            >
              {deleteMutation.isPending && <Loader2 className="animate-spin" />}
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** 物品详情编辑（type=item，refId=物品 id）：表单 + 自动保存 */
export function ItemPanel({ novelId, refId }: ContentPanelProps) {
  const queryClient = useQueryClient()

  const { data, isLoading, isError } = useQuery({
    queryKey: ["items", novelId],
    queryFn: () =>
      apiGet<{ items: ItemRecord[] }>(`/api/novels/${novelId}/items`, "加载物品失败"),
  })

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["items", novelId] })

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

  const item = (data?.items ?? []).find((x) => x.id === refId)
  if (!item) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        物品不存在或已被删除
      </div>
    )
  }

  return (
    <ItemFormEditor
      key={`${item.id}:${item.updatedAt}`}
      novelId={novelId}
      item={item}
      onSaved={invalidate}
      onDeleted={invalidate}
    />
  )
}
