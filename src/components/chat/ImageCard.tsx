"use client"

/**
 * 图片产物卡（2026-08）：出图工具成功后在消息流展示生成的图片本身——
 * 顶部标题栏（《书名》封面 / 角色名 · 立绘 / 角色名 · 头像）+ 图片四周留白内嵌。
 * 宽度统一半栏（w-1/2，min-200px/max-360px）；高度按图片比例自适应（封面/立绘 2:3、头像 1:1）。
 * 点击跳转：封面 → 封面面板，角色图像 → 角色面板。
 */
import { ImageIcon } from "lucide-react"

import { buildTabId, useTabsStore } from "@/stores/tabs"

import { openEntityRef } from "./entity-refs"
import { summarizeOutput, type ToolCallView } from "./types"
import type { EntityIndex } from "./use-entity-index"

type ImageKind = "cover" | "avatar" | "portrait"

interface ImageCardEntry {
  key: string
  kind: ImageKind
  url: string
  title: string
  /** 点击跳转目标；null = 不可点（角色已删除等） */
  target: { type: "cover" } | { type: "character"; id: string; name: string } | null
}

/** 各出图类型的固定画幅（生成尺寸梯度均为该比例）：占位与 object-cover 裁切基准 */
const ASPECTS: Record<ImageKind, string> = {
  cover: "2 / 3",
  avatar: "1 / 1",
  portrait: "2 / 3",
}

/**
 * 角色图像的图片清单：新输出带结构化 images:[{kind,url}]；
 * 旧历史消息只有 urls:["头像（url）"] 文本条目，逐一解析兜底。
 */
function characterImagesOf(output: Record<string, unknown>): { kind: "avatar" | "portrait"; url: string }[] {
  if (Array.isArray(output.images)) {
    const parsed = output.images.flatMap<{ kind: "avatar" | "portrait"; url: string }>((it) => {
      const o = (it ?? {}) as Record<string, unknown>
      const kind = o.kind === "avatar" || o.kind === "portrait" ? o.kind : null
      return kind && typeof o.url === "string" && o.url ? [{ kind, url: o.url }] : []
    })
    if (parsed.length > 0) return parsed
  }
  if (!Array.isArray(output.urls)) return []
  return output.urls.flatMap((u) => {
    if (typeof u !== "string") return []
    const m = u.match(/^(头像|立绘)（(.+)）$/)
    return m ? [{ kind: m[1] === "头像" ? ("avatar" as const) : ("portrait" as const), url: m[2] }] : []
  })
}

/** 从工具调用记录提取图片条目（仅成功的 generateNovelCover / generateCharacterImage），按调用顺序 */
function deriveImageCards(toolCalls: ToolCallView[], index: EntityIndex): ImageCardEntry[] {
  const entries: ImageCardEntry[] = []
  for (const call of toolCalls) {
    if (call.status !== "done") continue
    if (call.toolName !== "generateNovelCover" && call.toolName !== "generateCharacterImage") continue
    if (!summarizeOutput(call.toolName, call.input, call.output).ok) continue
    const output = (call.output ?? {}) as Record<string, unknown>

    if (call.toolName === "generateNovelCover") {
      if (typeof output.coverUrl !== "string" || !output.coverUrl) continue
      entries.push({
        key: call.toolCallId,
        kind: "cover",
        url: output.coverUrl,
        title: index.novelTitle ? `《${index.novelTitle}》封面` : "小说封面",
        target: { type: "cover" },
      })
      continue
    }

    const input = (call.input ?? {}) as Record<string, unknown>
    const characterId = typeof input.characterId === "string" ? input.characterId : null
    // 角色名优先取实体索引，回退返回文案里的「角色名」（索引未加载/角色已删时标题仍可读）
    const ref = characterId ? index.characterById(characterId) : undefined
    const refName = ref && "name" in ref ? ref.name : null
    const msgName =
      typeof output.message === "string"
        ? (output.message.match(/角色「([^」]+)」/)?.[1] ?? null)
        : null
    const name = refName ?? msgName
    for (const img of characterImagesOf(output)) {
      entries.push({
        key: `${call.toolCallId}-${img.kind}`,
        kind: img.kind,
        url: img.url,
        title: `${name ?? "角色"} · ${img.kind === "avatar" ? "头像" : "立绘"}`,
        target: characterId && name ? { type: "character", id: characterId, name } : null,
      })
    }
  }
  return entries
}

export function ImageCards({
  toolCalls,
  index,
  novelId,
}: {
  toolCalls: ToolCallView[]
  index: EntityIndex
  novelId: string
}) {
  const openTab = useTabsStore((s) => s.openTab)
  const entries = deriveImageCards(toolCalls, index)
  if (entries.length === 0) return null

  return (
    <>
      {entries.map((e) => (
        <button
          key={e.key}
          type="button"
          disabled={!e.target}
          title={e.target ? (e.target.type === "cover" ? "打开封面面板" : "打开角色面板") : undefined}
          onClick={() => {
            if (!e.target) return
            if (e.target.type === "cover") {
              openTab({
                id: buildTabId("novel-cover", novelId),
                type: "novel-cover",
                novelId,
                title: "小说封面",
              })
            } else {
              openEntityRef({ kind: "character", id: e.target.id, name: e.target.name }, novelId)
            }
          }}
          className="chat-enter group w-1/2 min-w-[200px] max-w-[360px] overflow-hidden rounded-card border border-(--chat-line) bg-chat-surface text-left shadow-1 transition-colors hover:border-primary disabled:cursor-default disabled:hover:border-(--chat-line)"
        >
          <div className="flex items-center gap-1.5 border-b border-(--chat-line) px-3.5 py-2">
            <ImageIcon className="size-3.5 shrink-0 text-primary" />
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
              {e.title}
            </span>
          </div>
          <div className="p-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- 本地生成图，画幅比例按出图类型固定 */}
            <img
              src={e.url}
              alt={e.title}
              style={{ aspectRatio: ASPECTS[e.kind] }}
              className="block h-auto w-full rounded-inner border border-border object-cover"
            />
          </div>
        </button>
      ))}
    </>
  )
}
