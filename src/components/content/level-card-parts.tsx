"use client"

/**
 * 等级卡片的共享展示部件：等级体系编辑器（LevelSystemEditor）与 composer
 * 等级芯片悬停卡（ComposerChipHoverCard）共用同一套渲染，保证两处内容一致。
 */
import { cn } from "@/lib/utils"

import type { SettingType } from "@/generated/prisma/enums"
import { findLevelPath, normalizeContent, type LevelNode, type LevelPathway, type LevelSystemContent } from "./setting-content"

// findLevelPath 已移至 setting-content（纯 TS，供服务端共用），此处转引保持既有导入路径
export { findLevelPath }

/** 单条设定的最小形状（GET /api/novels/[id]/settings/[settingId] 响应的 setting） */
export interface SettingDetail {
  id: string
  name: string
  type: SettingType
  content: unknown
}

/** 序号徽标（等级 N / 子级 N / 途径）：ink 为墨蓝（途径），primary 为默认主色（等级） */
export function LevelSeqBadge({
  children,
  tone = "primary",
}: {
  children: React.ReactNode
  tone?: "primary" | "ink"
}) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-md border px-2 font-mono text-[11px] leading-5",
        tone === "ink"
          ? "border-[color-mix(in_srgb,var(--ink-blue)_30%,transparent)] bg-[color-mix(in_srgb,var(--ink-blue)_10%,transparent)] text-[var(--ink-blue)]"
          : "border-primary/30 bg-primary/10 text-primary"
      )}
    >
      {children}
    </span>
  )
}

/** 等级展示名：空名称兜底 */
export function levelDisplayName(node: LevelNode): string {
  return node.name.trim() || "未命名等级"
}

/** 卡片正文：别名 / 简介 / 标签 / 能力预览（≤3 条 + 「+N 更多能力」） */
export function LevelCardBody({ node }: { node: LevelNode }) {
  return (
    <>
      {node.aliases.length > 0 && (
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{node.aliases.join(" / ")}</p>
      )}
      <p
        className={cn(
          "mt-1 line-clamp-2 text-[13px] leading-relaxed",
          node.description.trim() ? "text-muted-foreground" : "text-muted-foreground/60"
        )}
      >
        {node.description.trim() || "暂无简介"}
      </p>
      {node.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {node.tags.map((t) => (
            <span
              key={t}
              className="rounded border border-[color-mix(in_srgb,var(--ink-blue)_28%,transparent)] bg-[color-mix(in_srgb,var(--ink-blue)_10%,transparent)] px-1.5 text-[11px] leading-[19px] font-medium text-[var(--ink-blue)]"
            >
              {t}
            </span>
          ))}
        </div>
      )}
      {node.abilities.length > 0 && (
        <div className="mt-2 flex flex-col gap-0.5">
          {node.abilities.slice(0, 3).map((a, i) => (
            <div key={i} className="flex items-center gap-1.5 truncate text-xs">
              <span className="size-[5px] shrink-0 rotate-45 rounded-[1.5px] bg-[var(--gold)]" />
              <span className="truncate">{a.name.trim() || "未命名能力"}</span>
            </div>
          ))}
          {node.abilities.length > 3 && (
            <div className="pl-3 text-xs text-muted-foreground">+{node.abilities.length - 3} 更多能力</div>
          )}
        </div>
      )}
    </>
  )
}

/** 等级在等级体系 content 中的位置：pathwayIndex 为 null 表示单途径 */
export interface LevelLocation {
  pathwayIndex: number | null
  path: number[]
}

/** 跨形态查找等级：多途径按途径顺序逐条查找（途径无高低之分，顺序仅为展示顺序） */
export function findLevelInContent(content: LevelSystemContent, name: string): LevelLocation | null {
  if (content.form === "MULTI_PATHWAY") {
    for (let i = 0; i < content.pathways.length; i++) {
      const path = findLevelPath(content.pathways[i].levels, name)
      if (path) return { pathwayIndex: i, path }
    }
    return null
  }
  const path = findLevelPath(content.levels, name)
  return path ? { pathwayIndex: null, path } : null
}

