import { cn } from "@/lib/utils"

export type SealVariant = "mark" | "full" | "horizontal" | "formal" | "avatar"

const VARIANTS = {
  mark: { file: "seal-mark", size: "size-[26px]", width: 128, height: 128 },
  full: { file: "seal", size: "size-[26px]", width: 128, height: 128 },
  horizontal: { file: "logo-horizontal", size: "h-8 w-[110px]", width: 440, height: 128 },
  formal: { file: "logo-formal", size: "h-[115px] w-[90px]", width: 360, height: 460 },
  avatar: { file: "logo-avatar", size: "size-12", width: 256, height: 256 },
} satisfies Record<SealVariant, { file: string; size: string; width: number; height: number }>

/**
 * 玄印写作「温玉」原生 SVG 标志（用户选中的 B 版）；母版见 logo/vector/。
 * mark/full 保持原有图形标 API；horizontal/formal/avatar 是对应场景的组合。
 * 双主题由 CSS 切换，无客户端主题读取或水合闪烁。className 可覆盖默认尺寸。
 */
export function Seal({ className, variant = "mark" }: { className?: string; variant?: SealVariant }) {
  const { file, size, width, height } = VARIANTS[variant]
  return (
    <span role="img" aria-label="玄印写作" className={cn("flex flex-none items-center justify-center", size, className)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- 本地 SVG 无需位图优化；双 img 由主题 CSS 即时切换 */}
      <img
        src={`/brand/${file}-paper.svg`}
        alt=""
        aria-hidden
        width={width}
        height={height}
        className="size-full object-contain dark:hidden"
      />
      {/* eslint-disable-next-line @next/next/no-img-element -- 同上 */}
      <img
        src={`/brand/${file}-ink.svg`}
        alt=""
        aria-hidden
        width={width}
        height={height}
        className="hidden size-full object-contain dark:block"
      />
    </span>
  )
}
