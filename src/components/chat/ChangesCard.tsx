"use client"

/**
 * 「本次改动」卡片：助手消息执行过写工具时，在消息下方聚合可点击的改动项，
 * 点击跳转到对应面板；删除项与暂未解析到的项不可点。
 */
import { useMemo } from "react"
import { ListChecks, Trash2, type LucideIcon } from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import type { SettingType } from "@/generated/prisma/enums"
import { getTabIcon } from "@/stores/tabs"

import { entityRefTooltip, openEntityRef, type EntityRef } from "./entity-refs"
import { summarizeOutput, WRITE_TOOLS, type ToolCallView } from "./types"
import type { EntityIndex } from "./use-entity-index"

interface ChangeItem {
  key: string
  label: string
  icon: LucideIcon
  ref: EntityRef | null
  /** 量化计数口径（§2.8）：新增 / 修改 / 删除 */
  action: "add" | "update" | "delete"
}

function iconForRef(ref: EntityRef): LucideIcon {
  switch (ref.kind) {
    case "character":
      return getTabIcon({ type: "character" })
    case "world":
      return getTabIcon({ type: "world" })
    case "setting":
      return getTabIcon({ type: "setting", settingType: ref.settingType })
    case "setting-tab":
      return getTabIcon({ type: "setting", settingType: ref.settingType })
    case "attributes":
      return getTabIcon({ type: "attributes" })
    case "trope":
      return getTabIcon({ type: "trope" })
    case "theme":
      return getTabIcon({ type: "theme" })
    case "outline":
      return getTabIcon({ type: "outline" })
    case "item":
      return getTabIcon({ type: "item" })
    case "scene":
      return getTabIcon({ type: "scene" })
    case "chapter":
      return getTabIcon({ type: "chapter-content" })
  }
}

/** 从写工具返回文案中提取「名称」（如 已删除角色「林墨」） */
function quotedName(output: unknown): string {
  return summarizeOutput("unknown", null, output).summary?.match(/「([^」]+)」/)?.[1] ?? ""
}

/** 从工具调用记录派生改动项（仅成功写工具；按实体去重。正文产物走 file-card，不在此列） */
export function deriveChanges(toolCalls: ToolCallView[], index: EntityIndex | undefined): ChangeItem[] {
  const items: ChangeItem[] = []
  if (!index) return items
  const push = (
    label: string,
    ref: EntityRef | null,
    action: ChangeItem["action"] = "update"
  ) => {
    label = label.trim() || (ref && "name" in ref ? ref.name.trim() : "") || "相关内容"
    const key =
      action !== "delete" && ref && "id" in ref
        ? `${ref.kind}:${ref.id}`
        : action === "delete"
          ? `del:${label}`
          : `${ref?.kind ?? "unknown"}:${label}`
    if (items.some((i) => i.key === key)) return
    items.push({ key, label, icon: ref ? iconForRef(ref) : Trash2, ref, action })
  }

  for (const call of toolCalls) {
    if (call.status !== "done") continue
    if (!WRITE_TOOLS.has(call.toolName)) continue
    if (!summarizeOutput(call.toolName, call.input, call.output).ok) continue

    const output = (call.output ?? {}) as Record<string, unknown>
    const input = (call.input ?? {}) as Record<string, unknown>
    const str = (v: unknown) => (typeof v === "string" ? v : "")

    switch (call.toolName) {
      case "upsertTheme":
        push(str(input.title) || "主题", { kind: "theme" })
        break
      case "createWorld":
        push(str(input.name), index.worldById(str(output.worldId) || str(input.worldId)) ?? index.worldByName(str(input.name)) ?? null, "add")
        break
      case "updateWorld": {
        const name = str(input.newName).trim() || quotedName(call.output).trim() || str(input.name).trim()
        const ref = index.worldById(str(output.worldId) || str(input.worldId)) ?? index.worldByName(name) ?? null
        push(name || (ref && "name" in ref ? ref.name : "") || "世界", ref)
        break
      }
      case "deleteWorld":
        push(quotedName(call.output) || str(input.name), null, "delete")
        break
      case "upsertSetting": {
        const type = str(input.type) as SettingType
        const name = str(input.name)
        push(name, index.settingByKey(type, name, str(input.world) || undefined, str(input.worldId) || undefined) ?? null)
        break
      }
      case "deleteSetting":
        push(quotedName(call.output) || str(input.name), null, "delete")
        break
      case "createCharacter":
        push(str(input.name), index.characterByName(str(input.name)) ?? null, "add")
        break
      case "updateCharacter": {
        const ref = index.characterById(str(input.characterId)) ?? null
        const name = (ref && "name" in ref ? ref.name : "") || str(input.name) || "角色"
        push(name, ref)
        break
      }
      case "deleteCharacter":
        push(quotedName(call.output) || "角色", null, "delete")
        break
      case "createItem":
        push(str(input.name), index.itemByName(str(input.name)) ?? null, "add")
        break
      case "updateItem": {
        const ref = index.itemById(str(input.itemId)) ?? null
        const name = str(input.name) || (ref && "name" in ref ? ref.name : "物品")
        push(name, ref)
        break
      }
      case "deleteItem":
        push(quotedName(call.output) || "物品", null, "delete")
        break
      case "createScene":
        push(str(input.name), index.sceneById(str((call.output as {sceneId?: unknown} | null)?.sceneId)) ?? null, "add")
        break
      case "updateScene": {
        const ref = index.sceneById(str(input.sceneId)) ?? null
        const name = str(input.name) || (ref && "name" in ref ? ref.name : "场景")
        push(name, ref)
        break
      }
      case "deleteScene":
        push(quotedName(call.output) || "场景", null, "delete")
        break
      case "upsertAttribute":
        push(str(input.name) || "属性", { kind: "attributes" })
        break
      case "deleteAttribute":
        push(quotedName(call.output) || "属性", null, "delete")
        break
      case "selectTrope":
        push("爽点/泪点", { kind: "trope" })
        break
      case "createCustomTrope":
        push(str(input.category) || "爽点/泪点", { kind: "trope" }, "add")
        break
      case "deleteCustomTrope":
        push(quotedName(call.output) || "爽点/泪点", null, "delete")
        break
      case "generateOutline":
        push("大纲", { kind: "outline" })
        break
      case "createVolume":
        push(str(input.title) || "分卷", { kind: "outline" }, "add")
        break
      case "updateVolumeOutline":
        push(str(input.title) || "卷大纲", { kind: "outline" })
        break
      case "createChapter":
        push(str(input.title) || "章节", { kind: "outline" }, "add")
        break
      case "updateChapterOutline":
        push(quotedName(call.output) || str(input.title) || "章节大纲", { kind: "outline" })
        break
      case "approveOutline":
        push(quotedName(call.output) || "大纲确认", { kind: "outline" })
        break
      case "finalizeChapter": {
        const ref = index.chapterById(str(input.chapterId)) ?? null
        const name =
          (ref && "name" in ref ? ref.name : "") || quotedName(call.output) || "章节正文"
        push(name, ref)
        break
      }
      default:
        break
    }
  }
  return items
}

