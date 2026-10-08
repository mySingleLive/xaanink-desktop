"use client"

/**
 * 行内评论 · 预览态集成组件。
 *
 * 在 MarkdownPreview 的排版结构(.markdown-body + 720px 容器)上把整篇渲染改为
 * 按块渲染(splitMarkdownBlocks 的空行分块),以便:
 * 1) 展开的评论气泡插到 anchor.end 所在块之后;孤儿 thread(anchor 为 null)集中到末尾;
 * 2) 每条 thread 的 quote 在渲染 DOM 里高亮为 <mark class="text-comment-anchor">,
 *    mark 后附显隐小钮(.text-comment-anchor-toggle),点击经事件委托 onToggleThread;
 * 3) 拖选文本弹出「添加评论」浮钮(.text-comment-add-btn),点击后在选区末块之后
 *    内联 CommentComposer,提交走 onCreateComment;
 * 4) hover 段落时左上浮出段落行评论钮(data-testid="text-comment-block-add",同款样式),
 *    点击以整段为锚点打开同一 composer 通道。
 *
 * 选区与高亮都使用块内 Markdown→可见文本的有限映射。选区从真实 DOM Range
 * 取得偏移；高亮逐个文本节点包裹，保留 p/strong 等结构。跨段气泡在锚点末块之后。
 * 块 memo 隔离无关重渲染，幂等标记按源文与锚点签名更新。
 */
import { usePreviewReferences, type PreviewReferences } from "@/components/foreshadow/preview-references"
import { Fragment, memo, useEffect, useMemo, useRef, useState } from "react"
import type { JSX, ReactNode } from "react"
import { MessageSquarePlus } from "lucide-react"

import { blockIndexAt, splitMarkdownBlocks } from "@/lib/comment-anchor"
import { renderedTextMap, selectionSnapshot } from "@/lib/comment-selection"
import { renderMarkdown } from "@/lib/markdown"
import { cn } from "@/lib/utils"
import {useDesktopCommands} from "@/lib/desktop/use-command-target"

import { CommentComposer } from "./CommentComposer"
import type { CreateCommentInput, ResolvedThread } from "./types"

interface CommentablePreviewProps {
  source: string
  foreshadows?: PreviewReferences
  commentsEnabled?: boolean
  /** 正文类文本:按书页排版(段落首行缩进两字) */
  novel?: boolean
  className?: string
  threads: ResolvedThread[]
  /** 气泡总开关:false 时不渲染任何气泡(锚点高亮仍保留) */
  showAll: boolean
  readOnly?: boolean
  isExpanded: (threadId: string) => boolean
  onToggleThread: (threadId: string) => void
  onCreateComment: (input: CreateCommentInput) => Promise<void>
  renderBubble: (rt: ResolvedThread) => ReactNode
}

/** 遍历文本节点时跳过的祖先标签(与 entity-refs 的 isSkippable 同款思路;另跳过已生成的高亮,避免重复嵌套) */
const SKIP_TAGS = new Set(["PRE", "CODE", "A", "BUTTON", "SCRIPT", "STYLE"])

function isSkippable(node: Text): boolean {
  let el = node.parentElement
  while (el) {
    if (SKIP_TAGS.has(el.tagName) || el.classList.contains("text-comment-anchor")) return true
    el = el.parentElement
  }
  return false
}

/** 收集块内可见文本节点(TreeWalker;先收集再改 DOM,避免遍历中结构变动) */
function collectTextNodes(blockEl: Element): Text[] {
  const walker = document.createTreeWalker(blockEl, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    if (node.nodeValue && !isSkippable(node)) nodes.push(node)
  }
  return nodes
}

/** 清理容器内既有高亮:unwrap mark(内容保留)并移除显隐钮,normalize 回并被拆开的文本节点 */
function clearHighlights(container: HTMLElement) {
  container.querySelectorAll(".text-comment-anchor-toggle").forEach((el) => el.remove())
  container.querySelectorAll("mark.text-comment-anchor").forEach((mark) => {
    const parent = mark.parentNode
    if (!parent) return
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark)
    parent.removeChild(mark)
    parent.normalize()
  })
}

/** 显隐小钮内的 12px 对话图标(lucide message-square 的内联副本,手工 DOM 里用不了 React 组件) */
const TOGGLE_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>'

