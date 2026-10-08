"use client"

/**
 * 对话消息中的实体引用芯片：
 * - linkifyHtml 把渲染后的 HTML 里命中的实体名/类目词替换为 <button class="entity-ref"> 芯片
 * - entityRefFromElement 在点击时从芯片的 data 属性还原引用
 * - openEntityRef 负责打开右侧对应面板（含 WorldPanel/SettingPanel 的设定聚焦）
 */
import type { SettingType } from "@/generated/prisma/enums"
import { SETTING_TYPE_LABELS } from "@/lib/setting-types"
import { parseSceneIdentity } from "@/lib/scene-context"
import { MENTION_TOKEN_RE } from "@/lib/mention-token"
import { buildTabId, useTabsStore } from "@/stores/tabs"
import { specificEntityName, validEntityName } from "@/lib/entity-name"

/** 消息中可点击的实体引用（具体实体带 id，类目词指向分类面板） */
export type EntityRef =
  | { kind: "character"; id: string; name: string }
  | { kind: "world"; id: string; name: string }
  | {
      kind: "setting"
      id: string
      name: string
      settingType: SettingType
      worldId: string | null
      worldName?: string
      /** 设定内的子概念名（如等级体系的某一级）：点击后面板滚动定位并高亮该概念 */
      concept?: string
    }
  | { kind: "setting-tab"; settingType: SettingType }
  | { kind: "attributes" }
  | { kind: "trope" }
  | { kind: "theme" }
  | { kind: "outline" }
  | { kind: "item"; id: string; name: string }
  | { kind: "scene"; id: string; name: string }
  | { kind: "chapter"; id: string; name: string; view?: "content" | "outline" }

/** 芯片匹配所需的最小索引接口（由 use-entity-index 构建） */
export interface EntityMatchIndex {
  regex: RegExp | null
  resolve: (text: string) => EntityRef | undefined
  sceneIdentity?: (novelId: string, sceneId: string) => EntityRef | undefined
  resolveTyped?: (group: string, name: string) => EntityRef | undefined
}

/** 芯片悬浮提示（说明点击后打开什么） */
export function entityRefTooltip(ref: EntityRef): string {
  switch (ref.kind) {
    case "character":
      return `角色 · ${ref.name}`
    case "world":
      return `世界 · ${ref.name}`
    case "setting":
      return ref.concept
        ? `${SETTING_TYPE_LABELS[ref.settingType]} · ${ref.name} · ${ref.concept}`
        : `${SETTING_TYPE_LABELS[ref.settingType]} · ${ref.name}`
    case "setting-tab":
      return SETTING_TYPE_LABELS[ref.settingType]
    case "attributes":
      return "属性"
    case "trope":
      return "爽点/泪点"
    case "theme":
      return "主题"
    case "outline":
      return "大纲"
    case "item":
      return `物品 · ${ref.name}`
    case "scene":
      return `场景 · ${ref.name}`
    case "chapter":
      return `${ref.view === "outline" ? "大纲" : "正文"} · ${ref.name}`
  }
}

/** 打开实体引用对应的右侧面板 tab（设定类附带面板内聚焦） */
export function openEntityRef(ref: EntityRef, novelId: string) {
  const { openTab, requestPanelFocus } = useTabsStore.getState()
  switch (ref.kind) {
    case "character":
      openTab({
        id: buildTabId("character", novelId, { refId: ref.id }),
        type: "character",
        novelId,
        refId: ref.id,
        title: ref.name,
      })
      return
    case "world":
      openTab({
        id: buildTabId("world", novelId, { refId: ref.id }),
        type: "world",
        novelId,
        refId: ref.id,
        title: ref.name,
      })
      return
    case "setting": {
      if (ref.worldId) {
        // 世界级设定 → 打开所属世界面板并聚焦该设定
        const tabId = buildTabId("world", novelId, { refId: ref.worldId })
        openTab({
          id: tabId,
          type: "world",
          novelId,
          refId: ref.worldId,
          title: ref.worldName ?? "世界观",
        })
        requestPanelFocus(tabId, ref.id, ref.concept)
      } else {
        // 小说级设定（金手指/文风）→ 打开设定面板并聚焦该条目
        const tabId = buildTabId("setting", novelId, { settingType: ref.settingType })
        openTab({
          id: tabId,
          type: "setting",
          novelId,
          settingType: ref.settingType,
          title: SETTING_TYPE_LABELS[ref.settingType],
        })
        requestPanelFocus(tabId, ref.id, ref.concept)
      }
      return
    }
    case "setting-tab":
      openTab({
        id: buildTabId("setting", novelId, { settingType: ref.settingType }),
        type: "setting",
        novelId,
        settingType: ref.settingType,
        title: SETTING_TYPE_LABELS[ref.settingType],
      })
      return
    case "attributes":
      openTab({ id: buildTabId("attributes", novelId), type: "attributes", novelId, title: "属性" })
      return
    case "trope":
      openTab({ id: buildTabId("trope", novelId), type: "trope", novelId, title: "爽点/泪点" })
      return
    case "theme":
      openTab({ id: buildTabId("theme", novelId), type: "theme", novelId, title: "主题" })
      return
    case "outline":
      openTab({ id: buildTabId("outline", novelId), type: "outline", novelId, title: "大纲" })
      return
    case "item":
      openTab({
        id: buildTabId("item", novelId, { refId: ref.id }),
        type: "item",
        novelId,
        refId: ref.id,
        title: ref.name,
      })
      return
    case "scene":
      openTab({
        id: buildTabId("scene", novelId, { refId: ref.id }),
        type: "scene",
        novelId,
        refId: ref.id,
        title: ref.name,
      })
      return
    case "chapter":
      openTab({
        id: buildTabId(ref.view === "outline" ? "chapter-outline" : "chapter-content", novelId, { refId: ref.id }),
        type: ref.view === "outline" ? "chapter-outline" : "chapter-content",
        novelId,
        refId: ref.id,
        title: ref.name,
      })
      return
  }
}

