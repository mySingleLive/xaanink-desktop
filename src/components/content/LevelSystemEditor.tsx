"use client"

import { useEffect, useRef, useState } from "react"
import {
  ArrowLeft,
  Copy,
  Layers,
  Lock,
  MessageSquareQuote,
  MoreHorizontal,
  Network,
  Package,
  Pencil,
  Plus,
  Route,
  ScrollText,
  SquarePen,
  Trash2,
  User,
  X,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { buildLevelChip } from "@/components/chat/level-chip"
import { startChipDrag } from "@/components/chat/chip-drag"
import { CHAT_FOCUS_COMPOSER_EVENT, dispatchChatUiEvent } from "@/components/chat/ui-events"
import { useChatStore } from "@/stores/chat"
import { useTabsStore } from "@/stores/tabs"

import {
  LEVEL_FORM_LABELS,
  LEVEL_SCOPE_LABELS,
  type LevelForm,
  type LevelNode,
  type LevelPathway,
  type LevelScope,
  type LevelSystemContent,
} from "./setting-content"
import type { ConceptFocus } from "./SettingContentEditor"
import {
  LevelCardBody,
  LevelSeqBadge,
  PathwayCardBody,
  findLevelInContent,
  levelDisplayName as displayName,
  pathwayDisplayName,
} from "./level-card-parts"

/** 索引路径：如 [0,4] 表示 levels[0].children[4]；null 表示总览 */
type Path = number[]

/* ---------------- 路径纯函数（不可变更新） ---------------- */

function getAt(levels: LevelNode[], path: Path): LevelNode | null {
  let list = levels
  let node: LevelNode | undefined
  for (const i of path) {
    node = list[i]
    if (!node) return null
    list = node.children
  }
  return node ?? null
}

function updateAt(levels: LevelNode[], path: Path, patch: Partial<LevelNode>): LevelNode[] {
  const [head, ...rest] = path
  return levels.map((l, i) =>
    i === head
      ? rest.length === 0
        ? { ...l, ...patch }
        : { ...l, children: updateAt(l.children, rest, patch) }
      : l
  )
}

function removeAt(levels: LevelNode[], path: Path): LevelNode[] {
  const [head, ...rest] = path
  if (rest.length === 0) return levels.filter((_, i) => i !== head)
  return levels.map((l, i) => (i === head ? { ...l, children: removeAt(l.children, rest) } : l))
}

/** 深拷贝一个等级节点（复制用，避免共享嵌套引用） */
function cloneLevel(node: LevelNode): LevelNode {
  return {
    ...node,
    aliases: [...node.aliases],
    tags: [...node.tags],
    abilities: node.abilities.map((a) => ({ ...a })),
    children: node.children.map(cloneLevel),
  }
}

/** 在 path 所指节点之后插入其深拷贝副本 */
function insertCopyAfter(levels: LevelNode[], path: Path): LevelNode[] {
  const [head, ...rest] = path
  if (rest.length === 0) {
    const copy = cloneLevel(levels[head])
    return [...levels.slice(0, head + 1), copy, ...levels.slice(head + 1)]
  }
  return levels.map((l, i) => (i === head ? { ...l, children: insertCopyAfter(l.children, rest) } : l))
}

function emptyLevel(): LevelNode {
  return { name: "", aliases: [], tags: [], condition: "", description: "", abilities: [], children: [] }
}

/** 统计子孙数量（删除确认文案用） */
function countDescendants(node: LevelNode): number {
  return node.children.reduce((sum, c) => sum + 1 + countDescendants(c), 0)
}

/* ---------------- 途径纯函数（与等级路径同风格） ---------------- */

function patchPathwayAt(pathways: LevelPathway[], index: number, patch: Partial<LevelPathway>): LevelPathway[] {
  return pathways.map((p, i) => (i === index ? { ...p, ...patch } : p))
}

function removePathwayAt(pathways: LevelPathway[], index: number): LevelPathway[] {
  return pathways.filter((_, i) => i !== index)
}

function clonePathway(pathway: LevelPathway): LevelPathway {
  return {
    ...pathway,
    aliases: [...pathway.aliases],
    tags: [...pathway.tags],
    levels: pathway.levels.map(cloneLevel),
  }
}

function insertPathwayCopyAfter(pathways: LevelPathway[], index: number): LevelPathway[] {
  const copy = clonePathway(pathways[index])
  return [...pathways.slice(0, index + 1), copy, ...pathways.slice(index + 1)]
}

function emptyPathway(): LevelPathway {
  return { name: "", aliases: [], tags: [], description: "", levels: [] }
}

/** 途径内全部等级数（含子等级，删除确认文案用） */
function countPathwayLevels(pathway: LevelPathway): number {
  return pathway.levels.reduce((sum, l) => sum + 1 + countDescendants(l), 0)
}

/* ---------------- 类型 / 形态展示 ---------------- */

const SCOPE_ICONS: Record<LevelScope, typeof User> = {
  CHARACTER: User,
  ITEM: Package,
  GENERAL: Layers,
}
const FORM_ICONS: Record<LevelForm, typeof Route> = {
  SINGLE: Route,
  MULTI_PATHWAY: Network,
}

/* ---------------- 多标签输入框 ---------------- */

function TagInput({
  values,
  onChange,
  onBlur,
  placeholder,
  ariaLabel,
}: {
  values: string[]
  onChange: (values: string[]) => void
  onBlur?: () => void
  placeholder?: string
  ariaLabel: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const add = (raw: string) => {
    const v = raw.trim().replace(/,$/, "")
    if (!v || values.includes(v)) {
      if (inputRef.current) inputRef.current.value = ""
      return
    }
    onChange([...values, v])
    if (inputRef.current) inputRef.current.value = ""
  }
  return (
    <div
      className="flex flex-wrap items-center gap-1.5 rounded-lg border border-input bg-transparent px-2 py-1.5 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30"
      onClick={() => inputRef.current?.focus()}
      role="group"
      aria-label={ariaLabel}
    >
      {values.map((v, i) => (
        <span
          key={`${v}-${i}`}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2.5 text-xs leading-5"
        >
          {v}
          <button
            type="button"
            aria-label={`删除 ${v}`}
            className="inline-flex size-3.5 items-center justify-center rounded-full text-muted-foreground hover:text-destructive"
            onClick={(e) => {
              e.stopPropagation()
              onChange(values.filter((_, j) => j !== i))
            }}
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        className="min-w-28 flex-1 bg-transparent px-1 py-0.5 text-sm outline-none placeholder:text-muted-foreground"
        placeholder={values.length === 0 ? placeholder : ""}
        aria-label={`${ariaLabel}输入`}
        onKeyDown={(e) => {
          const el = e.currentTarget
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault()
            add(el.value)
            onBlur?.()
          } else if (e.key === "Backspace" && !el.value && values.length > 0) {
            onChange(values.slice(0, -1))
            onBlur?.()
          }
        }}
        onBlur={(e) => {
          if (e.currentTarget.value.trim()) add(e.currentTarget.value)
          onBlur?.()
        }}
      />
    </div>
  )
}

/* ---------------- 等级卡片 ---------------- */

function LevelCard({
  node,
  path,
  depth,
  settingId,
  settingName,
  onOpen,
  onRename,
  onCopy,
  onRemove,
  onQuote,
}: {
  node: LevelNode
  path: Path
  depth: number
  /** 拖拽/引用芯片序列 `@[设定·{settingName}/{settingId}·{等级名}]` 用 */
  settingId: string
  settingName: string
  onOpen: (path: Path) => void
  onRename: (path: Path) => void
  onCopy: (path: Path) => void
  onRemove: (path: Path) => void
  onQuote: (path: Path) => void
}) {
  const isGroup = node.children.length > 0
  const seq = depth === 0 ? `等级 ${path[path.length - 1] + 1}` : `子级 ${path[path.length - 1] + 1}`
  const key = path.join(",")
  /** 与「引用到对话」同源的芯片数据；拖拽 payload 复用 */
  const chip = buildLevelChip({ settingId, settingName, levelName: displayName(node) })
  const dragProps = {
    draggable: true,
    onDragStart: (e: React.DragEvent<HTMLElement>) => startChipDrag(e, chip),
  } as const

  const menu = (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={`${displayName(node)} 菜单`}
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-muted-foreground/15 group-hover/level:opacity-100 group-focus-within/level:opacity-100 data-popup-open:opacity-100"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          />
        }
      >
        <MoreHorizontal aria-hidden="true" className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        {/* 菜单渲染在 portal 里，onClick 仍会沿 React 树冒泡到卡片（触发打开详情），逐项拦截 */}
        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onRename(path) }}>
          <Pencil aria-hidden="true" />重命名
        </DropdownMenuItem>
        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onOpen(path) }}>
          <SquarePen aria-hidden="true" />编辑
        </DropdownMenuItem>
        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onQuote(path) }}>
          <MessageSquareQuote aria-hidden="true" />引用到对话
        </DropdownMenuItem>
        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onCopy(path) }}>
          <Copy aria-hidden="true" />复制
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={(e) => { e.stopPropagation(); onRemove(path) }}>
          <Trash2 aria-hidden="true" />删除
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )

  if (isGroup) {
    return (
      <div data-concept-name={node.name} className="group/level col-span-full min-w-0 rounded-xl border border-border bg-card">
        <div
          role="button"
          tabIndex={0}
          aria-label={`查看 ${displayName(node)} 详情`}
          title="可拖拽到对话输入框引用该等级"
          className="cursor-pointer rounded-t-xl p-3 transition-colors hover:bg-hover-wash focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          onClick={() => onOpen(path)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault()
              onOpen(path)
            }
          }}
          {...dragProps}
        >
          <div className="flex min-w-0 items-center gap-2">
            <LevelSeqBadge>{seq}</LevelSeqBadge>
            <span className="truncate text-sm font-semibold">{displayName(node)}</span>
            <span className="ml-auto">{menu}</span>
          </div>
          <LevelCardBody node={node} />
        </div>
        <div className="mx-3 mb-3 grid grid-cols-[repeat(auto-fill,minmax(min(240px,100%),1fr))] items-start gap-2 rounded-lg bg-muted/55 p-2.5 dark:bg-accent/60">
          {node.children.map((c, i) => (
            <LevelCard key={`${key}-${i}`} node={c} path={[...path, i]} depth={depth + 1} settingId={settingId} settingName={settingName} onOpen={onOpen} onRename={onRename} onCopy={onCopy} onRemove={onRemove} onQuote={onQuote} />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div
      data-concept-name={node.name}
      role="button"
      tabIndex={0}
      aria-label={`查看 ${displayName(node)} 详情`}
      title="可拖拽到对话输入框引用该等级"
      className="group/level min-w-0 cursor-pointer rounded-xl border border-border bg-card p-3 transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
      onClick={() => onOpen(path)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onOpen(path)
        }
      }}
      {...dragProps}
    >
      <div className="flex min-w-0 items-center gap-2">
        <LevelSeqBadge>{seq}</LevelSeqBadge>
        <span className="truncate text-sm font-semibold">{displayName(node)}</span>
        <span className="ml-auto">{menu}</span>
      </div>
      <LevelCardBody node={node} />
    </div>
  )
}