export function ChangesCard({
  toolCalls,
  index,
  novelId,
}: {
  toolCalls: ToolCallView[]
  index: EntityIndex
  novelId: string
}) {
  const changes = useMemo(() => deriveChanges(toolCalls, index), [toolCalls, index])
  if (changes.length === 0) return null

  const added = changes.filter((c) => c.action === "add").length
  const updated = changes.filter((c) => c.action === "update").length
  const deleted = changes.filter((c) => c.action === "delete").length
  const tallies = [
    added > 0 ? `新增 ${added}` : null,
    updated > 0 ? `修改 ${updated}` : null,
    deleted > 0 ? `删除 ${deleted}` : null,
  ].filter(Boolean)

  return (
    <div className="chat-enter flex w-full max-w-full flex-col gap-1.5 rounded-card border border-(--chat-line) bg-chat-surface px-3 py-2 shadow-1">
      <div className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
        <ListChecks className="size-3.5" />
        本次改动 {changes.length} 项
        {tallies.length > 0 && (
          <span className="tabular-nums">
            {" · "}
            {tallies.map((t, i) => (
              <span
                key={t}
                className={cn(
                  t?.startsWith("新增") && "text-success",
                  t?.startsWith("删除") && "text-destructive"
                )}
              >
                {i > 0 ? " / " : ""}
                {t}
              </span>
            ))}
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {changes.map((item) => {
          const Icon = item.icon
          const isDeleted = item.action === "delete"
          const clickable = !isDeleted && item.ref !== null
          return (
            <button
              key={item.key}
              type="button"
              disabled={!clickable}
              title={
                isDeleted
                  ? `${item.label}（已删除）`
                  : item.ref
                    ? entityRefTooltip(item.ref)
                    : "未找到对应内容"
              }
              onClick={() => {
                if (!item.ref) {
                  toast.error("未找到对应内容（可能刚被删除）")
                  return
                }
                openEntityRef(item.ref, novelId)
              }}
              className={cn(
                "flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[12px] transition-colors",
                isDeleted
                  ? "cursor-default border-(--chat-line) text-muted-foreground line-through"
                  : clickable
                    ? "border-primary/30 text-primary hover:bg-active-wash"
                    : "cursor-default border-(--chat-line) text-muted-foreground"
              )}
            >
              <Icon className="size-3 shrink-0" />
              <span className="max-w-40 truncate">{item.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
