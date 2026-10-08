"use client"

/**
 * Markdown 预览：统一走 src/lib/markdown.ts（marked GFM + 代码语法高亮），
 * 主题化排版见 globals.css 的 .markdown-body。
 */
import { useMemo } from "react"

import { cn } from "@/lib/utils"
import { renderMarkdown } from "@/lib/markdown"

interface MarkdownPreviewProps {
  source: string
  /** 正文类文本：按书页排版（段落首行缩进两字） */
  novel?: boolean
  className?: string
}

export function MarkdownPreview({ source, novel, className }: MarkdownPreviewProps) {
  const html = useMemo(() => renderMarkdown(source), [source])

  return (
    <div className={cn("markdown-body no-scrollbar h-full overflow-y-auto", novel && "novel", className)}>
      <div
        className="mx-auto max-w-[720px] px-11 pb-24 pt-8"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  )
}
