"use client"

/**
 * contenteditable composer 的底层操作：
 * - 草稿是纯文本（zustand store 唯一事实源），其中 @ 引用以类型化序列
 *   `@[组标签/展示名]`（如 `@[正文/第1章 · 雨夜来客]`）内联存在；
 * - 编辑器 DOM 把序列渲染为原子 chip（contenteditable=false，图标/头像 + 高亮名称），
 *   用户输入随时经 editorToText 序列化回纯文本；
 * - 纯文本与 DOM 的往返映射（光标偏移 ↔ DOM 位置）都在这里。
 */
import type { MentionKind } from "./use-mention-candidates"

/** 类型化引用序列：@[组标签/展示名]（名称内不允许出现 ] 或换行，构建候选时已清洗），可带半角括号技术负载 @[组标签/展示名](标识)——负载随草稿与消息发送给模型，但不在芯片上展示。正则与拆分/剥离函数的统一来源在 @/lib/mention-token（服务端可取会话标题）。 */
export { MENTION_TOKEN_RE, splitMentionToken, stripMentionPayloads } from "@/lib/mention-token"
import { MENTION_TOKEN_RE, splitMentionToken } from "@/lib/mention-token"

export interface ChipData {
  /** 完整序列，如 `@[正文/第1章 · 雨夜来客]`（序列化回草稿的文本） */
  insertText: string
  /** 芯片主文案（展示名，章节含「第N章 ·」前缀） */
  label: string
  /** 组标签：角色 / 物品 / 世界观 / 设定·类型 / 大纲 / 正文 */
  groupLabel: string
  kind: MentionKind
  avatarUrl?: string | null
  /** 设定类型为 MAP 时用地图图标 */
  settingType?: string
}

/** lucide 风格线性图标（stroke=currentColor，viewBox 24） */
const ICONS: Record<string, string> = {
  mapPin: '<path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  globe:
    '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  bookOpen:
    '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
  map: '<path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z"/><path d="M15 5.764v15"/><path d="M9 3.236v15"/>',
  listTree:
    '<path d="M8 5h13"/><path d="M13 12h8"/><path d="M13 19h8"/><path d="M3 10a2 2 0 0 0 2 2h3"/><path d="M3 5v12a2 2 0 0 0 2 2h3"/>',
  fileText:
    '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  package:
    '<path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
}

