/**
 * 物品等级引用（Item.levels Json）的结构规整、展示标签与失效判定。
 * 纯函数模块（无 React / 客户端-only 依赖），服务端（services/item）与前端面板共用。
 * 等级名称匹配口径复用 setting-content 的 findLevelPath（与 buildLevelChip 序列一致）。
 */
import type { SettingType } from "@/generated/prisma/enums"

import {
  findLevelPath,
  normalizeContent,
  type LevelSystemContent,
} from "./setting-content"

/** 物品上的一条等级引用：单途径体系 pathway 为 null；多途径体系 pathway 为途径名（必填） */
export type ItemLevelRef = {
  settingId: string
  pathway: string | null
  level: string
}

/** 把 DB Json 规整为等级引用数组：丢弃结构不合法条目，按 settingId+pathway+level 去重（保序） */
export function normalizeItemLevels(input: unknown): ItemLevelRef[] {
  if (!Array.isArray(input)) return []
  const out: ItemLevelRef[] = []
  const seen = new Set<string>()
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue
    const o = raw as Record<string, unknown>
    const settingId = typeof o.settingId === "string" ? o.settingId.trim() : ""
    const level = typeof o.level === "string" ? o.level.trim() : ""
    const pathway = typeof o.pathway === "string" && o.pathway.trim() ? o.pathway.trim() : null
    if (!settingId || !level) continue
    const key = `${settingId} ${pathway ?? ""} ${level}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ settingId, pathway, level })
  }
  return out
}

/** 展示标签：多途径「途径 · 等级」，单途径仅等级名 */
export function itemLevelLabel(ref: ItemLevelRef): string {
  return ref.pathway ? `${ref.pathway} · ${ref.level}` : ref.level
}

/** 物品可选的等级体系：设定 id + 名称 + 规整后的等级体系内容 */
export interface ItemLevelSystem {
  settingId: string
  name: string
  content: LevelSystemContent
}

/** 该设定是否为「适用对象含物品」的等级体系 */
export function isItemLevelSystem(s: { type: SettingType; content: unknown }): boolean {
  if (s.type !== "LEVEL_SYSTEM") return false
  const content = normalizeContent("LEVEL_SYSTEM", s.content) as LevelSystemContent
  return content.scope === "ITEM" || content.scope === "GENERAL"
}

/** 失效原因：体系不存在 / scope 不含物品 / 途径不存在（多途径缺途径同） / 等级节点不存在 */
export type ItemLevelInvalidReason =
  | "system-missing"
  | "scope-excluded"
  | "pathway-missing"
  | "level-missing"

export type ItemLevelRefStatus =
  | { status: "ok" }
  | { status: "invalid"; reason: ItemLevelInvalidReason }

/** 失效判定：体系存在 → scope 含物品 →（多途径）途径存在 → findLevelPath 命中 */
export function findItemLevelRef(
  systems: ItemLevelSystem[],
  ref: ItemLevelRef
): ItemLevelRefStatus {
  const system = systems.find((s) => s.settingId === ref.settingId)
  if (!system) return { status: "invalid", reason: "system-missing" }
  const { content } = system
  if (content.scope !== "ITEM" && content.scope !== "GENERAL") {
    return { status: "invalid", reason: "scope-excluded" }
  }
  if (content.form === "MULTI_PATHWAY") {
    if (!ref.pathway) return { status: "invalid", reason: "pathway-missing" }
    const pathway = content.pathways.find((p) => p.name === ref.pathway)
    if (!pathway) return { status: "invalid", reason: "pathway-missing" }
    return findLevelPath(pathway.levels, ref.level)
      ? { status: "ok" }
      : { status: "invalid", reason: "level-missing" }
  }
  return findLevelPath(content.levels, ref.level)
    ? { status: "ok" }
    : { status: "invalid", reason: "level-missing" }
}
