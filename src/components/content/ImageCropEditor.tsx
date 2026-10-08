"use client"

import { useRef } from "react"

import { cn } from "@/lib/utils"

import type { CropRect } from "./types"

const MIN_W = 0.08

/** 在渲染尺寸 rect 下，按比例 aspect（宽/高）计算居中的最大默认裁剪区域 */
function defaultCrop(width: number, height: number, aspect: number): CropRect {
  let w: number
  let h: number
  if (width / height > aspect) {
    h = 1
    w = (aspect * height) / width
  } else {
    w = 1
    h = width / (aspect * height)
  }
  return { x: (1 - w) / 2, y: (1 - h) / 2, w, h }
}

interface DragState {
  mode: "move" | "resize"
  startClientX: number
  startClientY: number
  startCrop: CropRect
  rect: DOMRect
}

/**
 * 原始图像 + 可拖动虚线裁剪框：
 * - 框内拖动移动选区，右下角手柄拖动缩放（锁定目标宽高比）；
 * - crop 为 null 时待图像加载完成后自动计算默认裁剪并提交；
 * - onChange 实时回调（预览联动），onCommit 在拖动结束时回调（持久化）。
 */
export function ImageCropEditor({
  src,
  aspect,
  crop,
  onChange,
  onCommit,
}: {
  src: string
  /** 目标宽高比（宽/高）：头像=1，立绘=2/3 */
  aspect: number
  crop: CropRect | null
  onChange: (crop: CropRect) => void
  onCommit: (crop: CropRect) => void
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)

  const handleImageLoad = () => {
    // 新图像（或首次）且服务端无裁剪记录时，给出默认裁剪并持久化
    if (crop !== null) return
    const rect = wrapRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0 || rect.height === 0) return
    const def = defaultCrop(rect.width, rect.height, aspect)
    onChange(def)
    onCommit(def)
  }

  const beginDrag = (
    e: React.PointerEvent<HTMLElement>,
    mode: DragState["mode"]
  ) => {
    if (!crop) return
    const rect = wrapRef.current?.getBoundingClientRect()
    if (!rect) return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = {
      mode,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startCrop: crop,
      rect,
    }
  }

  const handleDragMove = (e: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const { rect, startCrop } = drag
    const dx = (e.clientX - drag.startClientX) / rect.width
    const dy = (e.clientY - drag.startClientY) / rect.height

    if (drag.mode === "move") {
      onChange({
        ...startCrop,
        x: Math.min(Math.max(startCrop.x + dx, 0), 1 - startCrop.w),
        y: Math.min(Math.max(startCrop.y + dy, 0), 1 - startCrop.h),
      })
      return
    }

    // resize：宽度随横向拖动变化，高度按目标比例推出，越界时回算
    let w = Math.min(Math.max(startCrop.w + dx, MIN_W), 1 - startCrop.x)
    let h = (w * rect.width) / (aspect * rect.height)
    const maxH = 1 - startCrop.y
    if (h > maxH) {
      h = maxH
      w = (h * aspect * rect.height) / rect.width
    }
    onChange({ ...startCrop, w, h })
  }

  const endDrag = () => {
    if (!dragRef.current) return
    dragRef.current = null
    if (crop) onCommit(crop)
  }

  return (
    <div ref={wrapRef} className="relative">
      {/* eslint-disable-next-line @next/next/no-img-element -- 需要自然尺寸做裁剪换算，不走 next/image */}
      <img
        src={src}
        alt="原始图像"
        onLoad={handleImageLoad}
        draggable={false}
        className="block max-h-[46vh] w-auto max-w-full select-none rounded-md"
      />
      {crop && (
        <div
          role="presentation"
          onPointerDown={(e) => beginDrag(e, "move")}
          onPointerMove={handleDragMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className="absolute cursor-move border-2 border-dashed border-primary shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"
          style={{
            left: `${crop.x * 100}%`,
            top: `${crop.y * 100}%`,
            width: `${crop.w * 100}%`,
            height: `${crop.h * 100}%`,
          }}
        >
          <span
            role="presentation"
            aria-label="拖动调整选区大小"
            onPointerDown={(e) => beginDrag(e, "resize")}
            onPointerMove={handleDragMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            className={cn(
              "absolute -right-[7px] -bottom-[7px] size-3.5 cursor-nwse-resize",
              "rounded-[3px] border border-primary-foreground bg-primary shadow"
            )}
          />
        </div>
      )}
    </div>
  )
}
