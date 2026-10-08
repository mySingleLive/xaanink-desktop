"use client"

import { useSyncExternalStore } from "react"
import { useTheme } from "next-themes"
import { Check, Moon, Palette, Sun } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export const THEME_OPTIONS = [
  { value: "paper", label: "宣纸", icon: Sun },
  { value: "ink", label: "玄墨", icon: Moon },
] as const

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme()
  // 服务端渲染 false、客户端 true，避免 hydration 不一致
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  )

  const current = THEME_OPTIONS.find((t) => t.value === theme)
  const CurrentIcon = current?.icon ?? Palette

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" size="sm" aria-label="切换主题皮肤" />
        }
      >
        {mounted ? <CurrentIcon /> : <Palette />}
        {mounted && current ? current.label : "皮肤"}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuLabel>主题皮肤</DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {THEME_OPTIONS.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onClick={() => setTheme(option.value)}
          >
            <option.icon />
            {option.label}
            {mounted && theme === option.value ? (
              <Check className="ml-auto" />
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