/**
 * 在单个块的渲染 DOM 上,按每条 thread 的源文偏移包 <mark> + 显隐钮。
 * 每条 thread 处理前重新收集文本节点(前一条的 wrap 已改动 DOM),保证偏移映射一致;
 * 找不到或包裹失败则跳过该条(气泡仍由 React 正常渲染)。
 */
function highlightBlock(blockEl: Element, rts: ResolvedThread[], source: string, blockStart: number) {
  for (const rt of rts) {
    const quote = rt.thread.quote
    if (!quote) continue
    const nodes = collectTextNodes(blockEl)
    let plain = ""
    const spans: { node: Text; from: number }[] = []
    for (const node of nodes) {
      spans.push({ node, from: plain.length })
      plain += node.nodeValue
    }
    if (!rt.anchor) continue
    const map = renderedTextMap(source, plain)
    if (!map) continue
    const idx = map.findIndex(offset => offset !== null && offset + blockStart >= rt.anchor!.start)
    const end = map.findLastIndex(offset => offset !== null && offset + blockStart >= rt.anchor!.start && offset + blockStart < rt.anchor!.end) + 1
    if (idx < 0 || end <= idx) continue

    // 逐个文本节点包裹，绝不把 p/strong 等结构搬进 mark（跨格式 Range 会制造嵌套段落）。
    let lastMark: HTMLElement | null = null
    for (const { node, from } of spans) {
      const left = Math.max(0, idx - from), right = Math.min(node.length, end - from)
      if (right <= left) continue
      const selected = left ? node.splitText(left) : node
      if (right - left < selected.length) selected.splitText(right - left)
      const mark = document.createElement("mark")
      mark.className = "text-comment-anchor"; mark.dataset.threadId = rt.thread.id
      selected.replaceWith(mark); mark.appendChild(selected); lastMark = mark
    }
    if (lastMark) {
      const toggle = document.createElement("button")
      toggle.type = "button"; toggle.className = "text-comment-anchor-toggle"
      toggle.dataset.threadId = rt.thread.id; toggle.title = "显示/隐藏评论"
      toggle.innerHTML = TOGGLE_ICON_SVG; lastMark.after(toggle)
    }
  }
}

/** 选区浮钮状态(相对内层 720px 容器定位) */
type ComposerState = ReturnType<typeof selectionSnapshot> & { blockIndex: number }
interface AddButtonState { top: number; left: number; snapshot: ComposerState }

/**
 * 单块渲染,memo 隔离:浮钮/composer 开合等父级状态变化引起的重渲染中,
 * 块的 props(html/index)浅比较不变 → React 跳过重渲染、不动块 DOM。
 * 否则 React 19 会把 innerHTML 原样重设(即使 __html 串相同)——注入的 mark
 * 与用户正在进行的选区一起被抹掉(预览框选高亮一闪即没的根因)。
 */
const PreviewBlock = memo(function PreviewBlock({ index, html }: { index: number; html: string }) {
  return <div data-block={index} dangerouslySetInnerHTML={{ __html: html }} />
})

