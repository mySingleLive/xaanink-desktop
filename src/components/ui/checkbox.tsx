"use client"

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox"
import { CheckIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/** 方形勾选框（正文改进对话框等列表勾选场景）；勾选态 bg-primary，语义令牌取色 */
function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "flex size-[15px] shrink-0 items-center justify-center rounded-[4px] border border-input bg-transparent text-transparent transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator data-slot="checkbox-indicator" className="flex items-center justify-center">
        <CheckIcon className="size-2.5" strokeWidth={3.5} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