function iconSvg(body: string, cls: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="${cls}" aria-hidden="true">${body}</svg>`
}

function kindIcon(data: ChipData): string {
  if (data.kind === "scene") return ICONS.mapPin
  if (data.kind === "character") return ICONS.user
  if (data.kind === "world") return ICONS.globe
  if (data.kind === "setting") return data.settingType === "MAP" ? ICONS.map : ICONS.bookOpen
  if (data.kind === "outline") return ICONS.listTree
  if (data.kind === "item") return ICONS.package
  return ICONS.fileText
}

/** 构建一颗引用 chip（原子不可编辑，删除靠光标在旁按 Backspace/Delete） */
export function createChipElement(data: ChipData, doc: Document): HTMLElement {
  const chip = doc.createElement("span")
  chip.className = "composer-chip"
  chip.contentEditable = "false"
  chip.dataset.insert = data.insertText
  chip.dataset.kind = data.kind

  if (data.avatarUrl) {
    const img = doc.createElement("img")
    img.src = data.avatarUrl
    img.alt = ""
    chip.appendChild(img)
  } else {
    const icon = doc.createElement("span")
    icon.className = "composer-chip-icon"
    icon.innerHTML = iconSvg(kindIcon(data), "composer-chip-svg")
    chip.appendChild(icon)
  }

  const name = doc.createElement("span")
  name.className = "composer-chip-name"
  name.textContent = data.label
  chip.appendChild(name)

  const group = doc.createElement("span")
  group.className = "composer-chip-group"
  group.textContent = data.groupLabel
  chip.appendChild(group)

  return chip
}

/** 从序列反推 chip 展示数据（无候选可水合时的兜底：图标按组标签推断，无头像；技术负载不展示） */
export function fallbackChipData(insertText: string): ChipData {
  const { inner } = splitMentionToken(insertText)
  const slash = inner.indexOf("/")
  const groupLabel = slash >= 0 ? inner.slice(0, slash) : ""
  let label = slash >= 0 ? inner.slice(slash + 1) : inner
  // 等级引用序列 `@[设定·名/{settingId}·{等级名}]`：剥掉 id 前缀，芯片只展示等级名
  if (groupLabel.startsWith("设定·")) {
    const sep = label.indexOf("·")
    if (sep > 0) label = label.slice(sep + 1)
  }
  const kind: MentionKind =
    groupLabel === "角色"
      ? "character"
      : groupLabel === "场景"
        ? "scene"
        : groupLabel === "物品"
        ? "item"
        : groupLabel === "世界观"
          ? "world"
          : groupLabel === "大纲"
            ? "outline"
            : groupLabel === "正文"
              ? "content"
              : "setting"
  return { insertText, label, groupLabel, kind }
}

function isDesktopEmptyCaret(root: HTMLElement): boolean {
  // Chromium retains a sole BR as the empty editing host's caret placeholder.
  // Preserve that DOM node for undo; it is not a user draft newline.
  return !!(root.classList.contains("chat-composer-editable") && root.ownerDocument.defaultView?.desktop
    && root.childNodes.length === 1 && root.firstChild?.nodeName === "BR"
    && !(root.firstChild as HTMLElement).hasAttribute("data-composer-break"))
}

/** 编辑器 DOM → 纯文本草稿（chip 还原为 @[…] 序列；nbsp 归一为空格；块级/BR 换算行） */
export function editorToText(root: HTMLElement): string {
  if (isDesktopEmptyCaret(root)) return ""
  let out = ""
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += (node.nodeValue ?? "").replace(/\u00A0/g, " ")
      return
    }
    if (!(node instanceof HTMLElement)) return
    if (node.dataset.insert) {
      out += node.dataset.insert
      return
    }
    if (node.tagName === "BR") {
      out += "\n"
      return
    }
    if (node.tagName === "DIV" || node.tagName === "P") {
      // 只有 <br> 的空行块：换行由块本身贡献，跳过 br 防止重复
      const onlyBr =
        node.childNodes.length === 1 &&
        node.firstChild instanceof HTMLElement &&
        node.firstChild.tagName === "BR"
      if (out.length > 0 && !out.endsWith("\n")) out += "\n"
      if (onlyBr) return
    }
    node.childNodes.forEach(walk)
  }
  root.childNodes.forEach(walk)
  return out
}

/** 复制编辑器内选区时保留引用的稳定标识；编辑器外或空选区沿用浏览器行为。 */
export function selectedEditorText(root: HTMLElement): string | null {
  // Check the original editing host before cloning loses its composer class.
  // A selected empty-host caret BR is not a source newline for copy/cut.
  if (isDesktopEmptyCaret(root)) return null
  const selection = root.ownerDocument.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return null
  const range = selection.getRangeAt(0)
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null
  const fragment = root.ownerDocument.createElement("div")
  fragment.appendChild(range.cloneContents())
  return editorToText(fragment)
}

/** DocumentFragment 的纯文本长度（chip 按 data-insert 全长计） */
function fragmentTextLength(frag: DocumentFragment): number {
  let len = 0
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      len += (node.nodeValue ?? "").replace(/\u00A0/g, " ").length
      return
    }
    if (node instanceof HTMLElement && node.dataset.insert) {
      len += node.dataset.insert.length
      return
    }
    node.childNodes.forEach(walk)
  }
  frag.childNodes.forEach(walk)
  return len
}

/** 当前光标在纯文本草稿中的偏移（选择不在编辑器内时返回 null） */
export function getCaretTextOffset(root: HTMLElement): number | null {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return null
  const range = sel.getRangeAt(0)
  if (!root.contains(range.startContainer)) return null
  const pre = range.cloneRange()
  pre.selectNodeContents(root)
  pre.setEnd(range.startContainer, range.startOffset)
  return fragmentTextLength(pre.cloneContents())
}

/** 拖放释放点（视口坐标）在纯文本草稿中的偏移；落在编辑器外或不支持坐标映射时返回 null */
export function getDropTextOffset(root: HTMLElement, x: number, y: number): number | null {
  const doc = root.ownerDocument
  let node: Node | null = null
  let offset = 0
  if (typeof doc.caretRangeFromPoint === "function") {
    const range = doc.caretRangeFromPoint(x, y)
    if (range) {
      node = range.startContainer
      offset = range.startOffset
    }
  } else if (typeof doc.caretPositionFromPoint === "function") {
    const pos = doc.caretPositionFromPoint(x, y)
    if (pos) {
      node = pos.offsetNode
      offset = pos.offset
    }
  }
  if (!node || !root.contains(node)) return null
  const pre = doc.createRange()
  pre.selectNodeContents(root)
  pre.setEnd(node, offset)
  return fragmentTextLength(pre.cloneContents())
}

interface DomPoint {
  node: Node
  offset: number
}

/** 纯文本偏移 → DOM 位置；落在 chip 内部时吸附到 chip 之后 */
export function locateTextPosition(root: HTMLElement, target: number): DomPoint {
  let pos = 0
  let result: DomPoint | null = null
  const walk = (node: Node) => {
    if (result) return
    if (node.nodeType === Node.TEXT_NODE) {
      const len = (node.nodeValue ?? "").length
      if (pos + len >= target) {
        result = { node, offset: target - pos }
        return
      }
      pos += len
      return
    }
    if (node instanceof HTMLElement && node.dataset.insert) {
      const len = node.dataset.insert.length
      if (pos + len >= target) {
        const parent = node.parentNode ?? root
        result = { node: parent, offset: [...parent.childNodes].indexOf(node as ChildNode) + 1 }
        return
      }
      pos += len
      return
    }
    node.childNodes.forEach(walk)
  }
  walk(root)
  // 文档末尾兜底
  return result ?? { node: root, offset: root.childNodes.length }
}

/** 把 [start, end) 这段纯文本（即 @query 片段）替换为引用 chip + 尾随空格，光标落到空格后 */
export function insertMentionChip(root: HTMLElement, data: ChipData, start: number, end: number) {
  const s = locateTextPosition(root, start)
  const e = locateTextPosition(root, end)
  const range = document.createRange()
  range.setStart(s.node, s.offset)
  range.setEnd(e.node, e.offset)
  range.deleteContents()
  const chip = createChipElement(data, document)
  range.insertNode(chip)
  // 尾随空格用 nbsp（行尾普通空格在 contenteditable 里会被折叠，光标会贴回 chip）
  const space = document.createTextNode("\u00A0")
  chip.after(space)
  range.setStartAfter(space)
  range.collapse(true)
  const sel = window.getSelection()
  sel?.removeAllRanges()
  sel?.addRange(range)
}

/** 在光标处插入纯文本（@ / / 等触发符），并折叠光标到插入文本之后 */
export function insertTextAtCaret(root: HTMLElement, text: string) {
  root.focus()
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) {
    root.appendChild(document.createTextNode(text))
    return
  }
  const range = sel.getRangeAt(0)
  if (!root.contains(range.startContainer)) {
    root.appendChild(document.createTextNode(text))
    return
  }
  range.deleteContents()
  const node = document.createTextNode(text)
  range.insertNode(node)
  range.setStartAfter(node)
  range.collapse(true)
  sel.removeAllRanges()
  sel.addRange(range)
}

/** 粘贴草稿序列时水合引用，保留已有 DOM 与释放后的光标。 */
export function insertDraftAtCaret(
  root: HTMLElement,
  text: string,
  hydrate: (insertText: string) => ChipData | undefined,
  options: { nativeUndo?: boolean } = {},
) {
  if (!text) return
  const container = root.ownerDocument.createElement("div")
  renderDraftIntoEditor(container, text, hydrate)
  const fragment = root.ownerDocument.createDocumentFragment()
  while (container.firstChild) fragment.appendChild(container.firstChild)
  const last = fragment.lastChild
  if (!last) return
  const selection = root.ownerDocument.getSelection()
  const selected = selection?.rangeCount === 1 ? selection.getRangeAt(0) : null
  if (options.nativeUndo) {
    if (!root.isConnected || !root.isContentEditable || root.ownerDocument.activeElement !== root || root.ownerDocument.hasFocus() === false
      || !selected || !root.contains(selected.startContainer) || !root.contains(selected.endContainer)) throw new Error("消息输入框已变化，未粘贴内容")
    // The HTML comes exclusively from our text nodes and typed chip builder;
    // clipboard HTML never reaches this path. Chromium owns undo/redo/input.
    const safe = root.ownerDocument.createElement("div")
    safe.appendChild(fragment)
    // Distinguish intentional source newlines from Chromium's empty-host BR.
    safe.querySelectorAll("br").forEach(br => br.setAttribute("data-composer-break", "true"))
    if (!root.ownerDocument.execCommand("insertHTML", false, safe.innerHTML)) throw new Error("消息输入框无法粘贴，请重试")
    return
  }
  const range = selected && root.contains(selected.startContainer) && root.contains(selected.endContainer)
    ? selected.cloneRange()
    : root.ownerDocument.createRange()
  if (!selected || !root.contains(selected.startContainer) || !root.contains(selected.endContainer)) {
    range.selectNodeContents(root)
    range.collapse(false)
  }
  root.focus()
  range.deleteContents()
  range.insertNode(fragment)
  range.setStartAfter(last)
  range.collapse(true)
  selection?.removeAllRanges()
  selection?.addRange(range)
}

/** Desktop cut uses the same browser history as native typing and paste. */
export function deleteDraftSelection(root: HTMLElement) {
  const selection = root.ownerDocument.getSelection()
  if (!root.isConnected || !root.isContentEditable || root.ownerDocument.activeElement !== root || root.ownerDocument.hasFocus() === false
    || selection?.rangeCount !== 1 || selection.isCollapsed || !root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) throw new Error("消息选区已变化，未剪切内容")
  if (!root.ownerDocument.execCommand("delete", false)) throw new Error("消息输入框无法剪切，请重试")
}

/** 纯文本草稿 → 编辑器 DOM（全量重建；hydrate 用候选数据补全头像/图标） */
export function renderDraftIntoEditor(
  root: HTMLElement,
  draft: string,
  hydrate: (insertText: string) => ChipData | undefined
) {
  root.innerHTML = ""
  const pushText = (t: string) => {
    if (!t) return
    const lines = t.split("\n")
    lines.forEach((line, i) => {
      if (i > 0) {
        const br = root.ownerDocument.createElement("br")
        if (root.classList.contains("chat-composer-editable") && root.ownerDocument.defaultView?.desktop) br.setAttribute("data-composer-break", "true")
        root.appendChild(br)
      }
      if (line) root.appendChild(document.createTextNode(line))
    })
  }
  MENTION_TOKEN_RE.lastIndex = 0
  let last = 0
  let m: RegExpExecArray | null
  while ((m = MENTION_TOKEN_RE.exec(draft))) {
    pushText(draft.slice(last, m.index))
    root.appendChild(createChipElement(hydrate(m[0]) ?? fallbackChipData(m[0]), document))
    last = m.index + m[0].length
  }
  pushText(draft.slice(last))
}
