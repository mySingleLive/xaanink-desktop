"use client"

/**
 * 行内评论的 Monaco 集成层(编辑模式):
 * - 锚点高亮:inline decoration(.text-comment-anchor)
 * - 字形边距图标:锚点末行的 glyph decoration,点击切换该条气泡显隐
 * - 气泡:展开线程各占一个整行宽 ViewZone(domNode 经 createPortal 渲染 CommentBubble)
 * - 添加评论:非空选区末端的浮钮(.text-comment-add-btn),点击在选区末行开 composer ViewZone
 *
 * 全部副作用集中在 useEffect;锚点解析由调用方负责(threads 传入已解析的 anchor),
 * threads/showAll/展开态变化时重建 decorations 与 zones,卸载彻底 dispose。
 *
 * 集成约束:
 * - 本模块静态引入 monaco-setup(模块级副作用:注册主题/worker、访问 self),
 *   只能出现在 next/dynamic(ssr:false) 边界之内,不得被会 SSR 的模块直接引用。
 * - 返回的 overlay 必须渲染在包裹编辑器的 position:relative 容器内
 *   (MonacoMarkdownEditor 根 div 即是),浮钮坐标以编辑器 DOM 节点左上角为原点。
 */
import {
  createElement,
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import type { ReactNode } from "react"
import { createPortal } from "react-dom"
import type * as Monaco from "monaco-editor"
import { MessageSquarePlus } from "lucide-react"

import { selectionGutterPosition, selectionSnapshot } from "@/lib/comment-selection"
import {editorCommentCommand} from "@/lib/desktop/editor-comment-command"
import {registerDesktopCommandTarget} from "@/lib/desktop/command-runtime"

import { monaco } from "../editor/monaco-setup"
import { CommentComposer } from "./CommentComposer"
import type { CreateCommentInput, ResolvedThread } from "./types"

export interface MonacoCommentsArgs {
  editor: Monaco.editor.IStandaloneCodeEditor | null
  value: string
  /** commentsTarget 存在才 true;false 时本 hook 完全静默 */
  enabled: boolean
  /** 工具栏总开关:false 时不渲染任何 ViewZone 气泡(高亮/图标保留) */
  showAll: boolean
  readOnly?: boolean
  /** 锚点已解析的线程(含孤儿) */
  threads: ResolvedThread[]
  isExpanded: (threadId: string) => boolean
  onToggleThread: (threadId: string) => void
  onCreateComment: (input: CreateCommentInput) => Promise<void>
  /** 渲染某条线程的气泡(CommentBubble,动作已由调用方绑定) */
  renderBubble: (rt: ResolvedThread) => ReactNode
}

/** 选区浮钮状态(坐标相对编辑器容器) */
interface AddButtonState {
  top: number
  left: number
  /** 选区末行行号(composer zone 挂载用) */
  line: number
  quote: string
  selection: Monaco.Selection
}

/** 发表中状态:点击浮钮瞬间对 quote/selection 的快照 */
type ComposerState = ReturnType<typeof selectionSnapshot> & { line: number }

/** 已挂载的 ViewZone;key 复用以保住气泡内部状态(如回复草稿) */
interface ActiveZone {
  key: string
  zoneId: string
  /** zone 容器(Monaco 会把 heightInPx 写成它的内联 height,自身高度不可信) */
  node: HTMLDivElement
  /** 内容容器:portal 渲染目标,ResizeObserver 量它的真实内容高度 */
  inner: HTMLDivElement
  zone: Monaco.editor.IViewZone
  observer: ResizeObserver
  editor: Monaco.editor.IStandaloneCodeEditor
}

/** 待渲染 portal 的目标(zone 内容容器 + 归属) */
type ZonePortalTarget = { key: string; node: HTMLDivElement } & (
  | { kind: "thread"; threadId: string }
  | { kind: "composer" }
)

function disposeZone(z: ActiveZone): void {
  z.observer.disconnect()
  z.editor.changeViewZones((accessor) => accessor.removeZone(z.zoneId))
}

const STICKINESS = monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges

/** composer portal 挂载后聚焦其中的输入框(挂载紧后的同步窗口内 Monaco 会把焦点拉回编辑区,延迟一拍再聚焦) */
function FocusTextareaOnMount({ node, children }: { node: HTMLDivElement; children?: ReactNode }) {
  useEffect(() => {
    const t = window.setTimeout(() => node.querySelector("textarea")?.focus(), 50)
    return () => window.clearTimeout(t)
  }, [node])
  return createElement(Fragment, null, children)
}

export function useMonacoComments(args: MonacoCommentsArgs): { overlay: ReactNode } {
  const {
    editor,
    enabled,
    showAll,
    readOnly,
    threads,
    isExpanded,
    onToggleThread,
    onCreateComment,
    renderBubble,
  } = args

  const [addBtn, setAddBtn] = useState<AddButtonState | null>(null)
  const [composer, setComposer] = useState<ComposerState | null>(null)
  useEffect(()=>{
    if(!editor)return
    return registerDesktopCommandTarget(editorCommentCommand(editor,()=>enabled&&!readOnly&&!composer,snapshot=>{setComposer(snapshot);setAddBtn(null)}))
  },[editor,enabled,readOnly,composer])
  const zonesRef = useRef(new Map<string, ActiveZone>())

  // Monaco 默认把整个 ViewZone 层设为 aria-hidden；自定义评论包含真实表单，必须向读屏暴露。
  useEffect(() => {
    if (!editor || !enabled) return
    const host = editor.getDomNode()?.querySelector(".view-zones")
    if (!host) return
    const previous = host.getAttribute("aria-hidden")
    host.removeAttribute("aria-hidden")
    return () => { if (previous === null) host.removeAttribute("aria-hidden"); else host.setAttribute("aria-hidden", previous) }
  }, [editor, enabled])

  /* 行号槽悬停「添加评论」钮与按下拖动多选(见下方专用 effect) */
  const [gutterBtn, setGutterBtn] = useState<{ line: number; top: number; left: number } | null>(null)
  const [drag, setDrag] = useState<{ startLine: number; endLine: number } | null>(null)
  /** 拖动中的最新值,Monaco/DOM 事件回调经 ref 读(避免回调闭包过期);只在事件回调里写 */
  const dragRef = useRef<{ startLine: number; endLine: number } | null>(null)
  /** 悬停意图:移出槽位 250ms 后才隐藏(留出发移到按钮上的时间) */
  const gutterHideTimer = useRef<number | null>(null)
  /** 行号槽按钮 DOM:隐藏计时触发时以 :hover 为准兜底(见 scheduleGutterHide) */
  const gutterBtnDomRef = useRef<HTMLButtonElement | null>(null)
  /** 开始拖动的实现挂在 ref 上(effect 里赋值),按钮事件里经 ref 调用——render 期不读 ref */
  const startGutterDragRef = useRef<(line: number) => void>(() => {})
  const clearGutterHide = useCallback(() => {
    if (gutterHideTimer.current !== null) {
      window.clearTimeout(gutterHideTimer.current)
      gutterHideTimer.current = null
    }
  }, [])
  const scheduleGutterHide = useCallback(() => {
    clearGutterHide()
    gutterHideTimer.current = window.setTimeout(() => {
      /*
       * Monaco mouseHandler 在编辑器收到过 mousemove 后,会往 document 上挂
       * 全局 mousemove 监视(mouseLeaveMonitor),目标不在 viewDomNode 内就补发
       * onMouseLeave——本按钮渲染在编辑器 DOM 之外的 overlay 里,悬停在按钮上
       * 每次微小移动都会重排本计时,停下 250ms 后按钮被误藏(看得见点不到)。
       * 以浏览器 :hover 实时状态兜底:仍在按钮上就不藏,
       * 真正移出时由按钮的 onMouseLeave 再排一次计时收掉。
       */
      if (gutterBtnDomRef.current?.matches(":hover")) return
      setGutterBtn(null)
    }, 250)
  }, [clearGutterHide])

  /*
   * zone portal 目标的外部 store:zone domNode 在 effect 里创建,
   * 经 useSyncExternalStore 通知渲染(等价于面板层「store 订阅消费」模式),
   * 避免在 effect 体内同步 setState(eslint react-hooks/set-state-in-effect)。
   */
  const [zoneStore] = useState(() => {
    let snapshot: ZonePortalTarget[] = []
    const listeners = new Set<() => void>()
    return {
      getSnapshot: () => snapshot,
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
      publish: (next: ZonePortalTarget[]) => {
        snapshot = next
        for (const listener of listeners) listener()
      },
    }
  })
  const zoneTargets = useSyncExternalStore(zoneStore.subscribe, zoneStore.getSnapshot, zoneStore.getSnapshot)

  /* 最新回调 ref:编辑器事件回调里使用,避免 effect 依赖函数量 prop 而频繁重挂 */
  const onToggleThreadRef = useRef(onToggleThread)
  useEffect(() => {
    onToggleThreadRef.current = onToggleThread
  })

  /* 展开集合:渲染期派生,作为装饰/zone 两个 effect 的重建触发 */
  const expandedIds = useMemo(
    () => new Set(threads.filter((rt) => isExpanded(rt.thread.id)).map((rt) => rt.thread.id)),
    [threads, isExpanded],
  )

  /* 发布 portal 目标;内容不变则不通知,避免无谓重渲染 */
  const publishTargets = useCallback(
    (targets: ZonePortalTarget[]) => {
      const prev = zoneStore.getSnapshot()
      const same =
        prev.length === targets.length &&
        prev.every((p, i) => {
          const n = targets[i]
          if (p.key !== n.key || p.node !== n.node || p.kind !== n.kind) return false
          return p.kind === "thread" && n.kind === "thread" ? p.threadId === n.threadId : true
        })
      if (!same) zoneStore.publish(targets)
    },
    [zoneStore],
  )

  /* 锚点高亮 + 字形边距图标;value 变化经调用方重解析 threads(新身份)传导到这里 */
  useEffect(() => {
    if (!editor || !enabled) return
    const model = editor.getModel()
    if (!model) return

    /* 字形边距行号 → threadId(同末行的多条线程,后写者胜出) */
    const lineToThread = new Map<number, string>()
    const decorations: Monaco.editor.IModelDeltaDecoration[] = []
    for (const rt of threads) {
      const anchor = rt.anchor
      if (!anchor || anchor.end <= anchor.start) continue
      const start = model.getPositionAt(anchor.start)
      const end = model.getPositionAt(anchor.end)
      decorations.push({
        range: monaco.Range.fromPositions(start, end),
        options: {
          inlineClassName: "text-comment-anchor",
          stickiness: STICKINESS,
        },
      })
      decorations.push({
        range: new monaco.Range(end.lineNumber, 1, end.lineNumber, 1),
        options: {
          glyphMarginClassName:
            "text-comment-glyph" + (expandedIds.has(rt.thread.id) ? "" : " text-comment-glyph-collapsed"),
          glyphMarginHoverMessage: { value: "显示/隐藏评论" },
          stickiness: STICKINESS,
        },
      })
      lineToThread.set(end.lineNumber, rt.thread.id)
    }

    const collection = editor.createDecorationsCollection(decorations)
    const mouseListener = editor.onMouseDown((e) => {
      const target = e.target
      if (target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN && target.position) {
        const threadId = lineToThread.get(target.position.lineNumber)
        if (threadId) onToggleThreadRef.current(threadId)
      }
    })
    return () => {
      mouseListener.dispose()
      collection.clear()
    }
  }, [editor, enabled, threads, expandedIds])

  /*
   * 气泡 ViewZone:showAll 且展开的线程各一个(孤儿挂文档末行),外加发表中的 composer。
   * key = 归属 + 行号:行号未变的 zone 直接复用(domNode 不变 → portal 不重挂 →
   * 气泡内部状态不丢),其余全量增删(评论数量小,不做更细的增量)。
   */
  useEffect(() => {
    const model = editor && enabled ? editor.getModel() : null
    if (!editor || !enabled || !model) {
      for (const z of zonesRef.current.values()) disposeZone(z)
      zonesRef.current.clear()
      publishTargets([])
      return
    }

    interface ZoneSpec {
      key: string
      afterLine: number
      ordinal: number
      desc: { kind: "thread"; threadId: string } | { kind: "composer" }
    }
    const specs: ZoneSpec[] = []
    if (showAll) {
      for (const rt of threads) {
        if (!expandedIds.has(rt.thread.id)) continue
        const line = rt.anchor ? model.getPositionAt(rt.anchor.end).lineNumber : model.getLineCount()
        specs.push({
          key: `t:${rt.thread.id}@${line}`,
          afterLine: line,
          ordinal: 10000,
          desc: { kind: "thread", threadId: rt.thread.id },
        })
      }
    }
    if (composer) {
      const line = Math.min(composer.line, model.getLineCount())
      specs.push({ key: `composer@${line}`, afterLine: line, ordinal: 10001, desc: { kind: "composer" } })
    }
    /* 按行排序,避免多条 zone 互相错位;同行时 composer 排在线程气泡之后 */
    specs.sort((a, b) => a.afterLine - b.afterLine || a.ordinal - b.ordinal)

    /* 丢弃旧 editor 残留与不再需要的 zone */
    for (const [key, z] of zonesRef.current) {
      if (z.editor !== editor || !specs.some((s) => s.key === key)) {
        disposeZone(z)
        zonesRef.current.delete(key)
      }
    }

    /* 新增缺失的 zone:先给占位高度,ResizeObserver 量到真实高度后更新并 layoutZone */
    const toAdd = specs.filter((s) => !zonesRef.current.has(s.key))
    if (toAdd.length > 0) {
      editor.changeViewZones((accessor) => {
        for (const spec of toAdd) {
          const node = document.createElement("div")
          node.className = "text-comment-zone"
          /* mousedown 不冒泡给 Monaco:气泡内可正常聚焦输入框,且不移动编辑器光标 */
          node.addEventListener("mousedown", (e) => e.stopPropagation())
          /*
           * Monaco 会把 heightInPx 同步成 node 的内联 height,node 自身高度恒等于
           * 占位值,永远量不到内容——所以套一层 inner 作为 portal 容器与量测对象。
           */
          const inner = document.createElement("div")
          inner.className = "text-comment-zone-inner"
          inner.setAttribute("role", "region")
          inner.setAttribute("aria-label", spec.desc.kind === "composer" ? "添加行内评论" : "行内评论")
          node.appendChild(inner)
          const zone: Monaco.editor.IViewZone = {
            afterLineNumber: spec.afterLine,
            ordinal: spec.ordinal,
            heightInPx: 8,
            domNode: node,
          }
          const zoneId = accessor.addZone(zone)
          const observer = new ResizeObserver(() => {
            const height = Math.max(1, inner.offsetHeight)
            if (height !== zone.heightInPx) {
              zone.heightInPx = height
              editor.changeViewZones((a) => a.layoutZone(zoneId))
            }
          })
          observer.observe(inner)
          zonesRef.current.set(spec.key, { key: spec.key, zoneId, node, inner, zone, observer, editor })
        }
      })
    }

    const targets: ZonePortalTarget[] = []
    for (const s of specs) {
      const active = zonesRef.current.get(s.key)
      if (!active) continue
      targets.push(
        s.desc.kind === "thread"
          ? { kind: "thread", threadId: s.desc.threadId, key: s.key, node: active.inner }
          : { kind: "composer", key: s.key, node: active.inner },
      )
    }
    publishTargets(targets)
  }, [editor, enabled, showAll, threads, expandedIds, composer, publishTargets])

  /* 卸载:彻底 dispose 所有 zone */
  useEffect(() => {
    const zones = zonesRef.current
    return () => {
      for (const z of zones.values()) disposeZone(z)
      zones.clear()
    }
  }, [])

  /* 选区浮钮:非空选区末端下方;坍缩/失焦/滚动后隐藏 */
  useEffect(() => {
    if (!editor || !enabled) return

    const updateFromSelection = (selection: Monaco.Selection) => {
      if (readOnly || selection.isEmpty()) {
        setAddBtn(null)
        return
      }
      const model = editor.getModel()
      if (!model) {
        setAddBtn(null)
        return
      }
      const endPos = selection.getEndPosition()
      const coords = editor.getScrolledVisiblePosition(endPos)
      if (!coords) {
        setAddBtn(null)
        return
      }
      /*
       * getScrolledVisiblePosition 的 left 已含字形边距/行号/装饰宽度
       * (即 layoutInfo.contentLeft),top/left 均已扣除滚动偏移,
       * 坐标原点是编辑器 DOM 节点左上角;这里只需按可视范围钳制。
       */
      const layout = editor.getLayoutInfo()
      const position = selectionGutterPosition(coords, layout)
      if (!position) {
        setAddBtn(null)
        return
      }
      setAddBtn({ ...position, line: endPos.lineNumber, quote: model.getValueInRange(selection), selection })
    }

    const disposables = [
      editor.onDidChangeCursorSelection((e) => updateFromSelection(e.selection)),
      editor.onDidBlurEditorWidget(() => setAddBtn(null)),
      editor.onDidScrollChange(() => { const selection = editor.getSelection(); if (selection) updateFromSelection(selection) }),
      editor.onDidLayoutChange(() => { const selection = editor.getSelection(); if (selection) updateFromSelection(selection) }),
    ]
    return () => {
      for (const d of disposables) d.dispose()
    }
  }, [editor, enabled, readOnly])

  /*
   * 行号槽悬停「添加评论」钮 + 按下拖动多选:
   * 悬停在字形边距/行号/装饰槽上时,在该行槽位显示小加号钮;
   * 按下不松拖动时经 decoration 实时预览选中行区,松开即对该行区开 composer
   * (单击 = 仅该行)。quote 取整行文本,空行区不处理。
   */
  useEffect(() => {
    if (!editor || !enabled || readOnly) return

    /* 行号槽按钮按下:开始拖动(或单击);松开时对最终行区开 composer */
    startGutterDragRef.current = (line: number) => {
      clearGutterHide()
      const initial = { startLine: line, endLine: line }
      dragRef.current = initial
      setDrag(initial)
      const onUp = () => {
        document.removeEventListener("mouseup", onUp)
        const d = dragRef.current
        dragRef.current = null
        setDrag(null)
        setGutterBtn(null)
        const model = editor.getModel()
        if (!model || !d) return
        const min = Math.min(d.startLine, d.endLine)
        const max = Math.min(Math.max(d.startLine, d.endLine), model.getLineCount())
        const selection = new monaco.Selection(min, 1, max, model.getLineMaxColumn(max))
        const quote = model.getValueInRange(selection)
        if (!quote.trim()) return
        setComposer({ ...selectionSnapshot(model.getValue(), model.getOffsetAt(selection.getStartPosition()), model.getOffsetAt(selection.getEndPosition())), line: max })
      }
      document.addEventListener("mouseup", onUp)
    }

    const onMove = editor.onMouseMove((e) => {
      /* 拖动中:跟随鼠标行号更新选区预览 */
      if (dragRef.current) {
        if (e.target.position) {
          const line = e.target.position.lineNumber
          setDrag((d) => {
            if (!d || d.endLine === line) return d
            const next = { ...d, endLine: line }
            dragRef.current = next
            return next
          })
        }
        return
      }
      const t = e.target
      const inGutter =
        t.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN ||
        t.type === monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS ||
        t.type === monaco.editor.MouseTargetType.GUTTER_LINE_DECORATIONS
      if (inGutter && t.position) {
        clearGutterHide()
        const coords = editor.getScrolledVisiblePosition({ lineNumber: t.position.lineNumber, column: 1 })
        if (!coords || coords.top < 0) {
          scheduleGutterHide()
          return
        }
        const layout = editor.getLayoutInfo()
        /* 放在行号槽左缘,不遮字形边距里的评论显隐图标 */
        setGutterBtn({
          line: t.position.lineNumber,
          top: coords.top + (coords.height - 16) / 2,
          left: layout.glyphMarginLeft + layout.glyphMarginWidth + 2,
        })
      } else {
        scheduleGutterHide()
      }
    })
    const onLeave = editor.onMouseLeave(() => scheduleGutterHide())
    const onScroll = editor.onDidScrollChange(() => setGutterBtn(null))
    return () => {
      onMove.dispose()
      onLeave.dispose()
      onScroll.dispose()
      clearGutterHide()
      startGutterDragRef.current = () => {}
    }
  }, [editor, enabled, readOnly]) // eslint-disable-line react-hooks/exhaustive-deps -- dragRef/startGutterDragRef/计时器为稳定引用

  /* 拖动多选的行区预览高亮 */
  useEffect(() => {
    if (!editor || !drag) return
    const model = editor.getModel()
    if (!model) return
    const min = Math.min(drag.startLine, drag.endLine)
    const max = Math.min(Math.max(drag.startLine, drag.endLine), model.getLineCount())
    const deco = editor.createDecorationsCollection([
      {
        range: new monaco.Range(min, 1, max, model.getLineMaxColumn(max)),
        options: { isWholeLine: true, className: "text-comment-drag-range" },
      },
    ])
    return () => deco.clear()
  }, [editor, drag])

  if (!enabled) return { overlay: null }

  const rtById = new Map(threads.map((rt) => [rt.thread.id, rt]))
  const zonePortals = zoneTargets.map((target) => {
    if (target.kind === "composer") {
      if (!composer) return null
      const snapshot = composer
      return createPortal(
        createElement(
          FocusTextareaOnMount,
          { node: target.node },
          createElement(CommentComposer, {
            quote: snapshot.quote,
            anchor: snapshot,
            onSubmit: async (content: string) => {
              /* 失败时保持 composer(草稿由 CommentComposer 保留);成功才关闭 */
              await onCreateComment({
                ...snapshot,
                content,
              })
              setComposer(null)
            },
            onCancel: () => setComposer(null),
          }),
        ),
        target.node,
        target.key,
      )
    }
    const rt = rtById.get(target.threadId)
    return rt ? createPortal(renderBubble(rt), target.node, target.key) : null
  })

  const addButton =
    addBtn && !readOnly && !composer
      ? createElement(
          "button",
          {
            key: "add-comment",
            type: "button",
            className: "text-comment-add-btn",
            style: { top: addBtn.top, left: addBtn.left },
            title: "添加评论",
            /* mousedown 阻止默认:不打断编辑器焦点与选区,click 仍能触发 */
            onMouseDown: (e) => e.preventDefault(),
            onClick: () => {
              /* 点击瞬间快照 quote/selection(随后选区可能变化) */
              const model = editor?.getModel()
              if (!model) return
              setComposer({ ...selectionSnapshot(model.getValue(), model.getOffsetAt(addBtn.selection.getStartPosition()), model.getOffsetAt(addBtn.selection.getEndPosition())), line: addBtn.line })
              setAddBtn(null)
            },
          },
          createElement(MessageSquarePlus, { className: "size-3.5" }),
        )
      : null

  const gutterButton =
    gutterBtn && !readOnly && !composer ? (
      <button
        key="gutter-add-comment"
        ref={gutterBtnDomRef}
        type="button"
        className="text-comment-gutter-btn"
        style={{ top: gutterBtn.top, left: gutterBtn.left }}
        title={`评论第 ${gutterBtn.line} 行(按下拖动可选多行)`}
        /* 悬停意图:移上按钮取消隐藏,移出后延迟隐藏 */
        onMouseEnter={() => clearGutterHide()}
        onMouseLeave={() => scheduleGutterHide()}
        /* 按下即进入拖动选行;preventDefault 保住编辑器焦点与既有选区 */
        onMouseDown={(e) => {
          if (e.button !== 0) return
          e.preventDefault()
          startGutterDragRef.current(gutterBtn.line)
        }}
      >
        <MessageSquarePlus className="size-3" />
      </button>
    ) : null

  return { overlay: createElement(Fragment, null, ...zonePortals, addButton, gutterButton) }
}
