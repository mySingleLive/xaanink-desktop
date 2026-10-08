import { cn } from "@/lib/utils"

/**
 * 脑洞延迟建档的「暂定」标注：作品名仍是中性占位名（未命名作品·…）时，
 * 在侧栏树、内容标签、作品总览等显示处渲染；定题同步后自然消失。
 * 样式对齐侧栏树的「主」「伏笔」小签。
 */
export function TentativeBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-[3px] border border-gold/40 bg-gold/10 px-1 text-[9.5px] leading-[1.5] text-gold",
        className
      )}
    >
      暂定
    </span>
  )
}
