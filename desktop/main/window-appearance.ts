import type { Settings } from "../core/settings"

type Theme = Settings["appearance"]["theme"]
interface AppearanceWindow {
  isDestroyed(): boolean
  setBackgroundColor(color: string): void
  setTitleBarOverlay(options: { color: string; symbolColor: string; height: number }): void
}

export function syncNativeThemeSource(nativeTheme: { themeSource: "light" | "dark" | "system" }, theme: Theme) {
  const source = theme === "paper" ? "light" : theme === "ink" ? "dark" : "system"
  // The setter can emit updated synchronously. Avoid reassigning on reentry.
  if (nativeTheme.themeSource !== source) nativeTheme.themeSource = source
}

export function nativeWindowAppearance(theme: Theme, systemDark: boolean) {
  const dark = theme === "ink" || theme === "system" && systemDark
  return {
    // Match the real Web background/foreground tokens in globals.css.
    backgroundColor: dark ? "#0d0b0a" : "#f4edda",
    titleBarOverlay: {
      // Let the actual panel surface and its texture continue under captions.
      color: "#00000000",
      symbolColor: dark ? "#ece7e1" : "#2b251b",
      height: 44,
    },
  }
}

export function applyWindowAppearance(window: AppearanceWindow | null, platform: string, theme: Theme, systemDark: boolean) {
  if (!window || window.isDestroyed()) return
  const appearance = nativeWindowAppearance(theme, systemDark)
  window.setBackgroundColor(appearance.backgroundColor)
  if (platform === "win32") window.setTitleBarOverlay(appearance.titleBarOverlay)
}
