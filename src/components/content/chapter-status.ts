import {
  Circle,
  CircleCheck,
  CircleCheckBig,
  CircleDot,
  Disc,
  type LucideIcon,
} from "lucide-react"

import type { ChapterStatus } from "@/generated/prisma/enums"

/** 章节状态图标：空心圆=待评审 → 半实心=已评审 → 实心=已生成 → 对勾=评审/定稿 */
export const CHAPTER_STATUS_ICONS: Record<ChapterStatus, LucideIcon> = {
  OUTLINE: Circle,
  REVIEWED: CircleDot,
  WRITTEN: Disc,
  CHAPTER_REVIEWED: CircleCheck,
  FINAL: CircleCheckBig,
}
