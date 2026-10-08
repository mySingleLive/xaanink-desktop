"use client"

/**
 * 「新建等级体系」对话框：名称 + 等级类型（角色/物品/通用）+ 等级形态（单途径/多途径）。
 * 类型创建后仍可在属性条修改；形态创建后固定，不可更改（见 docs/level-system/product-design.md §4.5）。
 */
import { useState } from "react"
import { Layers, Network, Package, Route, User } from "lucide-react"

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
import { cn } from "@/lib/utils"

import { LEVEL_FORM_LABELS, LEVEL_SCOPE_LABELS, type LevelForm, type LevelScope } from "./setting-content"

const SCOPE_OPTIONS: { value: LevelScope; icon: typeof User; desc: string }[] = [
  { value: "CHARACTER", icon: User, desc: "角色的成长与位阶，如炼气期、序列九" },
  { value: "ITEM", icon: Package, desc: "物品的品阶与稀有度，如黄阶法宝、传说武器" },
  { value: "GENERAL", icon: Layers, desc: "角色与物品共用的等级阶梯" },
]

const FORM_OPTIONS: { value: LevelForm; icon: typeof Route; desc: string }[] = [
  { value: "SINGLE", icon: Route, desc: "一条从低到高的等级阶梯，如炼气 → 筑基 → 金丹 → 元婴" },
  { value: "MULTI_PATHWAY", icon: Network, desc: "多条并行途径，各自一套等级序列，如《诡秘之主》22 条神之途径" },
]

function OptionCard({
  selected,
  onSelect,
  icon: Icon,
  title,
  desc,
}: {
  selected: boolean
  onSelect: () => void
  icon: typeof User
  title: string
  desc: string
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "rounded-lg border border-border bg-card p-2.5 text-left transition-colors hover:bg-muted/50",
        selected && "border-primary/55 bg-primary/10"
      )}
    >
      <span className="flex items-center gap-1.5 text-[13px] font-semibold">
        <Icon aria-hidden="true" className="size-3.5 shrink-0 text-primary" />
        {title}
      </span>
      <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{desc}</span>
    </button>
  )
}

export function CreateLevelSystemDialog({
  open,
  onOpenChange,
  disabled,
  onCreate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  disabled?: boolean
  onCreate: (input: { name: string; scope: LevelScope; form: LevelForm }) => void
}) {
  const [name, setName] = useState("未命名等级体系")
  const [scope, setScope] = useState<LevelScope>("CHARACTER")
  const [form, setForm] = useState<LevelForm>("SINGLE")

  const reset = () => {
    setName("未命名等级体系")
    setScope("CHARACTER")
    setForm("SINGLE")
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o)
        if (!o) reset()
      }}
    >
      <DialogContent>
        <form
          className="contents"
          onSubmit={(e) => {
            e.preventDefault()
            if (!name.trim()) return
            onCreate({ name: name.trim(), scope, form })
            onOpenChange(false)
            reset()
          }}
        >
          <DialogHeader>
            <DialogTitle>新建等级体系</DialogTitle>
            <DialogDescription>
              选择这套等级给谁用、以什么形态组织。类型创建后仍可修改；形态创建后固定，不可更改。
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-2">
            <Label htmlFor="level-system-name">名称</Label>
            <Input
              id="level-system-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              autoFocus
            />
          </div>

          <div className="grid gap-2">
            <Label>等级类型 · 给谁用</Label>
            <div role="radiogroup" aria-label="等级类型" className="grid grid-cols-3 gap-2">
              {SCOPE_OPTIONS.map((o) => (
                <OptionCard
                  key={o.value}
                  selected={scope === o.value}
                  onSelect={() => setScope(o.value)}
                  icon={o.icon}
                  title={LEVEL_SCOPE_LABELS[o.value]}
                  desc={o.desc}
                />
              ))}
            </div>
          </div>

          <div className="grid gap-2">
            <Label>等级形态 · 怎么组织</Label>
            <div role="radiogroup" aria-label="等级形态" className="grid grid-cols-2 gap-2">
              {FORM_OPTIONS.map((o) => (
                <OptionCard
                  key={o.value}
                  selected={form === o.value}
                  onSelect={() => setForm(o.value)}
                  icon={o.icon}
                  title={LEVEL_FORM_LABELS[o.value]}
                  desc={o.desc}
                />
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button
              type="button"
              disabled={disabled || !name.trim()}
              onClick={() => {
                if (!name.trim()) return
                onCreate({ name: name.trim(), scope, form })
                onOpenChange(false)
                reset()
              }}
            >
              创建等级体系
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
