"use client"

/**
 * 折叠容器（§3.6：折叠/展开必须有 200ms 过渡，规避「突兀收起」；§3.10：闭合后
 * display:none 不占布局，防 flex gap 双倍叠加）。
 * 开：先挂载（0 高度）、下一帧起做 max-height/opacity 过渡；合：过渡结束后卸载。
 * 内容高度经 ResizeObserver 量测，流式内容增长时 max-height 平滑跟随。
 */
import { useEffect, useRef, useState, type ReactNode } from "react"

import { cn } from "@/lib/utils"

export function Collapse({
  open,
  className,
  children,
}: {
  open: boolean
  className?: string
  children: ReactNode
}) {
  const [render, setRender] = useState(open)
  const [shown, setShown] = useState(open)
  const [height, setHeight] = useState<number | null>(null)
  const innerRef = useRef<HTMLDivElement>(null)

  // 开合状态机（setState 一律放 rAF/timeout 回调里，避让 react-hooks/set-state-in-effect）：
  // open → rAF 挂载、再一帧置 shown（先有 0 帧才有过渡）；close → 下一帧收起、240ms 后卸载
  useEffect(() => {
    let raf1 = 0
    let raf2 = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    if (open) {
      raf1 = requestAnimationFrame(() => {
        setRender(true)
        raf2 = requestAnimationFrame(() => setShown(true))
      })
    } else {
      raf1 = requestAnimationFrame(() => setShown(false))
      timer = setTimeout(() => setRender(false), 240)
    }
    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
      if (timer) clearTimeout(timer)
    }
  }, [open])

  // 内容高度量测（仅挂载期；RO 回调异步，不触发渲染期 setState）
  useEffect(() => {
    const el = innerRef.current
    if (!render || !el) return
    const ro = new ResizeObserver(() => setHeight(el.scrollHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [render])

  if (!render) return null
  return (
    <div
      className={cn("chat-collapse", className)}
      style={{
        maxHeight: shown ? (height ?? "none") : 0,
        opacity: shown ? 1 : 0,
      }}
    >
      <div ref={innerRef}>{children}</div>
    </div>
  )
}