/* ---------------- 途径卡片（静态「途径」徽标，无序号、无引用/拖拽） ---------------- */

function PathwayCard({
  pathway,
  index,
  onOpen,
  onRename,
  onCopy,
  onRemove,
}: {
  pathway: LevelPathway
  index: number
  onOpen: (index: number) => void
  onRename: (index: number) => void
  onCopy: (index: number) => void
  onRemove: (index: number) => void
}) {
  return (
    <div
      data-concept-name={pathway.name}
      role="button"
      tabIndex={0}
      aria-label={`查看 ${pathwayDisplayName(pathway)} 详情`}
      className="group/pathway min-w-0 cursor-pointer rounded-xl border border-border bg-card p-3 transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
      onClick={() => onOpen(index)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onOpen(index)
        }
      }}
    >
      <div className="flex min-w-0 items-center gap-2">
        <LevelSeqBadge tone="ink">途径</LevelSeqBadge>
        <span className="truncate text-sm font-semibold">{pathwayDisplayName(pathway)}</span>
        <span className="ml-auto">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  aria-label={`${pathwayDisplayName(pathway)} 菜单`}
                  className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-muted-foreground/15 group-hover/pathway:opacity-100 group-focus-within/pathway:opacity-100 data-popup-open:opacity-100"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                />
              }
            >
              <MoreHorizontal aria-hidden="true" className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onRename(index) }}>
                <Pencil aria-hidden="true" />重命名
              </DropdownMenuItem>
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onOpen(index) }}>
                <SquarePen aria-hidden="true" />编辑
              </DropdownMenuItem>
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onCopy(index) }}>
                <Copy aria-hidden="true" />复制
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={(e) => { e.stopPropagation(); onRemove(index) }}>
                <Trash2 aria-hidden="true" />删除
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      </div>
      <PathwayCardBody pathway={pathway} />
    </div>
  )
}

