"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Check, Info, Loader2, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import type { AttributeTarget, AttributeValueType } from "@/generated/prisma/enums"
import { cn } from "@/lib/utils"

import { apiGet, apiSend } from "./api"
import { ATTRIBUTE_TARGET_LABELS, ATTRIBUTE_VALUE_TYPE_LABELS } from "./labels"
import type { AttributeDefinitionRecord, EntityAttributeItem } from "./types"

/** 拉取小说的属性定义列表（面板间共享同一 queryKey 缓存） */
export function useAttributeDefinitions(novelId: string) {
  return useQuery({
    queryKey: ["attributes", novelId],
    queryFn: () =>
      apiGet<{ definitions: AttributeDefinitionRecord[] }>(
        `/api/novels/${novelId}/attributes`,
        "加载属性定义失败"
      ),
  })
}

/** 公共属性预设：点击即建（或复用同名定义）并挂载。只覆盖角色类通用属性 */
const ATTRIBUTE_PRESETS: Record<
  AttributeTarget,
  {
    name: string
    valueType: AttributeValueType
    options?: string[]
    description?: string
  }[]
> = {
  CHARACTER: [
    { name: "生日", valueType: "TEXT", description: "如：三月初七 / 历元952年" },
    { name: "身高", valueType: "NUMBER", description: "单位：cm" },
    { name: "体重", valueType: "NUMBER", description: "单位：kg" },
    { name: "血型", valueType: "SELECT", options: ["A", "B", "AB", "O"] },
  ],
  ITEM: [],
  SCENE: [],
}

