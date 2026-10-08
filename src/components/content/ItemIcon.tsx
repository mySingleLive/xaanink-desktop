"use client"

/**
 * 物品图标位：有图按 iconCrop 裁剪铺满；无图渲染占位槽位（墨石纹理底 + 内环细框
 * + 居中 Package 线框，与侧边栏「物品」同一图标语言；样式在 globals.css 的
 * .item-icon-slot 系，双主题语义令牌）。
 * variant="card"：44px 圆角方形（物品卡片首行，「方=物、圆=人」的形状语义）；
 * variant="detail"：120px 档案区大槽位（无图为虚线框「点击生成图标」，点击行为由调用方包裹）。
 */
import { Package } from "lucide-react"

import { cn } from "@/lib/utils"

import { CroppedImage } from "./CroppedImage"
import { normalizeCrop } from "./types"

export function ItemIcon({
  name,
  iconUrl,
  iconCrop,
  variant = "card",
  className,
}: {
  name: string
  iconUrl?: string | null
  iconCrop?: unknown
  variant?: "card" | "detail"
  className?: string
}) {
  const sizeClass = variant === "card" ? "size-11 rounded-[10px]" : "size-[120px] rounded-[14px]"

  if (iconUrl) {
    return (
      <span className={cn("item-icon-slot has-image", sizeClass, className)}>
        <CroppedImage src={iconUrl} crop={normalizeCrop(iconCrop)} alt={`${name}图标`} />
      </span>
    )
  }

  if (variant === "detail") {
    return (
      <span className={cn("item-icon-slot item-icon-detail-empty", sizeClass, className)}>
        <Package className="size-[30px]" strokeWidth={1.5} aria-hidden />
        <span className="text-xs">点击生成图标</span>
      </span>
    )
  }

  return (
    <span className={cn("item-icon-slot item-icon-empty", sizeClass, className)}>
      <Package className="size-[21px]" strokeWidth={1.5} aria-hidden />
    </span>
  )
}
