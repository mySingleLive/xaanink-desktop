"use client"

/**
 * 物品等级选择器（item-card-redesign §5.4）：气泡盒展示已选等级引用（金色 Badge + × 移除；
 * 失效项虚线置灰、仅可移除），尾部「＋ 选择等级」弹 Popover 按体系分组选择。
 * 数据来自本书 type=LEVEL_SYSTEM 设定（isItemLevelSystem 过滤 scope 含物品的体系）；
 * 单途径体系等级（含子等级，按树序扁平）平铺直选；多途径体系先途径导航、再进二级视图选等级。
 * 变更即 onChange(normalizeItemLevels(next))，保存由调用方（saveNow）触发。
 * 浮层用 @base-ui/react/popover（项目浮层基元，与 dropdown-menu 同源；仓库无 ui/popover 封装）。
 */
import { useState } from "react"
import { Popover } from "@base-ui/react/popover"
import { useQueries, useQuery } from "@tanstack/react-query"
import { Check, Plus, X } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import type { SettingType } from "@/generated/prisma/enums"
import { cn } from "@/lib/utils"

import { apiGet } from "./api"
import {
  findItemLevelRef,
  isItemLevelSystem,
  itemLevelLabel,
  normalizeItemLevels,
  type ItemLevelRef,
  type ItemLevelSystem,
} from "./item-levels"
import { levelDisplayName, pathwayDisplayName } from "./level-card-parts"
import {
  LEVEL_FORM_LABELS,
  normalizeContent,
  type LevelNode,
  type LevelSystemContent,
  type LevelPathway,
} from "./setting-content"

/** 等级引用数量上限（与 item-schema levels max 一致；达到后新增静默忽略，同 BubbleInput 口径） */
const ITEM_LEVELS_MAX = 10

interface LevelSettingRecord {
  id: string
  type: SettingType
  name: string
  content: unknown
}

/** 等级树按树序扁平化（depth 供子等级缩进；空名节点不可引用，渲染时过滤） */
function flattenLevels(
  levels: LevelNode[],
  depth = 0,
  out: { node: LevelNode; depth: number }[] = []
) {
  for (const node of levels) {
    out.push({ node, depth })
    flattenLevels(node.children, depth + 1, out)
  }
  return out
}

function sameRef(a: ItemLevelRef, b: ItemLevelRef) {
  return a.settingId === b.settingId && a.pathway === b.pathway && a.level === b.level
}

