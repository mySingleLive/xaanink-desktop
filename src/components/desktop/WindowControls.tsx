"use client"
import { ArrowLeft, ArrowRight, Menu, PanelLeft } from "lucide-react"
import { useDesktopStore } from "@/stores/desktop"
import { useSyncExternalStore, type CSSProperties } from "react"
import { subscribeDesktopNavigation, desktopNavigationSnapshot, desktopNavigationServerSnapshot } from "@/lib/desktop/navigation-runtime"
export function SidebarWindowControls({ onToggleSidebar }: { onToggleSidebar?: () => void }) {
  const platform = useDesktopStore(state => state.bootstrap?.platform)
  const navigation = useSyncExternalStore(subscribeDesktopNavigation, desktopNavigationSnapshot, desktopNavigationServerSnapshot)
  return <div className="desktop-drag desktop-sidebar-controls flex h-11 shrink-0 items-center gap-1 px-2">
    {platform === "darwin" && <span className="w-[76px] shrink-0" aria-hidden="true" />}
    <button className="desktop-control disabled:opacity-40" aria-label="后退" disabled={!navigation.canBack} onPointerDown={event => event.preventDefault()} onClick={() => window.dispatchEvent(new CustomEvent("desktop:navigate", { detail: -1 }))}><ArrowLeft className="size-4" /></button>
    <button className="desktop-control disabled:opacity-40" aria-label="前进" disabled={!navigation.canForward} onPointerDown={event => event.preventDefault()} onClick={() => window.dispatchEvent(new CustomEvent("desktop:navigate", { detail: 1 }))}><ArrowRight className="size-4" /></button>
    <button className="desktop-control" aria-label="展开或收起左侧导航栏" onClick={onToggleSidebar}><PanelLeft className="size-4" /></button>
  </div>
}
export function WindowsMenuControl({platform:platformOverride}: {platform?: "darwin" | "win32"} = {}) {
  const bootstrapPlatform = useDesktopStore(state => state.bootstrap?.platform)
  const zoom = useDesktopStore(state => state.bootstrap?.settings?.appearance?.zoom ?? 1)
  const platform = platformOverride ?? bootstrapPlatform
  return platform === "win32" ? <button data-desktop-menu-button className="desktop-control desktop-windows-menu" style={{ "--desktop-caption-zoom": zoom } as CSSProperties} aria-label="应用程序菜单" onPointerDown={event=>event.preventDefault()} onClick={() => { void window.desktop?.command("app.menu") }}><Menu className="size-4" /></button> : null
}