export function CommentablePreview({
  source,
  foreshadows,
  commentsEnabled = true,
  novel,
  className,
  threads,
  showAll,
  readOnly,
  isExpanded,
  onToggleThread,
  onCreateComment,
  renderBubble,
}: CommentablePreviewProps): JSX.Element {
  const blocks = useMemo(() => splitMarkdownBlocks(source), [source])
  const blockHtml = useMemo(() => blocks.map((b) => renderMarkdown(b.text)), [blocks])

  /** 内层 720px 容器:块 DOM 查询、浮钮定位的基准 */
  const innerRef = useRef<HTMLDivElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const selectionRef = useRef<Range | null>(null)
  const [addBtn, setAddBtn] = useState<AddButtonState | null>(null)
  const [composer, setComposer] = useState<ComposerState | null>(null)
  /** 段落行评论钮(hover 段落时左上浮出):top 相对内层容器,blockIndex 命中的块 */
  const [blockBtn, setBlockBtn] = useState<{ top: number; blockIndex: number } | null>(null)
  const blockBtnHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (blockBtnHideTimer.current) clearTimeout(blockBtnHideTimer.current) }, [])

  /** 展开的 thread 按块分桶(气泡落 anchor.end 所在块);anchor 缺失或无块可落的集中到末尾 */
  const { bubblesByBlock, orphanBubbles } = useMemo(() => {
    const bubblesByBlock = new Map<number, ResolvedThread[]>()
    const orphanBubbles: ResolvedThread[] = []
    if (showAll) {
      for (const rt of threads) {
        if (!isExpanded(rt.thread.id)) continue
        const blockIndex = rt.anchor ? blockIndexAt(blocks, Math.max(rt.anchor.start, rt.anchor.end - 1)) : -1
        if (blockIndex < 0) {
          orphanBubbles.push(rt)
        } else {
          const list = bubblesByBlock.get(blockIndex)
          if (list) list.push(rt)
          else bubblesByBlock.set(blockIndex, [rt])
        }
      }
    }
    return { bubblesByBlock, orphanBubbles }
  }, [threads, blocks, showAll, isExpanded])

  /**
   * 锚点高亮(幂等)。块 DOM 已由 PreviewBlock 的 memo 挡住非内容变化的重渲染
   * (浮钮/composer/气泡开合不再重设 innerHTML,mark 与用户选区都存活);
   * 本 effect 不挂依赖、每次 commit 后检查一遍作为兜底:标注齐全则跳过(零成本),
   * 否则 clear + 重标——source 变化导致块真正重渲染后,高亮与小钮自动恢复。
   */
  const expectedMarkCount = threads.filter((rt) => rt.anchor && rt.thread.quote).length
  const highlighted = useRef("")
  useEffect(() => {
    const inner = innerRef.current
    if (!inner) return
    const signature = JSON.stringify([source, threads.map(rt => [rt.thread.id, rt.anchor])])
    const marked = new Set([...inner.querySelectorAll<HTMLElement>("mark.text-comment-anchor")].map(el => el.dataset.threadId))
    if (highlighted.current === signature && marked.size === expectedMarkCount) return
    highlighted.current = signature
    clearHighlights(inner)

    const byBlock = new Map<number, ResolvedThread[]>()
    for (const rt of threads) {
      if (!rt.anchor || !rt.thread.quote) continue
      for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
        const block = blocks[blockIndex]
        if (block.start >= rt.anchor.end || block.start + block.text.length <= rt.anchor.start) continue
        const list = byBlock.get(blockIndex)
        if (list) list.push(rt)
        else byBlock.set(blockIndex, [rt])
      }
    }
    byBlock.forEach((rts, blockIndex) => {
      const blockEl = inner.querySelector(`[data-block="${blockIndex}"]`)
      if (blockEl) highlightBlock(blockEl, rts, blocks[blockIndex].text, blocks[blockIndex].start)
    })
  })

  /** 节点所在的块下标;不在任何块内(气泡/composer 区域)返回 null */
  const blockIndexOfNode = (node: Node | null): number | null => {
    const el = node instanceof Element ? node : node?.parentElement
    const blockEl = el?.closest("[data-block]")
    if (!blockEl || !innerRef.current?.contains(blockEl)) return null
    const index = Number(blockEl.getAttribute("data-block"))
    return Number.isInteger(index) ? index : null
  }

  /** 拖选结束:选区非空且首尾都在正文块内 → 在选区末行下沿弹出「添加评论」浮钮 */
  const handleMouseUp = (e: React.MouseEvent) => {
    if (readOnly || !commentsEnabled) return
    const target = e.target as HTMLElement
    if (target.closest("[data-comment-composer]") || target.closest(".text-comment-add-btn")) return
    if (composer) return // composer 打开期间不再响应新选区
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      setAddBtn(null)
      return
    }
    const range = sel.getRangeAt(0)
    const startBlock = blockIndexOfNode(range.startContainer)
    const endBlock = blockIndexOfNode(range.endContainer)
    if (startBlock === null || endBlock === null) return
    const inner = innerRef.current
    if (!inner) return
    const sourceOffset = (index: number, node: Node, offset: number, end: boolean) => {
      const el = inner.querySelector(`[data-block="${index}"]`)!
      const before = document.createRange()
      before.selectNodeContents(el); before.setEnd(node, offset)
      const shown = before.toString().length
      const visible = el.textContent ?? ""
      const map = renderedTextMap(blocks[index].text, visible)
      if (!map) return null
      const value = end ? map[shown - 1] : map[shown]
      return value == null ? null : blocks[index].start + value + (end ? 1 : 0)
    }
    const start = sourceOffset(startBlock, range.startContainer, range.startOffset, false)
    const end = sourceOffset(endBlock, range.endContainer, range.endOffset, true)
    if (start === null || end === null || end <= start) { setAddBtn(null); return }
    const snapshot = { ...selectionSnapshot(source, start, end), blockIndex: endBlock }
    if (!snapshot.quote.trim()) return
    selectionRef.current = range.cloneRange()
    const rects = range.getClientRects()
    const rect = rects[rects.length - 1] ?? range.getBoundingClientRect()
    setAddBtn({ top: rect.top - inner.getBoundingClientRect().top + (rect.height - 26) / 2, left: 10, snapshot })
  }

  // 选区在滚动/布局变化后仍按真实 Range 重算，视口外隐藏，回来恢复。
  useEffect(() => {
    const scroll = scrollRef.current, inner = innerRef.current
    if (!scroll || !inner) return
    const update = () => {
      const range = selectionRef.current
      if (!range || !range.startContainer.isConnected) return
      const rects = range.getClientRects(), rect = rects[rects.length - 1] ?? range.getBoundingClientRect()
      const view = scroll.getBoundingClientRect()
      setAddBtn(previous => previous ? { ...previous,
        top: rect.bottom <= view.top || rect.top >= view.bottom ? -10000 : rect.top - inner.getBoundingClientRect().top + (rect.height - 26) / 2,
        left: 10 } : previous)
    }
    scroll.addEventListener("scroll", update)
    const observer = new ResizeObserver(update); observer.observe(scroll)
    return () => { scroll.removeEventListener("scroll", update); observer.disconnect() }
  }, [])

  /** composer 关闭时一并清段落行评论钮——composer/addBtn 期间 mousemove 提前 return，旧 blockBtn 会滞留、关闭后在原位置闪现 */
  const closeComposer = () => {
    setComposer(null)
    setBlockBtn(null)
  }

  /** 点击委托:显隐钮/mark → onToggleThread;点击别处且选区坍缩 → 收起浮钮与 composer */
  const handleClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    if (target.closest(".text-comment-add-btn")) return // 浮钮自身的 onClick 处理
    if (target.closest("[data-comment-composer]")) return // 点进 composer 不收起
    const hit = target.closest("[data-thread-id]")
    if (
      hit &&
      innerRef.current?.contains(hit) &&
      hit.matches("mark.text-comment-anchor, .text-comment-anchor-toggle")
    ) {
      const threadId = hit.getAttribute("data-thread-id")
      if (threadId) onToggleThread(threadId)
    }
    // 拖选产生的新选区(click 紧随 mouseup)不收;普通点击(选区坍缩)才收起
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed) {
      setAddBtn(null)
      closeComposer()
    }
  }

  /**
   * 段落行评论钮:hover 段落时在该段左上(px-11 内边距区)浮出,点击以整段为锚点评论。
   * 按钮自身不在任何 [data-block] 上——鼠标从段落移向按钮途中不能把它卸掉:
   * 目标命中按钮时保留;进入气泡/composer 区域或离开容器经 ~150ms 延迟隐藏
   * (防抖对齐行号加号的隐藏计时教训,避免掠过间隙时按钮闪没、点不到)。
   */
  const handleBlockBtnMouseMove = (e: React.MouseEvent) => {
    if (readOnly || !commentsEnabled || composer || addBtn) return
    if (blockBtnHideTimer.current) { clearTimeout(blockBtnHideTimer.current); blockBtnHideTimer.current = null }
    const target = e.target as HTMLElement
    if (target.closest('[data-testid="text-comment-block-add"]')) return // 悬在按钮自身:保留
    const blockEl = target.closest("[data-block]")
    if (blockEl && innerRef.current?.contains(blockEl)) {
      const blockIndex = Number(blockEl.getAttribute("data-block"))
      if (Number.isInteger(blockIndex) && blocks[blockIndex]) {
        const top = (blockEl as HTMLElement).offsetTop + 2
        setBlockBtn((prev) => (prev && prev.blockIndex === blockIndex ? prev : { top, blockIndex }))
      }
      return
    }
    blockBtnHideTimer.current = setTimeout(() => setBlockBtn(null), 150)
  }
  const hideBlockBtnSoon = () => {
    if (blockBtnHideTimer.current) clearTimeout(blockBtnHideTimer.current)
    blockBtnHideTimer.current = setTimeout(() => setBlockBtn(null), 150)
  }

  /** 段落钮点击:整段锚点 → 与选区 composer 同一渲染通道(composer.blockIndex === i 落在该段之后) */
  const openBlockComposer = () => {
    if (!blockBtn) return
    const block = blocks[blockBtn.blockIndex]
    setBlockBtn(null)
    if (!block) return
    const snapshot = { ...selectionSnapshot(source, block.start, block.start + block.text.length), blockIndex: blockBtn.blockIndex }
    if (!snapshot.quote.trim()) return
    setComposer(snapshot)
  }

  const openComposer = () => {
    if (!addBtn) return
    setComposer(addBtn.snapshot)
    setAddBtn(null)
    setBlockBtn(null)
  }
  useDesktopCommands({"md.comment":{enabled:()=>!!commentsEnabled&&!readOnly&&!!addBtn&&!composer,run:openComposer}},innerRef)

  /** composer 提交:成功才关闭;失败(onCreateComment 上抛)由 CommentComposer 捕获,草稿保留 */
  const submitComposer = async (content: string) => {
    if (!composer) return
    await onCreateComment({
      ...composer,
      content,
    })
    closeComposer()
  }

  const composerNode = composer && !readOnly && (
    <div className="my-2" data-comment-composer>
      <CommentComposer
        quote={composer.quote}
        anchor={composer}
        onSubmit={submitComposer}
        onCancel={closeComposer}
      />
    </div>
  )

  const foreshadowOverlay = usePreviewReferences(innerRef, source, foreshadows)

  return (
    <div
      className={cn("markdown-body no-scrollbar h-full overflow-y-auto", novel && "novel", className)}
      onMouseUp={handleMouseUp}
      onClick={handleClick}
      ref={scrollRef}
    >
      {foreshadowOverlay}
      {/* relative 为浮钮的定位基准;其余结构与 MarkdownPreview 一致 */}
      <div ref={innerRef} className="relative mx-auto max-w-[720px] px-11 pb-24 pt-8" onMouseMove={handleBlockBtnMouseMove} onMouseLeave={hideBlockBtnSoon}>
        {blockHtml.map((html, i) => (
          <Fragment key={i}>
            <PreviewBlock index={i} html={html} />
            {(bubblesByBlock.get(i) ?? []).map((rt) => (
              <div key={rt.thread.id} className="my-2">
                {renderBubble(rt)}
              </div>
            ))}
            {composer?.blockIndex === i && composerNode}
          </Fragment>
        ))}
        {/* 孤儿 thread(anchor 解析失败或无块可落)集中在最后一个块之后 */}
        {orphanBubbles.map((rt) => (
          <div key={rt.thread.id} className="my-2">
            {renderBubble(rt)}
          </div>
        ))}
        {composer && (composer.blockIndex < 0 || composer.blockIndex >= blockHtml.length) &&
          composerNode}
        {addBtn && !readOnly && (
          <button
            type="button"
            className="text-comment-add-btn"
            style={{ top: addBtn.top, left: addBtn.left, visibility: addBtn.top < 0 ? "hidden" : "visible" }}
            title="添加评论"
            onMouseDown={(e) => e.preventDefault() /* 防止按下时选区坍缩、浮钮在 click 前被收起 */}
            onClick={openComposer}
          >
            <MessageSquarePlus size={14} />
          </button>
        )}
        {/* 段落行评论钮:复用选区浮钮样式;互斥由 state 判(composer/addBtn 打开期间不显示) */}
        {blockBtn && !readOnly && commentsEnabled && !composer && !addBtn && (
          <button
            type="button"
            className="text-comment-add-btn"
            data-testid="text-comment-block-add"
            style={{ top: blockBtn.top, left: 10 }}
            title="评论本段"
            onMouseDown={(e) => e.preventDefault() /* 与选区浮钮同款:防止按下时选区坍缩 */}
            onClick={openBlockComposer}
          >
            <MessageSquarePlus size={14} />
          </button>
        )}
      </div>
    </div>
  )
}