/* ---------------- 头部区：属性条 + 等级体系卡片（仅总览页） ---------------- */

function LevelSystemHeader({
  content,
  onChange,
  onBlur,
}: {
  content: LevelSystemContent
  onChange: (content: LevelSystemContent) => void
  onBlur?: () => void
}) {
  const FormIcon = FORM_ICONS[content.form]
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-border bg-muted/45 px-3 py-2 dark:bg-accent/60">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">等级类型</span>
          <div role="radiogroup" aria-label="等级类型" className="flex w-fit items-center gap-0.5 rounded-md border bg-muted p-0.5">
            {(Object.keys(LEVEL_SCOPE_LABELS) as LevelScope[]).map((scope) => {
              const Icon = SCOPE_ICONS[scope]
              return (
                <button
                  key={scope}
                  type="button"
                  role="radio"
                  aria-checked={content.scope === scope}
                  onClick={() => {
                    if (content.scope === scope) return
                    onChange({ ...content, scope })
                    onBlur?.()
                  }}
                  className={cn(
                    "flex h-7 items-center gap-1.5 rounded px-2.5 text-[13px] transition-colors",
                    content.scope === scope
                      ? "bg-card font-medium text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Icon aria-hidden="true" className="size-3.5" />
                  {LEVEL_SCOPE_LABELS[scope]}
                </button>
              )
            })}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">等级形态</span>
          <span
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-[13px] leading-7 font-medium"
            title="形态在创建时确定，不可修改"
          >
            <FormIcon aria-hidden="true" className="size-3.5 text-muted-foreground" />
            {LEVEL_FORM_LABELS[content.form]}
            <Lock aria-hidden="true" className="size-3 text-muted-foreground/60" />
          </span>
        </div>
      </div>

      <section aria-label="等级体系" className="flex flex-col gap-2.5 rounded-xl border border-primary/30 bg-primary/[0.04] p-3.5">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold tracking-wide text-primary">
          <ScrollText aria-hidden="true" className="size-3.5" />
          等级体系
        </span>
        <div className="grid gap-1.5">
          <Label>体系介绍</Label>
          <Textarea
            value={content.description}
            onChange={(e) => onChange({ ...content, description: e.target.value })}
            onBlur={onBlur}
            placeholder="一两句话概述这套等级体系"
            rows={2}
            className="resize-none overflow-hidden"
          />
        </div>
        <div className="grid gap-1.5">
          <Label>等级规则</Label>
          <Textarea
            value={content.rules}
            onChange={(e) => onChange({ ...content, rules: e.target.value })}
            onBlur={onBlur}
            placeholder="晋升、互斥、代价等适用于整套体系的通用规则，如「途径之间不可交互晋升」"
            rows={2}
            className="resize-none overflow-hidden"
          />
        </div>
      </section>
    </>
  )
}

/* ---------------- 面包屑 ---------------- */

function NavCrumbs({
  back,
  crumbs,
  ariaLabel,
}: {
  back: () => void
  crumbs: { label: string; onClick?: () => void }[]
  ariaLabel: string
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Button type="button" variant="outline" size="sm" onClick={back}>
        <ArrowLeft />
        返回
      </Button>
      <nav aria-label={ariaLabel} className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
        {crumbs.map((c, i) => (
          <span key={i} className="flex min-w-0 items-center gap-1">
            {i > 0 && <span className="opacity-50">/</span>}
            {i === crumbs.length - 1 || !c.onClick ? (
              <span className="truncate font-medium text-foreground">{c.label}</span>
            ) : (
              <button type="button" className="truncate hover:text-foreground hover:underline" onClick={c.onClick}>
                {c.label}
              </button>
            )}
          </span>
        ))}
      </nav>
    </div>
  )
}

/* ---------------- 等级总览（单途径总览 / 途径内等级管理区共用） ---------------- */

function LevelOverview({
  levels,
  settingId,
  settingName,
  onOpen,
  onRename,
  onCopy,
  onRemove,
  onQuote,
  onAdd,
}: {
  levels: LevelNode[]
  settingId: string
  settingName: string
  onOpen: (path: Path) => void
  onRename: (path: Path) => void
  onCopy: (path: Path) => void
  onRemove: (path: Path) => void
  onQuote: (path: Path) => void
  onAdd: () => void
}) {
  return (
    <>
      {levels.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-border p-6">
          <p className="text-sm text-muted-foreground">还没有等级。添加第一个等级，从低到高依次排列。</p>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(280px,100%),1fr))] items-start gap-3">
          {levels.map((l, i) => (
            <LevelCard key={i} node={l} path={[i]} depth={0} settingId={settingId} settingName={settingName} onOpen={onOpen} onRename={onRename} onCopy={onCopy} onRemove={onRemove} onQuote={onQuote} />
          ))}
        </div>
      )}
      <Button type="button" variant="outline" size="sm" className="self-start" onClick={onAdd}>
        <Plus />
        添加等级
      </Button>
    </>
  )
}