/** 纯文本转义（用户消息进 dangerouslySetInnerHTML 前必须转义） */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/** 芯片化时跳过的祖先标签（代码块/行内代码/链接/按钮内不生成芯片） */
const SKIP_TAGS = new Set(["PRE", "CODE", "A", "BUTTON", "SCRIPT", "STYLE"])

/** @[组标签/展示名] 显式引用（composer 芯片序列化而来），如 @[正文/第1章 · 雨夜来客]；可带 @[组/名](技术标识) 负载，负载不进入芯片展示。正则统一来源：@/lib/mention-token */
const TYPED_MENTION_RE = MENTION_TOKEN_RE

/**
 * 显式引用 → 实体引用（用于点击跳转）：取 / 后的名称、剥掉章节「第N章 ·」前缀，
 * 交给名称匹配表解析（同名取先者）；解析不出则返回 undefined（芯片仍展示但不可点）。
 */
function resolveTypedMention(inner: string, index: EntityMatchIndex, payload?: string): EntityRef | undefined {
  if (payload?.startsWith("scene:")) {const identity = parseSceneIdentity(payload); return identity ? index.sceneIdentity?.(identity.novelId, identity.sceneId) : undefined}
  const slash = inner.indexOf("/")
  const name = slash >= 0 ? inner.slice(slash + 1) : inner
  const group = slash >= 0 ? inner.slice(0, slash) : ""
  if (index.resolveTyped) return index.resolveTyped(group, name)
  const title = name.replace(/^第\s*\d+\s*章\s*·\s*/, "")
  const ref = index.resolve(title) ?? index.resolve(name)
  if (ref?.kind === "chapter" && (group === "正文" || group === "大纲")) return { ...ref, view: group === "大纲" ? "outline" : "content" }
  return ref
}

function isSkippable(node: Text): boolean {
  let el = node.parentElement
  while (el) {
    if (SKIP_TAGS.has(el.tagName) || el.classList.contains("entity-ref")) return true
    el = el.parentElement
  }
  return false
}

function chipElement(doc: Document, text: string, ref: EntityRef): HTMLElement {
  const btn = doc.createElement("button")
  btn.setAttribute("type", "button")
  btn.setAttribute("class", "entity-ref")
  btn.setAttribute("data-kind", ref.kind)
  if ("id" in ref) btn.setAttribute("data-id", ref.id)
  if ("name" in ref && ref.name) btn.setAttribute("data-name", ref.name)
  if (ref.kind === "chapter") btn.setAttribute("data-chapter-view", ref.view ?? "content")
  if (ref.kind === "setting" || ref.kind === "setting-tab") {
    btn.setAttribute("data-setting-type", ref.settingType)
  }
  if (ref.kind === "setting") {
    if (ref.worldId) btn.setAttribute("data-world-id", ref.worldId)
    if (ref.worldName) btn.setAttribute("data-world-name", ref.worldName)
    if (ref.concept) btn.setAttribute("data-concept", ref.concept)
  }
  btn.setAttribute("title", entityRefTooltip(ref))
  btn.textContent = text
  return btn
}

function replaceMatches(doc: Document, node: Text, index: EntityMatchIndex) {
  const text = node.nodeValue ?? ""
  const regex = index.regex
  if (!regex) return
  regex.lastIndex = 0

  const frag = doc.createDocumentFragment()
  let last = 0
  let changed = false
  let m: RegExpExecArray | null
  while ((m = regex.exec(text))) {
    if (m[0].length === 0) {
      regex.lastIndex += 1
      continue
    }
    const ref = index.resolve(m[0])
    if (!ref || !specificEntityName(m[0])) continue
    if (m.index > last) frag.appendChild(doc.createTextNode(text.slice(last, m.index)))
    frag.appendChild(chipElement(doc, m[0], ref))
    last = m.index + m[0].length
    changed = true
  }
  if (!changed) return
  if (last < text.length) frag.appendChild(doc.createTextNode(text.slice(last)))
  node.parentNode?.replaceChild(frag, node)
}

