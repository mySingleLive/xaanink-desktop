"use client"

import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Loader2, Pencil, Plus, SlidersHorizontal, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
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

import { apiSend } from "./api"
import { useAttributeDefinitions } from "./EntityAttributesEditor"
import {
  ATTRIBUTE_TARGET_LABELS,
  ATTRIBUTE_TARGET_ORDER,
  ATTRIBUTE_VALUE_TYPE_LABELS,
} from "./labels"
import type { ContentPanelProps } from "./registry"
import type { AttributeDefinitionRecord } from "./types"

interface DefinitionForm {
  name: string
  description: string
  targets: AttributeTarget[]
  valueType: AttributeValueType
  /** valueType=SELECT 时的可选值（逗号分隔的编辑文本） */
  optionsText: string
}

const EMPTY_FORM: DefinitionForm = {
  name: "",
  description: "",
  targets: ["CHARACTER"],
  valueType: "TEXT",
  optionsText: "",
}

type DialogState =
  | { type: "create" }
  | { type: "edit"; definition: AttributeDefinitionRecord }
  | { type: "delete"; definition: AttributeDefinitionRecord }
  | null

/** 属性定义管理面板（type=attributes）：属性的增删改查 */
export function AttributesPanel({ novelId }: ContentPanelProps) {
  const queryClient = useQueryClient()
  const [dialog, setDialog] = useState<DialogState>(null)
  const [form, setForm] = useState<DefinitionForm>(EMPTY_FORM)

  const { data, isLoading, isError } = useAttributeDefinitions(novelId)

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["attributes", novelId] })

  const saveMutation = useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id?: string
      body: {
        name: string
        description: string
        targets: AttributeTarget[]
        valueType: AttributeValueType
        options: string[]
      }
    }) =>
      id
        ? apiSend(
            `/api/novels/${novelId}/attributes/${id}`,
            "PATCH",
            body,
            "保存属性失败"
          )
        : apiSend(`/api/novels/${novelId}/attributes`, "POST", body, "创建属性失败"),
    onSuccess: () => {
      invalidate()
      setDialog(null)
      toast.success("已保存")
    },
    onError: (err) => toast.error(err.message),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiSend(`/api/novels/${novelId}/attributes/${id}`, "DELETE", undefined, "删除失败"),
    onSuccess: () => {
      invalidate()
      setDialog(null)
      toast.success("属性已删除")
    },
    onError: (err) => toast.error(err.message),
  })

  const openCreate = () => {
    setForm(EMPTY_FORM)
    setDialog({ type: "create" })
  }

  const openEdit = (definition: AttributeDefinitionRecord) => {
    setForm({
      name: definition.name,
      description: definition.description,
      targets: [...definition.targets],
      valueType: definition.valueType,
      optionsText: definition.options.join("，"),
    })
    setDialog({ type: "edit", definition })
  }

  const toggleTarget = (target: AttributeTarget) =>
    setForm((prev) => ({
      ...prev,
      targets: prev.targets.includes(target)
        ? prev.targets.filter((t) => t !== target)
        : [...prev.targets, target],
    }))

  const submit = () => {
    if (!form.name.trim()) {
      toast.error("属性名称不能为空")
      return
    }
    if (form.targets.length === 0) {
      toast.error("至少选择一个适用对象")
      return
    }
    const options =
      form.valueType === "SELECT"
        ? form.optionsText
            .split(/[,，、]/)
            .map((s) => s.trim())
            .filter(Boolean)
        : []
    if (form.valueType === "SELECT" && options.length < 2) {
      toast.error("选项类型至少需要两个可选值，用逗号分隔")
      return
    }
    saveMutation.mutate({
      id: dialog?.type === "edit" ? dialog.definition.id : undefined,
      body: {
        name: form.name.trim(),
        description: form.description,
        targets: form.targets,
        valueType: form.valueType,
        options,
      },
    })
  }

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
        属性定义加载失败，请稍后重试
      </div>
    )
  }

  const definitions = data?.definitions ?? []
  const editing = dialog?.type === "edit" || dialog?.type === "create"

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">属性管理</h2>
          <Button size="sm" onClick={openCreate}>
            <Plus />
            新建属性
          </Button>
        </div>

        <p className="text-sm text-muted-foreground">
          属性是可挂载到角色、物品或场景上的自定义字段（如「品阶」「灵力上限」）。
          创建后即可在对应的面板中为具体对象添加并填写值。
        </p>

        {definitions.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <SlidersHorizontal className="size-10 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              还没有属性，点击「新建属性」创建第一个吧
            </p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {definitions.map((d) => (
              <Card key={d.id}>
                <CardContent className="flex flex-col gap-2 p-4">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate font-medium">{d.name}</span>
                    <Badge variant="outline">
                      {ATTRIBUTE_VALUE_TYPE_LABELS[d.valueType]}
                    </Badge>
                    {d.targets.map((t) => (
                      <Badge key={t} variant="secondary">
                        {ATTRIBUTE_TARGET_LABELS[t]}
                      </Badge>
                    ))}
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`编辑属性 ${d.name}`}
                      className="size-7"
                      onClick={() => openEdit(d)}
                    >
                      <Pencil className="size-3.5 text-muted-foreground" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`删除属性 ${d.name}`}
                      className="size-7"
                      onClick={() => setDialog({ type: "delete", definition: d })}
                    >
                      <Trash2 className="size-3.5 text-muted-foreground" />
                    </Button>
                  </div>
                  <p className="line-clamp-2 text-sm text-muted-foreground">
                    {d.description || "暂无介绍"}
                  </p>
                  {d.valueType === "SELECT" && d.options.length > 0 && (
                    <p className="truncate text-xs text-muted-foreground/70">
                      可选值：{d.options.join(" / ")}
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* 新建 / 编辑 */}
      <Dialog
        open={editing}
        onOpenChange={(open) => {
          if (!open) setDialog(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialog?.type === "edit" ? "编辑属性" : "新建属性"}
            </DialogTitle>
            <DialogDescription>
              定义属性的名称、适用对象与介绍，保存后可在对应面板中挂载使用。
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              submit()
            }}
            className="flex flex-col gap-4"
          >
            <div className="grid gap-2">
              <Label>名称</Label>
              <Input
                autoFocus
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="如：品阶、灵力上限"
                maxLength={50}
              />
            </div>
            <div className="grid gap-2">
              <Label>适用对象（可多选）</Label>
              <div className="flex gap-2">
                {ATTRIBUTE_TARGET_ORDER.map((t) => (
                  <Button
                    key={t}
                    type="button"
                    size="sm"
                    variant={form.targets.includes(t) ? "default" : "outline"}
                    className={cn(!form.targets.includes(t) && "text-muted-foreground")}
                    onClick={() => toggleTarget(t)}
                  >
                    {ATTRIBUTE_TARGET_LABELS[t]}
                  </Button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>值类型</Label>
                <Select
                  value={form.valueType}
                  onValueChange={(v) =>
                    setForm({ ...form, valueType: v as AttributeValueType })
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue>
                      {ATTRIBUTE_VALUE_TYPE_LABELS[form.valueType]}
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
              {form.valueType === "SELECT" && (
                <div className="grid gap-2">
                  <Label>可选值</Label>
                  <Input
                    value={form.optionsText}
                    onChange={(e) => setForm({ ...form, optionsText: e.target.value })}
                    placeholder="用逗号分隔，如：男，女，其他"
                  />
                </div>
              )}
            </div>
            <div className="grid gap-2">
              <Label>介绍</Label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="这个属性的含义、取值范围或填写建议"
                rows={3}
                maxLength={2000}
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={saveMutation.isPending}>
                {saveMutation.isPending && <Loader2 className="animate-spin" />}
                保存
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <Dialog
        open={dialog?.type === "delete"}
        onOpenChange={(open) => {
          if (!open) setDialog(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除属性</DialogTitle>
            <DialogDescription>
              确定要删除属性「{dialog?.type === "delete" ? dialog.definition.name : ""}
              」吗？已挂载到各角色/物品/场景上的该属性值也会一并移除。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => {
                if (dialog?.type === "delete") deleteMutation.mutate(dialog.definition.id)
              }}
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