/* ---------------- 等级详情（单途径 / 途径内共用；面包屑由调用方拼） ---------------- */

function LevelDetail({
  levels,
  path,
  settingId,
  settingName,
  onLevelsChange,
  onBlur,
  setPath,
  openRename,
  duplicate,
  remove,
  quote,
  crumbs,
  back,
}: {
  levels: LevelNode[]
  path: Path
  settingId: string
  settingName: string
  onLevelsChange: (levels: LevelNode[]) => void
  onBlur?: () => void
  setPath: (path: Path | null) => void
  openRename: (path: Path) => void
  duplicate: (path: Path) => void
  remove: (path: Path) => void
  quote: (path: Path) => void
  crumbs: { label: string; onClick?: () => void }[]
  back: () => void
}) {
  const node = getAt(levels, path)
  if (!node) return null
  const seqLabel = path.length === 1 ? `等级 ${path[0] + 1}` : `子级 ${path[path.length - 1] + 1}`
  const patchAt = (p: Path, patch: Partial<LevelNode>) => onLevelsChange(updateAt(levels, p, patch))

  return (
    <>
      <NavCrumbs back={back} crumbs={crumbs} ariaLabel="等级路径" />

      <div className="grid gap-2">
        <Label>等级名称 · {seqLabel}</Label>
        <Input
          value={node.name}
          onChange={(e) => patchAt(path, { name: e.target.value })}
          onBlur={onBlur}
          placeholder="如：序列九 雾行者"
          className="font-medium"
        />
      </div>

      <div className="grid gap-2">
        <Label>等级别名（{node.aliases.length}）</Label>
        <TagInput
          values={node.aliases}
          onChange={(aliases) => patchAt(path, { aliases })}
          onBlur={onBlur}
          placeholder="输入别名，回车添加"
          ariaLabel="等级别名"
        />
        <p className="text-xs text-muted-foreground">同一等级在不同体系/语境下的叫法，如「序列九占卜家」「占卜家途径序列一」</p>
      </div>

      <div className="grid gap-2">
        <Label>等级标签（{node.tags.length}）</Label>
        <TagInput
          values={node.tags}
          onChange={(tags) => patchAt(path, { tags })}
          onBlur={onBlur}
          placeholder="输入标签，回车添加"
          ariaLabel="等级标签"
        />
        <p className="text-xs text-muted-foreground">标识该等级的特殊性，如低序列 / 中序列 / 高序列 / 天使序列，显示在卡片能力列表上方</p>
      </div>

      <div className="grid gap-2">
        <Label>进阶条件</Label>
        <Textarea
          value={node.condition}
          onChange={(e) => patchAt(path, { condition: e.target.value })}
          onBlur={onBlur}
          placeholder="晋升到该等级所需的条件、仪式或代价"
          rows={2}
          className="resize-none overflow-hidden"
        />
      </div>

      <div className="grid gap-2">
        <Label>等级介绍</Label>
        <Textarea
          value={node.description}
          onChange={(e) => patchAt(path, { description: e.target.value })}
          onBlur={onBlur}
          placeholder="一两句话概述该等级，也可展开详写"
          rows={2}
          className="resize-none overflow-hidden"
        />
      </div>

      <div className="grid gap-2">
        <Label>能力表现（{node.abilities.length}）</Label>
        {node.abilities.map((a, i) => (
          <div key={i} className="flex flex-col gap-1.5 rounded-lg border border-border bg-muted/40 p-2.5 dark:bg-accent/40">
            <div className="flex items-center gap-2">
              <Input
                value={a.name}
                onChange={(e) =>
                  patchAt(path, {
                    abilities: node.abilities.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                  })
                }
                onBlur={onBlur}
                placeholder="能力名称"
                className="bg-transparent dark:bg-transparent"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="删除该能力"
                onClick={() => {
                  patchAt(path, { abilities: node.abilities.filter((_, j) => j !== i) })
                  onBlur?.()
                }}
              >
                <Trash2 className="text-muted-foreground" />
              </Button>
            </div>
            <Textarea
              value={a.description}
              onChange={(e) =>
                patchAt(path, {
                  abilities: node.abilities.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)),
                })
              }
              onBlur={onBlur}
              placeholder="能力描述"
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
          onClick={() => {
            patchAt(path, { abilities: [...node.abilities, { name: "", description: "" }] })
            onBlur?.()
          }}
        >
          <Plus />
          添加能力
        </Button>
      </div>

      <div className="grid gap-2">
        <Label>子等级（{node.children.length}）</Label>
        {node.children.length > 0 ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(240px,100%),1fr))] items-start gap-2">
            {node.children.map((c, i) => (
              <LevelCard key={i} node={c} path={[...path, i]} depth={path.length} settingId={settingId} settingName={settingName} onOpen={(p) => setPath(p)} onRename={openRename} onCopy={duplicate} onRemove={remove} onQuote={quote} />
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">暂无子等级</p>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => {
            patchAt(path, { children: [...node.children, emptyLevel()] })
            setPath([...path, node.children.length])
          }}
        >
          <Plus />
          添加子等级
        </Button>
      </div>

      <div className="flex justify-end border-t border-border pt-3">
        <Button type="button" variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => remove(path)}>
          <Trash2 />
          删除该等级
        </Button>
      </div>
    </>
  )
}