function typedMentionChipElement(doc: Document, inner: string, index: EntityMatchIndex, payload?: string): HTMLElement {
  const ref = resolveTypedMention(inner, index, payload)
  if (ref) return chipElement(doc, inner, ref)
  // 解析不到实体（如资源已删）：仍渲染为芯片样式，但不可点击跳转
  const btn = doc.createElement("button")
  btn.setAttribute("type", "button")
  btn.setAttribute("class", "entity-ref")
  btn.setAttribute("title", payload?.startsWith("scene:") ? "场景已删除或不属于当前作品" : inner)
  btn.textContent = inner
  return btn
}

/** 第一遍：把 @[类型/名称] 显式引用整颗替换为芯片（内容即类型化标签，如 正文/第1章 · 雨夜来客） */
function replaceTypedMentions(doc: Document, node: Text, index: EntityMatchIndex) {
  const text = node.nodeValue ?? ""
  TYPED_MENTION_RE.lastIndex = 0

  const frag = doc.createDocumentFragment()
  let last = 0
  let changed = false
  let m: RegExpExecArray | null
  while ((m = TYPED_MENTION_RE.exec(text))) {
    const name = m[1].slice(m[1].indexOf("/") + 1).replace(/^第\s*\d+\s*章\s*·\s*/, "")
    if (!validEntityName(name)) continue
    if (m.index > last) frag.appendChild(doc.createTextNode(text.slice(last, m.index)))
    frag.appendChild(typedMentionChipElement(doc, m[1], index, m[2]))
    last = m.index + m[0].length
    changed = true
  }
  if (!changed) return
  if (last < text.length) frag.appendChild(doc.createTextNode(text.slice(last)))
  node.parentNode?.replaceChild(frag, node)
}

/**
 * 把 HTML 中命中的实体名/类目词替换为可点芯片。
 * 作用于渲染后的 HTML（而非 markdown 源码），可安全跳过代码块与链接。
 * 先处理 @[类型/名称] 显式引用（composer 芯片序列），再处理裸实体名。
 */
export function linkifyHtml(html: string, index: EntityMatchIndex | undefined, options?: { explicitOnly?: boolean }): string {
  // index 可能因 Fast Refresh 过渡期的旧元素渲染而为 undefined，防御性放行原文
  if (!index || typeof DOMParser === "undefined") return html
  const doc = new DOMParser().parseFromString(html, "text/html")

  // 第一遍：@[类型/名称] 显式引用
  const walker1 = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
  const typedTargets: Text[] = []
  while (walker1.nextNode()) {
    const node = walker1.currentNode as Text
    if (!node.nodeValue || isSkippable(node)) continue
    TYPED_MENTION_RE.lastIndex = 0
    if (TYPED_MENTION_RE.test(node.nodeValue)) typedTargets.push(node)
  }
  for (const node of typedTargets) replaceTypedMentions(doc, node, index)

  // 第二遍：裸实体名/类目词（显式引用已整体芯片化，BUTTON 内不再处理）
  if (options?.explicitOnly || !index.regex) return doc.body.innerHTML
  const walker2 = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
  const targets: Text[] = []
  while (walker2.nextNode()) {
    const node = walker2.currentNode as Text
    if (!node.nodeValue || isSkippable(node)) continue
    index.regex.lastIndex = 0
    if (index.regex.test(node.nodeValue)) targets.push(node)
  }
  for (const node of targets) replaceMatches(doc, node, index)
  return doc.body.innerHTML
}

/** 点击委托：从命中的芯片元素还原实体引用 */
export function entityRefFromElement(el: HTMLElement): EntityRef | null {
  const kind = el.dataset.kind
  const id = el.dataset.id
  const name = el.dataset.name ?? ""
  const settingType = el.dataset.settingType as SettingType | undefined
  switch (kind) {
    case "character":
      return id ? { kind, id, name } : null
    case "world":
      return id ? { kind, id, name } : null
    case "setting":
      return id && settingType
        ? {
            kind,
            id,
            name,
            settingType,
            worldId: el.dataset.worldId ?? null,
            worldName: el.dataset.worldName,
            concept: el.dataset.concept,
          }
        : null
    case "setting-tab":
      return settingType ? { kind, settingType } : null
    case "attributes":
    case "trope":
    case "theme":
    case "outline":
      return { kind }
    case "item":
      return id ? { kind, id, name } : null
    case "scene":
      return id ? { kind, id, name } : null
    case "chapter":
      return id ? { kind, id, name, view: el.dataset.chapterView === "outline" ? "outline" : "content" } : null
    default:
      return null
  }
}
