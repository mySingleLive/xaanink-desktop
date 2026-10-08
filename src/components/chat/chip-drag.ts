"use client"

/**
 * 引用芯片拖拽 payload：等级/角色等实体卡片跨组件树拖入 composer 的共用通道。
 * - 自定义 MIME 承载 JSON 序列化的 ChipData；text/plain 兜底同一 insertText
 *   （拖到纯文本框时插入可读引用序列）；
 * - startChipDrag 统一写入 payload 并生成小型名称药丸拖拽预览（卡片默认整卡
 *   快照过大，组卡片更甚）；
 * - 任何复用 composer-editor 映射的芯片输入框用 hasChipDrag / readChipDrag
 *   即可接入放置。
 */
import type { ChipData } from "./composer-editor"

/** 自定义拖拽 MIME（全小写：部分浏览器会归一 types） */
export const CHIP_DRAG_MIME = "application/x-xaanink-chip"

/** 名称中的方括号/换行会破坏 @[…] 序列语法，替换为空格（与提及候选同口径） */
export function sanitizeChipName(name: string): string {
  return name.replace(/[[\]\n]/g, " ").trim()
}

/** 角色引用芯片：`@[角色/{name}]`（与 @ 提及候选的 insertText 完全一致，可水合头像） */
export function buildCharacterChip(input: { name: string; avatarUrl?: string | null }): ChipData {
  const label = sanitizeChipName(input.name)
  return {
    insertText: `@[角色/${label}]`,
    label,
    groupLabel: "角色",
    kind: "character",
    avatarUrl: input.avatarUrl ?? null,
  }
}

/** 物品引用芯片：`@[物品/{name}]`（与 @ 提及候选的 insertText 完全一致，可水合图标） */
export function buildItemChip(input: { name: string; iconUrl?: string | null }): ChipData {
  const label = sanitizeChipName(input.name)
  return {
    insertText: `@[物品/${label}]`,
    label,
    groupLabel: "物品",
    kind: "item",
    avatarUrl: input.iconUrl ?? null,
  }
}

/** dragstart 写入 payload：自定义 MIME + text/plain 兜底 */
export function writeChipDrag(dt: DataTransfer, chip: ChipData) {
  dt.setData(CHIP_DRAG_MIME, JSON.stringify(chip))
  dt.setData("text/plain", chip.insertText)
  dt.effectAllowed = "copy"
}

/** dragover 阶段只能读 types：判断是否为芯片拖拽 */
export function hasChipDrag(dt: DataTransfer): boolean {
  return [...dt.types].includes(CHIP_DRAG_MIME)
}

/** drop 阶段读出芯片数据；非芯片拖拽或数据不完整返回 null */
export function readChipDrag(dt: DataTransfer): ChipData | null {
  if (!hasChipDrag(dt)) return null
  const raw = dt.getData(CHIP_DRAG_MIME)
  if (!raw) return null
  try {
    const data = JSON.parse(raw) as Partial<ChipData>
    if (
      typeof data.insertText !== "string" ||
      !/^@\[[^\]\n]{1,200}\](?:\([^\)\n]{1,300}\))?$/.test(data.insertText) ||
      !data.insertText.includes("/") ||
      typeof data.label !== "string" ||
      !data.label ||
      typeof data.groupLabel !== "string" ||
      typeof data.kind !== "string"
    ) {
      return null
    }
    const chip: ChipData = {
      insertText: data.insertText,
      label: data.label,
      groupLabel: data.groupLabel,
      kind: data.kind as ChipData["kind"],
      avatarUrl: typeof data.avatarUrl === "string" ? data.avatarUrl : null,
    }
    if (typeof data.settingType === "string") chip.settingType = data.settingType
    return chip
  } catch {
    return null
  }
}

/**
 * 卡片/树行 dragstart：写入芯片 payload + 名称药丸预览。
 * 预览元素需挂载且可见才能被 setDragImage 截取，offscreen 定位，dragend 时移除。
 */
export function startChipDrag(e: React.DragEvent<HTMLElement>, chip: ChipData) {
  writeChipDrag(e.dataTransfer, chip)
  const ghost = e.currentTarget.ownerDocument.createElement("div")
  ghost.textContent = chip.label
  ghost.style.cssText =
    "position:fixed;top:-200px;left:-200px;z-index:-1;padding:4px 12px;border-radius:9999px;" +
    "border:1px solid var(--border);background:var(--popover);color:var(--popover-foreground);" +
    "font-size:13px;font-weight:500;box-shadow:var(--shadow-lg);white-space:nowrap;"
  e.currentTarget.ownerDocument.body.appendChild(ghost)
  e.dataTransfer.setDragImage(ghost, ghost.offsetWidth / 2, ghost.offsetHeight / 2)
  e.currentTarget.addEventListener("dragend", () => ghost.remove(), { once: true })
}
