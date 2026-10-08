import type { LucideIcon } from "lucide-react"

interface PlaceholderPanelProps {
  icon: LucideIcon
  title: string
  description?: string
}

/** 内容区占位面板：后续阶段会被 registry 中的真实编辑器替换 */
export function PlaceholderPanel({ icon: Icon, title, description }: PlaceholderPanelProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <Icon className="size-7" />
      </div>
      <h2 className="text-lg font-medium">{title} 编辑功能即将上线</h2>
      <p className="max-w-sm text-sm text-muted-foreground">
        {description ?? "该模块将在后续阶段开放，敬请期待。"}
      </p>
    </div>
  )
}
