"use client"

import { cn } from "@/lib/utils"

import type { CropRect } from "./types"

/**
 * 按裁剪区域显示图像的一部分：只渲染原图中 crop 框出的部分并填满容器。
 * 调用方需提供带 relative + overflow-hidden + 固定尺寸的容器；
 * 容器宽高比应与 crop 的物理宽高比一致，否则图像会拉伸。
 * crop 为 null 时退化为整图 object-cover。
 */
export function CroppedImage({
  src,
  crop,
  alt,
  className,
}: {
  src: string
  crop: CropRect | null
  alt: string
  className?: string
}) {
  if (!crop) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- 运行时上传的本地图片，不走 next/image 优化
      <img
        src={src}
        alt={alt}
        draggable={false}
        className={cn("absolute inset-0 h-full w-full object-cover", className)}
      />
    )
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- 运行时上传的本地图片，不走 next/image 优化
    <img
      src={src}
      alt={alt}
      draggable={false}
      className={cn("absolute max-w-none", className)}
      style={{
        left: `${(-crop.x / crop.w) * 100}%`,
        top: `${(-crop.y / crop.h) * 100}%`,
        width: `${100 / crop.w}%`,
        height: `${100 / crop.h}%`,
      }}
    />
  )
}