/** 按定义的值类型渲染对应的编辑控件 */
function AttributeValueControl({
  definition,
  value,
  onChange,
  onBlurSave,
}: {
  definition: AttributeDefinitionRecord | undefined
  value: string
  onChange: (v: string) => void
  onBlurSave?: () => void
}) {
  const placeholder = definition?.description || `填写${definition?.name ?? "值"}`
  const valueType = definition?.valueType ?? "TEXT"

  if (valueType === "SELECT" && definition) {
    return (
      <Select
        value={value === "" ? null : value}
        onValueChange={(v) => {
          if (v) onChange(v)
        }}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder="请选择" />
        </SelectTrigger>
        <SelectContent>
          {definition.options.map((opt) => (
            <SelectItem key={opt} value={opt}>
              {opt}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  if (valueType === "NUMBER") {
    return (
      <Input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlurSave}
        placeholder={placeholder}
      />
    )
  }

  return (
    <Textarea
      rows={1}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlurSave}
      placeholder={placeholder}
      className="min-h-9 resize-none"
    />
  )
}

interface DefinitionDraft {
  name: string
  description: string
  valueType: AttributeValueType
  options: string[]
}

/** 「添加属性」对话框：公共属性预设 + 属性库 + 自定义创建 */
function AddAttributeDialog({
  novelId,
  target,
  definitions,
  mountedIds,
  onAdd,
  onOpenChange,
}: {
  novelId: string
  target: AttributeTarget
  definitions: AttributeDefinitionRecord[]
  mountedIds: Set<string>
  onAdd: (definition: AttributeDefinitionRecord) => void
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<DefinitionDraft>({
    name: "",
    description: "",
    valueType: "TEXT",
    options: [],
  })
  const [optionsText, setOptionsText] = useState("")

  const presets = ATTRIBUTE_PRESETS[target]
  const library = definitions.filter(
    (d) => d.targets.includes(target) && !mountedIds.has(d.id)
  )

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["attributes", novelId] })

  const createMutation = useMutation({
    mutationFn: (body: {
      name: string
      description: string
      valueType: AttributeValueType
      options: string[]
    }) =>
      apiSend<{ definition: AttributeDefinitionRecord }>(
        `/api/novels/${novelId}/attributes`,
        "POST",
        { ...body, targets: [target] },
        "创建属性失败"
      ),
    onSuccess: ({ definition }) => {
      invalidate()
      onAdd(definition)
      setDraft({ name: "", description: "", valueType: "TEXT", options: [] })
      setOptionsText("")
    },
    onError: (err) => toast.error(err.message),
  })

  /** 扩展已有同名定义的适用对象（如「性别」已建但只勾了物品） */
  const extendTargetsMutation = useMutation({
    mutationFn: (definition: AttributeDefinitionRecord) =>
      apiSend<{ definition: AttributeDefinitionRecord }>(
        `/api/novels/${novelId}/attributes/${definition.id}`,
        "PATCH",
        {
          name: definition.name,
          description: definition.description,
          targets: [...definition.targets, target],
          valueType: definition.valueType,
          options: definition.options,
        },
        "更新属性失败"
      ),
    onSuccess: ({ definition }) => {
      invalidate()
      onAdd(definition)
    },
    onError: (err) => toast.error(err.message),
  })

  const busy = createMutation.isPending || extendTargetsMutation.isPending

  const addPreset = (preset: (typeof presets)[number]) => {
    const existing = definitions.find((d) => d.name === preset.name)
    if (existing) {
      if (mountedIds.has(existing.id)) return
      if (existing.targets.includes(target)) {
        onAdd(existing)
      } else {
        extendTargetsMutation.mutate(existing)
      }
      return
    }
    createMutation.mutate({
      name: preset.name,
      description: preset.description ?? "",
      valueType: preset.valueType,
      options: preset.options ?? [],
    })
  }

  const submitCustom = () => {
    const name = draft.name.trim()
    if (!name) {
      toast.error("请输入属性名称")
      return
    }
    if (definitions.some((d) => d.name === name)) {
      toast.error(`已存在同名属性「${name}」，可在上方属性库或列表中查找`)
      return
    }
    const options =
      draft.valueType === "SELECT"
        ? optionsText
            .split(/[,，、]/)
            .map((s) => s.trim())
            .filter(Boolean)
        : []
    if (draft.valueType === "SELECT" && options.length < 2) {
      toast.error("选项类型至少需要两个可选值，用逗号分隔")
      return
    }
    createMutation.mutate({
      name,
      description: draft.description.trim(),
      valueType: draft.valueType,
      options,
    })
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>添加{ATTRIBUTE_TARGET_LABELS[target]}属性</DialogTitle>
          <DialogDescription>
            从公共属性或属性库中选择，也可以创建新的自定义属性；添加后即可填写值。
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[60vh] flex-col gap-5 overflow-y-auto">
          {presets.length > 0 && (
            <div className="grid gap-2">
              <Label className="text-xs text-muted-foreground">公共属性</Label>
              <div className="flex flex-wrap gap-2">
                {presets.map((preset) => {
                  const added = definitions.some(
                    (d) => d.name === preset.name && mountedIds.has(d.id)
                  )
                  return (
                    <Button
                      key={preset.name}
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={added || busy}
                      onClick={() => addPreset(preset)}
                    >
                      {added ? <Check className="text-primary" /> : <Plus />}
                      {preset.name}
                    </Button>
                  )
                })}
              </div>
            </div>
          )}

          {library.length > 0 && (
            <div className="grid gap-2">
              <Label className="text-xs text-muted-foreground">属性库（已定义）</Label>
              <div className="flex flex-wrap gap-2">
                {library.map((d) => (
                  <Button
                    key={d.id}
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    title={d.description || undefined}
                    onClick={() => onAdd(d)}
                  >
                    <Plus />
                    {d.name}
                    <span className="text-xs text-muted-foreground">
                      {ATTRIBUTE_VALUE_TYPE_LABELS[d.valueType]}
                    </span>
                  </Button>
                ))}
              </div>
            </div>
          )}

          <div className="grid gap-3 rounded-lg border p-3">
            <Label className="text-xs text-muted-foreground">自定义属性</Label>
            <div className="grid grid-cols-[1fr_7rem] gap-2">
              <Input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="属性名称，如：灵力上限"
                maxLength={50}
              />
              <Select
                value={draft.valueType}
                onValueChange={(v) =>
                  setDraft({ ...draft, valueType: v as AttributeValueType })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {ATTRIBUTE_VALUE_TYPE_LABELS[draft.valueType]}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(ATTRIBUTE_VALUE_TYPE_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {draft.valueType === "SELECT" && (
              <Input
                value={optionsText}
                onChange={(e) => setOptionsText(e.target.value)}
                placeholder="可选值，用逗号分隔，如：男，女，其他"
              />
            )}
            <Input
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              placeholder="介绍/填写提示（可选）"
              maxLength={2000}
            />
            <Button
              type="button"
              size="sm"
              className="justify-self-start"
              disabled={busy}
              onClick={submitCustom}
            >
              {createMutation.isPending ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Plus />
              )}
              创建并添加
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * 实体属性编辑器（角色/物品/场景面板共用）：
 * 按定义的值类型渲染控件（文本/数字/下拉），值变更通过 onChange 上抛，
 * 由父组件并入表单状态并走统一自动保存。
 * variant=stack 时纵向排列（物品/场景面板）；variant=grid 时以 Fragment 输出
 * 卡片 + 虚线「添加属性」块，供父组件嵌入统一网格（角色面板）。
 */
export function EntityAttributesEditor({
  novelId,
  target,
  value,
  onChange,
  onBlurSave,
  variant = "stack",
}: {
  novelId: string
  target: AttributeTarget
  value: EntityAttributeItem[]
  onChange: (next: EntityAttributeItem[]) => void
  onBlurSave?: () => void
  variant?: "stack" | "grid"
}) {
  const [addOpen, setAddOpen] = useState(false)
  const { data } = useAttributeDefinitions(novelId)
  const definitions = data?.definitions ?? []
  const byId = new Map(definitions.map((d) => [d.id, d]))

  const setValue = (definitionId: string, v: string) =>
    onChange(
      value.map((item) => (item.definitionId === definitionId ? { ...item, value: v } : item))
    )

  const cards = value.map((item) => {
    const definition = byId.get(item.definitionId)
    return (
      <div
        key={item.definitionId}
        className="rounded-lg border bg-card/60 px-3 py-2"
      >
        <div className="flex items-center gap-1.5">
          <span
            className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground"
            title={definition?.description || definition?.name}
          >
            {definition?.name ?? "（属性已删除）"}
          </span>
          {definition?.description && (
            <Info className="size-3 shrink-0 text-muted-foreground/60" />
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`移除属性 ${definition?.name ?? ""}`}
            className="size-6"
            onClick={() =>
              onChange(value.filter((x) => x.definitionId !== item.definitionId))
            }
          >
            <Trash2 className="size-3.5 text-muted-foreground" />
          </Button>
        </div>
        <div className="mt-1.5">
          <AttributeValueControl
            definition={definition}
            value={item.value}
            onChange={(v) => setValue(item.definitionId, v)}
            onBlurSave={onBlurSave}
          />
        </div>
      </div>
    )
  })

  const dialog = addOpen ? (
    <AddAttributeDialog
      novelId={novelId}
      target={target}
      definitions={definitions}
      mountedIds={new Set(value.map((v) => v.definitionId))}
      onAdd={(definition) => {
        if (!value.some((v) => v.definitionId === definition.id)) {
          onChange([...value, { definitionId: definition.id, value: "" }])
        }
      }}
      onOpenChange={setAddOpen}
    />
  ) : null

  if (variant === "grid") {
    return (
      <>
        {cards}
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="flex min-h-[76px] flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground"
        >
          <Plus className="size-4" />
          <span className="text-xs">添加属性</span>
        </button>
        {dialog}
      </>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {cards}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={cn("self-start", value.length === 0 && "border-dashed")}
        onClick={() => setAddOpen(true)}
      >
        <Plus />
        添加属性
      </Button>
      {dialog}
    </div>
  )
}
