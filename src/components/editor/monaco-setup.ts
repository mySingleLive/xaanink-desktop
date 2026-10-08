"use client"

/**
 * Monaco 本地打包装配（不走 CDN）：
 * - 注册「宣纸 / 玄墨」双主题（色值与 globals.css 设计令牌一致）
 * - 配置基础 editor worker（Turbopack 支持 new Worker(new URL(...))）
 * - @monaco-editor/react 默认从 CDN 加载内核，改为 loader.config({ monaco }) 本地注入
 *
 * 本模块只能在客户端加载（import 处需经 next/dynamic ssr:false）。
 */
import * as monaco from "monaco-editor"
import { loader } from "@monaco-editor/react"

export const MONACO_FONT_OPTS = {
  paper: {
    fontFamily: '"Noto Serif SC","Songti SC","STSong",serif',
    fontSize: 15,
    lineHeight: 30,
  },
  ink: {
    fontFamily: '"JetBrains Mono","SF Mono",Menlo,monospace',
    fontSize: 13,
    lineHeight: 23,
  },
} as const

monaco.editor.defineTheme("paper", {
  base: "vs",
  inherit: true,
  rules: [
    { token: "", foreground: "2b251b" },
    { token: "keyword", foreground: "b03524", fontStyle: "bold" },
    { token: "strong", foreground: "b03524", fontStyle: "bold" },
    { token: "emphasis", foreground: "3c5f5a" },
    { token: "string", foreground: "3c5f5a" },
    { token: "string.link", foreground: "8f6b23", fontStyle: "underline" },
    { token: "comment", foreground: "8a7a5c", fontStyle: "italic" },
    { token: "number", foreground: "8f6b23" },
    { token: "tag", foreground: "b03524" },
    { token: "variable", foreground: "6b5f43" },
  ],
  colors: {
    "editor.background": "#f9f4e4",
    "editor.foreground": "#2b251b",
    "editor.lineHighlightBackground": "#f1e8ce",
    "editor.lineHighlightBorder": "#00000000",
    "editorLineNumber.foreground": "#b3a67f",
    "editorLineNumber.activeForeground": "#b03524",
    "editorCursor.foreground": "#b03524",
    "editor.selectionBackground": "#b0352447",
    "editor.inactiveSelectionBackground": "#b0352421",
    "editor.selectionHighlightBackground": "#b0352424",
    "editorIndentGuide.background1": "#d8cba64d",
    "editorWidget.background": "#faf5e8",
    "editorWidget.border": "#d8cba6",
    "scrollbarSlider.background": "#c9bb9040",
    "scrollbarSlider.hoverBackground": "#b3a67f66",
  },
})

monaco.editor.defineTheme("ink", {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "", foreground: "ece7e1" },
    { token: "keyword", foreground: "e07a5f", fontStyle: "bold" },
    { token: "strong", foreground: "e07a5f", fontStyle: "bold" },
    { token: "emphasis", foreground: "d9a45b" },
    { token: "string", foreground: "7cb083" },
    { token: "string.link", foreground: "d9a45b", fontStyle: "underline" },
    { token: "comment", foreground: "8a8078", fontStyle: "italic" },
    { token: "number", foreground: "d9a45b" },
    { token: "tag", foreground: "e07a5f" },
    { token: "variable", foreground: "b3a89d" },
  ],
  colors: {
    "editor.background": "#100d0c",
    "editor.foreground": "#ece7e1",
    "editor.lineHighlightBackground": "#171211",
    "editor.lineHighlightBorder": "#00000000",
    "editorLineNumber.foreground": "#4a413c",
    "editorLineNumber.activeForeground": "#e07a5f",
    "editorCursor.foreground": "#e07a5f",
    "editor.selectionBackground": "#e07a5f59",
    "editor.inactiveSelectionBackground": "#e07a5f2b",
    "editor.selectionHighlightBackground": "#e07a5f2e",
    "editorIndentGuide.background1": "#fff8f012",
    "editorWidget.background": "#171312",
    "editorWidget.border": "#fff8f014",
    "scrollbarSlider.background": "#fff8f010",
    "scrollbarSlider.hoverBackground": "#fff8f020",
  },
})

self.MonacoEnvironment = {
  getWorker() {
    return new Worker(
      new URL("monaco-editor/editor/editor.worker.js", import.meta.url),
      { type: "module" }
    )
  },
}

loader.config({ monaco })

export { monaco }
