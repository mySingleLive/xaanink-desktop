"use client"

/**
 * Monaco（VS Code 内核）Markdown 编辑层。
 * 仅经 MarkdownEditor 以 next/dynamic(ssr:false) 加载，不得被服务端引用。
 */
import Editor, { type OnMount } from "@monaco-editor/react"
import { useEffect, useState } from "react"

import {
  useMonacoComments,
  type MonacoCommentsArgs,
} from "@/components/comments/use-monaco-comments"
import type { ResolvedThread } from "@/components/comments/types"

import { MONACO_FONT_OPTS, monaco } from "./monaco-setup"
import { useDesktopStore } from "@/stores/desktop"
import { desktopFontFamily } from "@/lib/desktop/appearance"
import { bindMonacoCommandTarget } from "@/lib/desktop/monaco-commands"

/** comments 缺省时传给 useMonacoComments 的静默占位（模块级常量,保住引用稳定） */
const NO_THREADS: ResolvedThread[] = []
const NOT_EXPANDED = () => false
const NOOP_TOGGLE = () => {}
const NOOP_CREATE = async () => {}
const NO_BUBBLE = () => null

export interface MonacoMarkdownEditorProps {
  value: string
  onChange: (value: string) => void
  readOnly?: boolean
  theme: "paper" | "ink"
  placeholder?: string
  onMountEditor?: (editor: Parameters<OnMount>[0]) => void
  /** 行内评论：为 true 时开启字形边距（锚点末行的评论图标列） */
  commentsEnabled?: boolean
  /**
   * 行内评论参数（editor/value/enabled 由本组件自供）。
   * 本组件处于 next/dynamic(ssr:false) 边界内，可安全调用 useMonacoComments。
   */
  comments?: Omit<MonacoCommentsArgs, "editor" | "value" | "enabled">
}

export default function MonacoMarkdownEditor({
  value,
  onChange,
  readOnly,
  theme,
  placeholder,
  onMountEditor,
  commentsEnabled,
  comments,
}: MonacoMarkdownEditorProps) {
  const [editorInstance, setEditorInstance] = useState<Parameters<OnMount>[0] | null>(null)
  const appearance = useDesktopStore(state => state.bootstrap?.settings.appearance)
  const platform = useDesktopStore(state => state.bootstrap?.platform)

  useEffect(() => {
    if (!editorInstance || !platform) return
    let stopped = false, dispose: (() => void) | undefined
    void bindMonacoCommandTarget(editorInstance, platform).then(value => {
      if (stopped) value(); else dispose = value
    }).catch(error => console.error("MONACO_COMMAND_ADAPTER_UNAVAILABLE", error))
    return () => { stopped = true; dispose?.() }
  }, [editorInstance, platform])

  /* 主题切换：Monaco 配色 + 书写字体（宣纸宋体 / 玄墨等宽） */
  useEffect(() => {
    monaco.editor.setTheme(theme)
    for (const model of monaco.editor.getModels()) {
      monaco.editor.setModelLanguage(model, "markdown")
    }
  }, [theme])

  /* WebFont 就绪后重排，避免字体度量偏差 */
  useEffect(() => {
    document.fonts?.ready.then(() => monaco.editor.remeasureFonts())
  }, [])

  /* 行内评论：锚点高亮 / 字形边距图标 / 气泡 ViewZone / 选区浮钮（comments 缺省时完全静默） */
  const { overlay } = useMonacoComments({
    editor: editorInstance,
    value,
    enabled: commentsEnabled === true && !!comments,
    showAll: comments?.showAll ?? true,
    readOnly,
    threads: comments?.threads ?? NO_THREADS,
    isExpanded: comments?.isExpanded ?? NOT_EXPANDED,
    onToggleThread: comments?.onToggleThread ?? NOOP_TOGGLE,
    onCreateComment: comments?.onCreateComment ?? NOOP_CREATE,
    renderBubble: comments?.renderBubble ?? NO_BUBBLE,
  })

  const handleMount: OnMount = (editor) => {
    setEditorInstance(editor)
    onMountEditor?.(editor)
    requestAnimationFrame(() => editor.layout())
  }

  return (
    <div className="relative h-full min-h-0 w-full min-w-0">
      {value === "" && placeholder ? (
        <div className="pointer-events-none absolute left-[76px] top-[22px] z-10 text-sm text-muted-foreground/60">
          {placeholder}
        </div>
      ) : null}
      <Editor
        language="markdown"
        value={value}
        theme={theme}
        onChange={(v) => onChange(v ?? "")}
        onMount={handleMount}
        options={{
          readOnly,
          glyphMargin: commentsEnabled === true,
          wordWrap: appearance?.wordWrap ? "on" : "off",
          lineNumbers: appearance?.lineNumbers ? "on" : "off",
          minimap: { enabled: false },
          padding: { top: 22, bottom: 60 },
          scrollBeyondLastLine: false,
          renderLineHighlight: "all",
          // 关闭「光标所在词的其他出现处」高亮：Monaco 的 wordSeparators 不含中文全角
          // 标点（。，、；：""），整段中文会被当成一个「词」，光标一停整段刷上
          // vs/vs-dark 默认的 wordHighlightBackground 灰底（ink 下 72% 灰，极其显眼）。
          // 纯中文写作场景该特性无意义，直接关掉；选中文字找相同词仍由
          // selectionHighlight 承担（选区匹配不受分词影响）。
          occurrencesHighlight: "off",
          smoothScrolling: true,
          cursorBlinking: "smooth",
          cursorSmoothCaretAnimation: "on",
          automaticLayout: true,
          fixedOverflowWidgets: true,
          fontLigatures: true,
          // 中文写作为主的编辑器：全角标点（，、。；：""）无处不在，Monaco 默认的
          // 易混淆 Unicode 字符高亮会把每个全角标点框起来（被误报成「逗号带框去不掉」）；
          // 仅关掉歧义高亮，invisibleCharacters 保留默认开启（零宽字符仍可见）。
          unicodeHighlight: { ambiguousCharacters: false },
          scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
          ...MONACO_FONT_OPTS[theme],
          ...(appearance ? { fontFamily: desktopFontFamily(appearance.bodyFont, true), fontSize: appearance.bodyFontSize, lineHeight: Math.round(appearance.bodyFontSize * appearance.lineHeight) } : {}),
        }}
      />
      {/* 评论 overlay（气泡 portal + 选区浮钮）:坐标以本容器为原点 */}
      {overlay}
    </div>
  )
}