/** 途径展示名：空名称兜底 */
export function pathwayDisplayName(pathway: LevelPathway): string {
  return pathway.name.trim() || "未命名途径"
}

/** 途径等级数预览：「N 个等级 · 首名 → 末名」，空途径返回「暂无等级」 */
export function pathwayLevelsPreview(pathway: LevelPathway): string {
  const n = pathway.levels.length
  if (n === 0) return "暂无等级"
  const first = levelDisplayName(pathway.levels[0])
  const last = levelDisplayName(pathway.levels[n - 1])
  return n === 1 ? `1 个等级 · ${first}` : `${n} 个等级 · ${first} → ${last}`
}

/** 途径卡片正文：别名 / 简介 / 标签 / 等级数预览 */
export function PathwayCardBody({ pathway }: { pathway: LevelPathway }) {
  return (
    <>
      {pathway.aliases.length > 0 && (
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{pathway.aliases.join(" / ")}</p>
      )}
      <p
        className={cn(
          "mt-1 line-clamp-2 text-[13px] leading-relaxed",
          pathway.description.trim() ? "text-muted-foreground" : "text-muted-foreground/60"
        )}
      >
        {pathway.description.trim() || "暂无简介"}
      </p>
      {pathway.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {pathway.tags.map((t) => (
            <span
              key={t}
              className="rounded border border-[color-mix(in_srgb,var(--ink-blue)_28%,transparent)] bg-[color-mix(in_srgb,var(--ink-blue)_10%,transparent)] px-1.5 text-[11px] leading-[19px] font-medium text-[var(--ink-blue)]"
            >
              {t}
            </span>
          ))}
        </div>
      )}
      <div className="mt-2 flex items-center gap-1.5 text-xs">
        <span className="size-[5px] shrink-0 rotate-45 rounded-[1.5px] bg-[var(--gold)]" />
        <span className="truncate">{pathwayLevelsPreview(pathway)}</span>
      </div>
    </>
  )
}

/**
 * 等级悬停内容（composer 芯片与消息区实体芯片悬停卡共用）：序号徽标 +
 * 与面板卡片一致的正文（别名/简介/标签/能力预览）；setting 未返回时显示读取中。
 */
export function LevelHoverBody({ setting, levelName }: { setting: SettingDetail | undefined; levelName: string }) {
  // 与面板同一规整口径（旧扁平数据补空字段），保证渲染输入一致
  const content = setting
    ? (normalizeContent(setting.type, setting.content) as LevelSystemContent)
    : null
  const loc = content ? findLevelInContent(content, levelName) : null
  const levels = content && loc ? (loc.pathwayIndex === null ? content.levels : content.pathways[loc.pathwayIndex]?.levels ?? []) : []
  const path = loc?.path ?? null
  let node = null as LevelNode | null
  if (path) {
    let list = levels
    for (const i of path) {
      node = list[i] ?? null
      list = node?.children ?? []
    }
  }
  const name = node ? levelDisplayName(node) : levelName
  const seq = path ? (path.length === 1 ? `等级 ${path[0] + 1}` : `子级 ${path[path.length - 1] + 1}`) : null
  const pathwayName =
    content && loc?.pathwayIndex != null ? (content.pathways[loc.pathwayIndex]?.name.trim() || "未命名途径") : null

  return (
    <>
      <div className="flex items-center gap-2">
        {seq && <LevelSeqBadge>{seq}</LevelSeqBadge>}
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-foreground">{name}</div>
          <div className="truncate text-[11px] text-muted-foreground">
            设定·等级{setting ? ` · ${setting.name}` : ""}{pathwayName ? ` · ${pathwayName}` : ""}
          </div>
        </div>
      </div>
      {!setting ? (
        <p className="text-xs text-muted-foreground">正在读取…</p>
      ) : !node ? (
        <p className="text-xs text-muted-foreground">未找到该等级（可能已重命名或删除）</p>
      ) : (
        <LevelCardBody node={node} />
      )}
    </>
  )
}
