"use client"

import { useEffect, useId, useState } from "react"
import { useNovelList } from "@/lib/novel-list"
import { ChevronDown, Maximize2, Minimize2, PanelRight, X } from "lucide-react"

import { renderTabContent } from "@/components/content/registry"
import { StagedInterceptionBootstrap, StagedSaveSurface } from "@/components/content/StagedSaveSurface"
import { StorySources, StoryActivityBanner, StoryLivePreview } from "@/components/content/StoryWorkflowPanel"
import { cn } from "@/lib/utils"
import { isTentativeNovelTitle } from "@/lib/novel-title"
import { TentativeBadge } from "@/components/ui/tentative-badge"
import { getTabIcon, useTabsStore } from "@/stores/tabs"
import { useDesktopStore } from "@/stores/desktop"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useContentTabStrip } from "./useContentTabStrip"

/** 右栏：可排序的内容标签 + 保留实例的真实业务面板 */
export function ContentTabs({
  fullscreen,
  onToggleFullscreen,
  onToggleContent,
}: {
  /** 全屏态（中间 AI 对话面板已隐藏），用于切换按钮的图标与按下态 */
  fullscreen: boolean
  /** 进入/退出全屏切换（DashboardShell 的 chat 面板显隐动画） */
  onToggleFullscreen: () => void
  /** 隐藏整个内容面板（隐藏后经对话区头部按钮或侧栏树重新打开 tab 恢复） */
  onToggleContent: () => void
}) {
  const tabs = useTabsStore((s) => s.tabs)
  const activeTabId = useTabsStore((s) => s.activeTabId)
  const activateTab = useTabsStore((s) => s.activateTab)
  const closeTab = useTabsStore((s) => s.closeTab)
  const moveTab = useTabsStore((s) => s.moveTab)
  const desktopBootstrap = useDesktopStore((s) => s.bootstrap)
  const strip = useContentTabStrip(tabs, activeTabId, moveTab)
  const [menuOpen, setMenuOpen] = useState(false)
  const prefix = useId()
  useEffect(() => { if (!strip.hasOverflow) setMenuOpen(false) }, [strip.hasOverflow])

  // 封面与侧栏、对话区共享完整列表状态，失效后自动刷新。
  const { data: novelList } = useNovelList()
  const coverByNovel = new Map((novelList?.novels ?? []).map((n) => [n.id, n.coverUrl]))

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null

  const completeTitle = (tab: (typeof tabs)[number]) => {
    const suffix = tab.type === "chapter-content" ? "正文" : tab.type === "chapter-outline" ? "大纲" : tab.type === "chapter-candidate" ? "候选稿" : null
    return suffix ? `${tab.title} · ${suffix}` : tab.title
  }

  return (
    <div className="content-tabs flex h-full flex-col bg-editor">
      <StagedInterceptionBootstrap />
      {tabs.length === 0 && (
        <div
          data-desktop-caption={desktopBootstrap?.platform === "win32" ? "win32" : undefined}
          className="desktop-drag flex h-11 shrink-0 items-center justify-end px-2"
          // Keep the Windows caption and fixed app menu clear, including at
          // reduced Electron zoom when titlebar env values are unavailable.
          style={desktopBootstrap?.platform === "win32" ? {
            paddingRight: `calc(max(100vw - env(titlebar-area-width, calc(100vw - 138px)), ${138 / desktopBootstrap.settings.appearance.zoom}px) + ${28 / desktopBootstrap.settings.appearance.zoom}px + 12px)`,
          } : undefined}
        >
          <button
            type="button"
            aria-label="隐藏内容面板"
            title="隐藏内容面板"
            onClick={onToggleContent}
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-hover-wash hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <PanelRight className="size-4" />
          </button>
        </div>
      )}
      {tabs.length > 0 && (
        <div
          data-desktop-caption={desktopBootstrap?.platform === "win32" ? "win32" : undefined}
          className="desktop-drag content-tabs-caption"
          style={desktopBootstrap?.platform === "win32" ? {
            paddingRight: `calc(max(100vw - env(titlebar-area-width, calc(100vw - 138px)), ${138 / desktopBootstrap.settings.appearance.zoom}px) + ${28 / desktopBootstrap.settings.appearance.zoom}px + 12px)`,
            justifyContent: "flex-end",
          } : undefined}
        >
          <div ref={strip.viewportRef} className="content-tabs-viewport" role="tablist" aria-label="内容标签" aria-orientation="horizontal" onClickCapture={strip.onClickCapture}>
            <div ref={strip.trackRef} className="content-tabs-track">
            {tabs.map((tab) => {
              const Icon = getTabIcon(tab)
              const active = tab.id === activeTabId
              const coverUrl = tab.type === "novel" ? coverByNovel.get(tab.novelId) : null
              const suffix = tab.type === "chapter-content" ? "正文" : tab.type === "chapter-outline" ? "大纲" : tab.type === "chapter-candidate" ? "候选稿" : null
              const title = suffix ? `${tab.title} · ${suffix}` : tab.title
              return (
                <div
                  key={tab.id}
                  id={`${prefix}-tab-${tab.id}`}
                  data-tab-id={tab.id}
                  data-active={active}
                  role="tab"
                  aria-controls={`${prefix}-panel-${tab.id}`}
                  aria-selected={active}
                  aria-label={title}
                  title={title}
                  tabIndex={strip.focusedId === tab.id ? 0 : -1}
                  onClick={() => activateTab(tab.id)}
                  onFocus={() => strip.onFocus(tab.id)}
                  onKeyDown={(e) => strip.onKeyDown(e, tab.id, activateTab)}
                  onPointerDown={(e) => { setMenuOpen(false); strip.onPointerDown(e) }}
                  onAuxClick={(e) => {
                    if (e.button === 1) closeTab(tab.id)
                  }}
                  className="content-tab"
                >
                  {coverUrl ? (
                    /* eslint-disable-next-line @next/next/no-img-element -- 本地封面缩略图 */
                    <img
                      src={coverUrl}
                      alt=""
                      draggable={false}
                      className="aspect-[2/3] h-4 shrink-0 rounded-[2px] object-cover"
                    />
                  ) : (
                    <Icon className="size-3.5 shrink-0" />
                  )}
                  <span className="content-tab-title">{tab.title}</span>
                  {tab.type === "novel" && isTentativeNovelTitle(tab.title) && <TentativeBadge />}
                  {suffix && <span className="content-tab-suffix" data-tab-type={tab.type}>· {suffix}</span>}
                  <button
                    type="button"
                    aria-label={`关闭 ${title}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      closeTab(tab.id)
                    }}
                    className="content-tab-close"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              )
            })}
            </div>
            <div ref={strip.markerRef} className="content-tabs-drop-marker" aria-hidden="true" hidden />
          </div>
          <div ref={strip.toolsRef} className="content-tabs-tools" data-compact={strip.compact}>
            {strip.hasOverflow && <DropdownMenu open={menuOpen} onOpenChange={open => { if (open) strip.cancel(); setMenuOpen(open) }} modal={false}>
              <DropdownMenuTrigger render={<button type="button" className="content-tabs-tool content-tabs-menu-trigger" aria-label="所有标签" title="所有标签" />}><ChevronDown /></DropdownMenuTrigger>
              <DropdownMenuContent className="content-tabs-menu" align="end" aria-label="所有标签">
                <DropdownMenuRadioGroup value={activeTabId ?? ""} onValueChange={activateTab}>
                  {tabs.map(tab => <div key={tab.id} className="content-tabs-menu-row" data-tab-id={tab.id}>
                    <DropdownMenuRadioItem closeOnClick={true} value={tab.id} aria-label={completeTitle(tab)} className="content-tabs-menu-select">{completeTitle(tab)}</DropdownMenuRadioItem>
                    <DropdownMenuItem closeOnClick={false} aria-label={`关闭 ${completeTitle(tab)}`} className="content-tabs-menu-close" onClick={() => closeTab(tab.id)}><X /></DropdownMenuItem>
                  </div>)}
                </DropdownMenuRadioGroup>
                {strip.compact && <>
                  <DropdownMenuItem aria-label={fullscreen ? "退出全屏" : "进入全屏"} onClick={onToggleFullscreen}>{fullscreen ? <Minimize2 /> : <Maximize2 />}{fullscreen ? "退出全屏" : "进入全屏"}</DropdownMenuItem>
                  <DropdownMenuItem aria-label="显示 / 隐藏内容面板" onClick={onToggleContent}><PanelRight />显示 / 隐藏内容面板</DropdownMenuItem>
                </>}
              </DropdownMenuContent>
            </DropdownMenu>}
          {/* 全屏切换：进入=隐藏中间 AI 对话面板、内容区吃满；退出=恢复三栏布局 */}
          {!strip.compact && <button
            type="button"
            aria-label={fullscreen ? "退出全屏" : "进入全屏"}
            aria-pressed={fullscreen}
            title={fullscreen ? "退出全屏（显示 AI 对话面板）" : "进入全屏（隐藏 AI 对话面板）"}
            onClick={onToggleFullscreen}
            className={cn(
              "content-tabs-tool",
              fullscreen
                ? "bg-active-wash text-primary"
                : "text-muted-foreground hover:bg-hover-wash hover:text-foreground"
            )}
          >
            {fullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
          </button>}
          {/* 显示/隐藏内容面板：收起整个右侧内容区；无高亮态（tab 条在面板必然展开），
              恢复入口在对话区头部按钮与侧栏树 */}
          {!strip.compact && <button
            type="button"
            aria-label="显示 / 隐藏内容面板"
            title="显示 / 隐藏内容面板"
            onClick={onToggleContent}
            className="content-tabs-tool text-muted-foreground hover:bg-hover-wash hover:text-foreground"
          >
            <PanelRight className="size-3.5" />
          </button>}
          </div>
        </div>
      )}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{strip.announcement}</div>

      {activeTab && <StoryActivityBanner novelId={activeTab.novelId} />}
      {activeTab?.refId && ["chapter-outline", "chapter-content"].includes(activeTab.type) && <StorySources novelId={activeTab.novelId} artifactKey={`${activeTab.type}:${activeTab.refId}`} />}
      {activeTab && <StoryLivePreview tab={activeTab} />}
      <div className="min-h-0 flex-1">
        {activeTab ? (
          // Monaco 的实例不能在 Activity 清理 effect 后复用；只隐藏可保留编辑实例与草稿。
          tabs.map(tab => (
            <div key={tab.id} id={`${prefix}-panel-${tab.id}`} role="tabpanel" aria-labelledby={`${prefix}-tab-${tab.id}`} hidden={tab.id !== activeTabId} className="h-full">
              <StagedSaveSurface tab={tab}>{renderTabContent(tab)}</StagedSaveSurface>
            </div>
          ))
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <p className="text-sm text-muted-foreground">
              从左侧树中选择小说或内容节点，在这里开始创作
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