/* ---------------- 主组件 ---------------- */

type RenameTarget = { kind: "level"; path: Path } | { kind: "pathway"; index: number }

export function LevelSystemEditor({
  content,
  onChange,
  onBlur,
  focusConcept,
  settingId,
  settingName,
}: {
  content: LevelSystemContent
  onChange: (content: LevelSystemContent) => void
  onBlur?: () => void
  focusConcept?: ConceptFocus
  /** 所属设定 id：「引用到对话」组装芯片序列 `@[设定·等级/{settingId}·{等级名}]` 用 */
  settingId: string
  /** 所属设定名称：芯片展示组标签 */
  settingName: string
}) {
  const [pathway, setPathway] = useState<number | null>(null)
  const [path, setPath] = useState<Path | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null)
  const [renameValue, setRenameValue] = useState("")

  const isMulti = content.form === "MULTI_PATHWAY"
  const currentPathway = isMulti && pathway !== null ? (content.pathways[pathway] ?? null) : null
  /** 当前等级序列：单途径为 content.levels；多途径进入途径后为该途径的 levels */
  const activeLevels = isMulti ? (currentPathway?.levels ?? []) : content.levels
  const setActiveLevels = (levels: LevelNode[]) => {
    if (isMulti && pathway !== null) {
      onChange({ ...content, pathways: patchPathwayAt(content.pathways, pathway, { levels }) })
    } else {
      onChange({ ...content, levels })
    }
  }

  useEffect(() => {
    if (!focusConcept) return
    const name = focusConcept.name
    // 多途径：途径名命中时进入该途径详情
    if (content.form === "MULTI_PATHWAY") {
      const pi = content.pathways.findIndex((p) => p.name === name || p.aliases.includes(name))
      if (pi >= 0) {
        const el = containerRef.current
        requestAnimationFrame(() => {
          setPathway(pi)
          setPath(null)
          el?.classList.add("setting-concept-flash")
          setTimeout(() => el?.classList.remove("setting-concept-flash"), 2400)
        })
        return
      }
    }
    const loc = findLevelInContent(content, name)
    if (loc) {
      const el = containerRef.current
      // 在帧回调里进入目标详情，避免 effect 内同步 setState 造成级联渲染
      requestAnimationFrame(() => {
        setPathway(loc.pathwayIndex)
        setPath(loc.path)
        el?.classList.add("setting-concept-flash")
        setTimeout(() => el?.classList.remove("setting-concept-flash"), 2400)
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- content 刻意不依赖：定位请求按 key 触发一次
  }, [focusConcept])

  /* ---------- 等级操作（作用于当前等级序列） ---------- */

  const patchLevels = (levels: LevelNode[]) => setActiveLevels(levels)

  const removeLevel = (p: Path) => {
    const node = getAt(activeLevels, p)
    if (!node) return
    const n = countDescendants(node)
    const msg = n > 0 ? `该等级包含 ${n} 个子等级，将一并删除。确认删除「${displayName(node)}」？` : `确认删除「${displayName(node)}」？`
    if (!window.confirm(msg)) return
    patchLevels(removeAt(activeLevels, p))
    onBlur?.()
    setPath((cur) => (cur && cur.length > 1 ? cur.slice(0, -1) : null))
  }

  const duplicateLevel = (p: Path) => {
    patchLevels(insertCopyAfter(activeLevels, p))
    onBlur?.()
    toast.success("已复制等级")
  }

  const quoteLevel = (p: Path) => {
    const node = getAt(activeLevels, p)
    if (!node) return
    const { tabs, activeTabId } = useTabsStore.getState()
    const novelId = tabs.find((t) => t.id === activeTabId)?.novelId ?? null
    if (!novelId) {
      toast.error("请先打开一个作品页签，再引用到对话")
      return
    }
    // 草稿只放 @[设定·等级/{settingId}·等级名] 芯片序列（composer 渲染为可悬停查看详情的
    // 引用芯片，等级内容靠悬停卡/getSetting 按需读取）；序列携带 settingId 供按 id 精确反查
    const chip = buildLevelChip({ settingId, settingName, levelName: displayName(node) }).insertText
    // 追加到当前输入框草稿（不开新会话、不动右侧面板）；空草稿直接放入，非空换行续接
    const { draft } = useChatStore.getState()
    useChatStore.setState({ draftNovelId: novelId, draft: draft.trim() ? `${draft.trimEnd()}\n${chip} ` : `${chip} ` })
    dispatchChatUiEvent(CHAT_FOCUS_COMPOSER_EVENT)
  }

  const addLevel = () => {
    patchLevels([...activeLevels, emptyLevel()])
    setPath([activeLevels.length])
  }

  /* ---------- 途径操作 ---------- */

  const patchPathways = (pathways: LevelPathway[]) => onChange({ ...content, pathways })

  const removePathway = (index: number) => {
    const pw = content.pathways[index]
    if (!pw) return
    const n = countPathwayLevels(pw)
    const msg = n > 0 ? `该途径包含 ${n} 个等级，将一并删除。确认删除「${pathwayDisplayName(pw)}」？` : `确认删除「${pathwayDisplayName(pw)}」？`
    if (!window.confirm(msg)) return
    patchPathways(removePathwayAt(content.pathways, index))
    onBlur?.()
    setPathway(null)
    setPath(null)
  }

  const duplicatePathway = (index: number) => {
    patchPathways(insertPathwayCopyAfter(content.pathways, index))
    onBlur?.()
    toast.success("已复制途径")
  }

  const addPathway = () => {
    patchPathways([...content.pathways, emptyPathway()])
    setPathway(content.pathways.length)
    setPath(null)
  }

  /* ---------- 重命名（等级 / 途径共用对话框） ---------- */

  const openRenameLevel = (p: Path) => {
    const node = getAt(activeLevels, p)
    if (!node) return
    setRenameValue(node.name)
    setRenameTarget({ kind: "level", path: p })
  }

  const openRenamePathway = (index: number) => {
    const pw = content.pathways[index]
    if (!pw) return
    setRenameValue(pw.name)
    setRenameTarget({ kind: "pathway", index })
  }

  const submitRename = () => {
    if (!renameTarget) return
    if (renameTarget.kind === "level") {
      patchLevels(updateAt(activeLevels, renameTarget.path, { name: renameValue.trim() }))
    } else {
      patchPathways(patchPathwayAt(content.pathways, renameTarget.index, { name: renameValue.trim() }))
    }
    onBlur?.()
    setRenameTarget(null)
  }

  const renameDialog = (
    <Dialog open={renameTarget !== null} onOpenChange={(o) => !o && setRenameTarget(null)}>
      <DialogContent>
        <form
          className="contents"
          onSubmit={(e) => {
            e.preventDefault()
            submitRename()
          }}
        >
          <DialogHeader>
            <DialogTitle>{renameTarget?.kind === "pathway" ? "重命名途径" : "重命名等级"}</DialogTitle>
            <DialogDescription>
              {renameTarget?.kind === "pathway" ? "修改该途径的名称。" : "修改该等级的名称。"}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="level-rename-input">{renameTarget?.kind === "pathway" ? "途径名称" : "等级名称"}</Label>
            <Input
              id="level-rename-input"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              maxLength={100}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRenameTarget(null)}>
              取消
            </Button>
            <Button type="submit" disabled={!renameValue.trim()}>
              保存
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )

  /* ---------- 等级详情（单途径 / 途径内共用） ---------- */

  const levelDetailView = (levels: LevelNode[], p: Path) => {
    const crumbs: { label: string; onClick?: () => void }[] = isMulti
      ? [
          { label: "途径列表", onClick: () => { setPath(null); setPathway(null) } },
          { label: currentPathway ? pathwayDisplayName(currentPathway) : "途径", onClick: () => setPath(null) },
        ]
      : [{ label: "等级列表", onClick: () => setPath(null) }]
    let acc: Path = []
    for (const i of p) {
      acc = [...acc, i]
      const n = getAt(levels, acc)
      if (n) {
        const target = acc
        crumbs.push({ label: displayName(n), onClick: () => setPath(target) })
      }
    }
    return (
      <div ref={containerRef} className="@container flex h-full flex-col gap-4">
        <LevelDetail
          levels={levels}
          path={p}
          settingId={settingId}
          settingName={settingName}
          onLevelsChange={patchLevels}
          onBlur={onBlur}
          setPath={setPath}
          openRename={openRenameLevel}
          duplicate={duplicateLevel}
          remove={removeLevel}
          quote={quoteLevel}
          crumbs={crumbs}
          back={() => setPath((cur) => (cur && cur.length > 1 ? cur.slice(0, -1) : null))}
        />
        {renameDialog}
      </div>
    )
  }

  /* ---------------- 视图分派 ---------------- */

  // 单途径
  if (!isMulti) {
    if (path !== null) {
      const node = getAt(content.levels, path)
      if (!node) {
        // 节点被删除后路径失效，回总览
        setPath(null)
        return null
      }
      return levelDetailView(content.levels, path)
    }
    return (
      <div ref={containerRef} className="@container flex h-full flex-col gap-3">
        <LevelSystemHeader content={content} onChange={onChange} onBlur={onBlur} />
        <LevelOverview
          levels={content.levels}
          settingId={settingId}
          settingName={settingName}
          onOpen={setPath}
          onRename={openRenameLevel}
          onCopy={duplicateLevel}
          onRemove={removeLevel}
          onQuote={quoteLevel}
          onAdd={addLevel}
        />
        {renameDialog}
      </div>
    )
  }

  // 多途径 · 途径列表
  if (pathway === null || !currentPathway) {
    if (pathway !== null && !currentPathway) {
      // 途径被删除后下标失效，回列表
      setPathway(null)
      setPath(null)
      return null
    }
    return (
      <div ref={containerRef} className="@container flex h-full flex-col gap-3">
        <LevelSystemHeader content={content} onChange={onChange} onBlur={onBlur} />
        {content.pathways.length === 0 ? (
          <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-border p-6">
            <p className="text-sm text-muted-foreground">还没有途径。添加第一条途径，为它建立从低到高的等级序列。</p>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(280px,100%),1fr))] items-start gap-3">
            {content.pathways.map((pw, i) => (
              <PathwayCard key={i} pathway={pw} index={i} onOpen={(idx) => { setPathway(idx); setPath(null) }} onRename={openRenamePathway} onCopy={duplicatePathway} onRemove={removePathway} />
            ))}
          </div>
        )}
        <Button type="button" variant="outline" size="sm" className="self-start" onClick={addPathway}>
          <Plus />
          添加途径
        </Button>
        {renameDialog}
      </div>
    )
  }

  // 多途径 · 途径内等级详情
  if (path !== null) {
    const node = getAt(currentPathway.levels, path)
    if (!node) {
      setPath(null)
      return null
    }
    return levelDetailView(currentPathway.levels, path)
  }

  // 多途径 · 途径详情（头部卡片 + 等级管理区）
  return (
    <div ref={containerRef} className="@container flex h-full flex-col gap-4">
      <NavCrumbs
        back={() => { setPathway(null); setPath(null) }}
        crumbs={[
          { label: "途径列表", onClick: () => { setPathway(null); setPath(null) } },
          { label: pathwayDisplayName(currentPathway) },
        ]}
        ariaLabel="途径路径"
      />

      <section
        aria-label="途径信息"
        className="flex flex-col gap-3 rounded-xl border border-[color-mix(in_srgb,var(--ink-blue)_32%,transparent)] bg-[color-mix(in_srgb,var(--ink-blue)_6%,var(--card))] p-4"
      >
        <div className="flex min-w-0 items-center gap-2">
          <LevelSeqBadge tone="ink">途径</LevelSeqBadge>
          <Input
            value={currentPathway.name}
            onChange={(e) => patchPathways(patchPathwayAt(content.pathways, pathway, { name: e.target.value }))}
            onBlur={onBlur}
            placeholder="途径名称"
            className="font-semibold"
          />
          <LevelSeqBadge tone="ink">{`${currentPathway.levels.length} 个等级`}</LevelSeqBadge>
        </div>
        <div className="grid gap-2">
          <Label>途径别名（{currentPathway.aliases.length}）</Label>
          <TagInput
            values={currentPathway.aliases}
            onChange={(aliases) => patchPathways(patchPathwayAt(content.pathways, pathway, { aliases }))}
            onBlur={onBlur}
            placeholder="输入别名，回车添加"
            ariaLabel="途径别名"
          />
        </div>
        <div className="grid gap-2">
          <Label>途径标签（{currentPathway.tags.length}）</Label>
          <TagInput
            values={currentPathway.tags}
            onChange={(tags) => patchPathways(patchPathwayAt(content.pathways, pathway, { tags }))}
            onBlur={onBlur}
            placeholder="输入标签，回车添加"
            ariaLabel="途径标签"
          />
        </div>
        <div className="grid gap-2">
          <Label>途径介绍</Label>
          <Textarea
            value={currentPathway.description}
            onChange={(e) => patchPathways(patchPathwayAt(content.pathways, pathway, { description: e.target.value }))}
            onBlur={onBlur}
            placeholder="一两句话概述该途径：象征、权柄、代表人物"
            rows={2}
            className="resize-none overflow-hidden"
          />
        </div>
      </section>

      <div className="flex items-baseline gap-2 text-sm font-medium">
        等级序列
        <span className="text-xs font-normal text-muted-foreground">从低到高排列</span>
      </div>
      <LevelOverview
        levels={currentPathway.levels}
        settingId={settingId}
        settingName={settingName}
        onOpen={setPath}
        onRename={openRenameLevel}
        onCopy={duplicateLevel}
        onRemove={removeLevel}
        onQuote={quoteLevel}
        onAdd={addLevel}
      />

      <div className="flex justify-end border-t border-border pt-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="text-destructive hover:text-destructive"
          onClick={() => removePathway(pathway)}
        >
          <Trash2 />
          删除该途径
        </Button>
      </div>
      {renameDialog}
    </div>
  )
}