export function ItemLevelPicker({
  novelId,
  value,
  onChange,
}: {
  novelId: string
  value: ItemLevelRef[]
  onChange: (next: ItemLevelRef[]) => void
}) {
  const [open, setOpen] = useState(false)
  /** 多途径体系的二级导航：当前查看的途径（null=体系分组视图），关闭弹层时复位 */
  const [nav, setNav] = useState<{ settingId: string; pathway: string } | null>(null)

  // 小说级等级体系（type 服务端过滤）
  const { data, isLoading, isError } = useQuery({
    queryKey: ["settings", novelId, "LEVEL_SYSTEM"],
    queryFn: () =>
      apiGet<{ settings: LevelSettingRecord[] }>(
        `/api/novels/${novelId}/settings?type=LEVEL_SYSTEM`,
        "加载等级体系失败"
      ),
  })

  // 世界级等级体系：等级体系是世界级设定（挂世界），按世界逐个拉取；
  // key 与实体索引/世界面板共享（["settings", "world", id]），命中缓存零额外请求
  const { data: worldsData } = useQuery({
    queryKey: ["worlds", novelId],
    queryFn: () =>
      apiGet<{ worlds: { id: string }[] }>(`/api/novels/${novelId}/worlds`, "加载世界失败"),
  })
  const worldIds = (worldsData?.worlds ?? []).map((w) => w.id)
  const worldSettings = useQueries({
    queries: worldIds.map((id) => ({
      queryKey: ["settings", "world", id],
      queryFn: () =>
        apiGet<{ settings: LevelSettingRecord[] }>(
          `/api/novels/${novelId}/settings?worldId=${id}`,
          "加载设定失败"
        ),
    })),
  })

  const allSettings = [
    ...(data?.settings ?? []),
    ...worldSettings.flatMap((r) => r.data?.settings ?? []),
  ]
  const systems: ItemLevelSystem[] = [
    ...new Map(allSettings.map((s) => [s.id, s])).values(),
  ]
    .filter((s) => s.type === "LEVEL_SYSTEM")
    .filter(isItemLevelSystem)
    .map((s) => ({
      settingId: s.id,
      name: s.name,
      content: normalizeContent("LEVEL_SYSTEM", s.content) as LevelSystemContent,
    }))

  const emit = (next: ItemLevelRef[]) => onChange(normalizeItemLevels(next))

  const removeRef = (ref: ItemLevelRef) => emit(value.filter((v) => !sameRef(v, ref)))

  /** 点等级：已选（settingId+pathway+level 相同）再点取消；未选添加。二级视图选定后回到分组视图 */
  const toggleLevel = (ref: ItemLevelRef, fromPathwayView: boolean) => {
    if (value.some((v) => sameRef(v, ref))) {
      removeRef(ref)
      return
    }
    if (value.length >= ITEM_LEVELS_MAX) return
    emit([...value, ref])
    if (fromPathwayView) setNav(null)
  }

  /** 一组等级选项丸：已选打勾，子等级按深度缩进 */
  const renderLevelOptions = (
    system: ItemLevelSystem,
    pathway: string | null,
    flat: { node: LevelNode; depth: number }[],
    fromPathwayView: boolean
  ) => {
    const options = flat.filter(({ node }) => node.name.trim())
    if (options.length === 0) {
      return <p className="text-[11px] text-muted-foreground/80">暂无等级</p>
    }
    return (
      <div className="flex flex-wrap gap-[5px]">
        {options.map(({ node, depth }) => {
          const ref: ItemLevelRef = { settingId: system.settingId, pathway, level: node.name }
          const selected = value.some((v) => sameRef(v, ref))
          return (
            <button
              key={`${depth}:${node.name}`}
              type="button"
              aria-pressed={selected}
              onClick={() => toggleLevel(ref, fromPathwayView)}
              style={depth > 0 ? { marginLeft: depth * 10 } : undefined}
              className={cn(
                "inline-flex max-w-full items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors",
                selected
                  ? "border-gold bg-gold/10 text-gold"
                  : "border-border bg-card text-foreground hover:border-gold hover:text-gold"
              )}
            >
              {selected && <Check className="size-3" />}
              <span className="truncate">{levelDisplayName(node)}</span>
            </button>
          )
        })}
      </div>
    )
  }

  const navSystem = nav ? systems.find((s) => s.settingId === nav.settingId) : undefined
  const navPathway: LevelPathway | undefined =
    nav && navSystem?.content.form === "MULTI_PATHWAY"
      ? navSystem.content.pathways.find((p) => p.name === nav.pathway)
      : undefined

  /** 体系分组视图：单途径平铺等级；多途径先列途径（仅导航） */
  const groupsView = (
    <div className="flex flex-col gap-2.5">
      {systems.map((system, i) => (
        <div key={system.settingId} className={cn(i > 0 && "border-t border-border pt-2.5")}>
          <div className="mb-1.5 flex items-baseline justify-between gap-2 text-xs">
            <span className="font-medium">{system.name.trim() || "未命名体系"}</span>
            <span className="text-muted-foreground">{LEVEL_FORM_LABELS[system.content.form]}</span>
          </div>
          {system.content.form === "MULTI_PATHWAY" ? (
            <>
              {system.content.pathways.filter((p) => p.name.trim()).length > 0 ? (
                <div className="flex flex-wrap gap-[5px]">
                  {system.content.pathways
                    .filter((p) => p.name.trim())
                    .map((pathway) => (
                      <button
                        key={pathway.name}
                        type="button"
                        onClick={() => setNav({ settingId: system.settingId, pathway: pathway.name })}
                        className="inline-flex max-w-full items-center rounded-full border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:border-gold hover:text-gold"
                      >
                        <span className="truncate">{pathwayDisplayName(pathway)}</span>
                      </button>
                    ))}
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground/80">暂无途径</p>
              )}
              <p className="mt-1.5 text-[11px] text-muted-foreground/80">途径仅作导航，不可直接选定</p>
            </>
          ) : (
            renderLevelOptions(system, null, flattenLevels(system.content.levels), false)
          )}
        </div>
      ))}
    </div>
  )

  return (
    <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border border-input px-2.5 py-1.5">
      {value.map((ref) => {
        const label = itemLevelLabel(ref)
        const invalid = findItemLevelRef(systems, ref).status === "invalid"
        return (
          <Badge
            key={`${ref.settingId} ${ref.pathway ?? ""} ${ref.level}`}
            variant="secondary"
            title={invalid ? "等级引用已失效，仅可移除" : undefined}
            className={cn(
              "gap-1",
              invalid
                ? "border-dashed border-muted-foreground/50 bg-transparent text-muted-foreground"
                : "border-gold/50 bg-gold/10 text-gold"
            )}
          >
            <span className="truncate">{label}</span>
            <button
              type="button"
              aria-label={`移除等级 ${label}`}
              onClick={() => removeRef(ref)}
              className={cn(
                invalid
                  ? "text-muted-foreground hover:text-foreground"
                  : "text-gold/70 hover:text-gold"
              )}
            >
              <X className="size-3" />
            </button>
          </Badge>
        )
      })}
      <Popover.Root
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen)
          if (!nextOpen) setNav(null)
        }}
      >
        <Popover.Trigger className="inline-flex items-center gap-1 rounded-full border border-dashed border-input px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-gold hover:text-gold">
          <Plus className="size-3" />
          选择等级
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner
            side="bottom"
            align="start"
            sideOffset={6}
            className="isolate z-50 outline-none"
          >
            <Popover.Popup className="w-80 rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
              <div className="max-h-80 overflow-y-auto">
                {isLoading || worldSettings.some((r) => r.isLoading) ? (
                  <p className="text-xs text-muted-foreground">等级体系加载中…</p>
                ) : isError || worldSettings.some((r) => r.isError) ? (
                  <p className="text-xs text-muted-foreground">等级体系加载失败，请稍后重试</p>
                ) : systems.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    暂无物品类等级体系，先在世界观设定中创建
                  </p>
                ) : navSystem && navPathway ? (
                  <div>
                    <div className="mb-2 flex items-center gap-2 text-xs">
                      <button
                        type="button"
                        onClick={() => setNav(null)}
                        className="inline-flex items-center font-medium text-primary hover:underline"
                      >
                        ‹ 返回途径
                      </button>
                      <span className="text-muted-foreground">{pathwayDisplayName(navPathway)}</span>
                    </div>
                    {renderLevelOptions(
                      navSystem,
                      navPathway.name,
                      flattenLevels(navPathway.levels),
                      true
                    )}
                  </div>
                ) : (
                  groupsView
                )}
              </div>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </div>
  )
}
