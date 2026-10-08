"use client"

import { useEffect, useRef } from "react"
import { useQuery } from "@tanstack/react-query"
import { Maximize2, Minimize2, PanelRight, X } from "lucide-react"

import { renderTabContent } from "@/components/content/registry"
import { StagedInterceptionBootstrap, StagedSaveSurface } from "@/components/content/StagedSaveSurface"
import { StorySources, StoryActivityBanner, StoryLivePreview } from "@/components/content/StoryWorkflowPanel"
import { cn } from "@/lib/utils"
import { isTentativeNovelTitle } from "@/lib/novel-title"
import { TentativeBadge } from "@/components/ui/tentative-badge"
import { getTabIcon, useTabsStore } from "@/stores/tabs"

/** 右栏：Chrome 式 tab 条 + 内容区 */
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

  // 小说 tab 的图标跟随封面：复用侧栏的 ["novels"] 缓存（契约=数组），封面变更失效后自动刷新
  const { data: novels } = useQuery<{ id: string; coverUrl: string | null }[]>({
    queryKey: ["novels"],
    queryFn: async () => {
      const res = await fetch("/api/novels")
      if (!res.ok) throw new Error("加载小说列表失败")
      const data = (await res.json()) as {
        novels: { id: string; coverUrl: string | null }[]
      }
      return data.novels
    },
  })
  const coverByNovel = new Map((novels ?? []).map((n) => [n.id, n.coverUrl]))

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null

  /* 窄条下 tab 会溢出滚动容器；激活 tab 必须始终滚进视口（Chrome 式），
     否则它可能被完全裁出视野。容器尺寸变化（窗口/分栏动画）也要重对齐。 */
  const scrollerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const reveal = () => {
      scroller
        .querySelector('[role="tab"][aria-selected="true"]')
        ?.scrollIntoView({ block: "nearest", inline: "nearest" })
    }
    reveal()
    const observer = new ResizeObserver(reveal)
    observer.observe(scroller)
    return () => observer.disconnect()
  }, [activeTabId, tabs])

  return (
    <div className="content-tabs flex h-full flex-col bg-editor">
      <StagedInterceptionBootstrap />
      {tabs.length === 0 && <div className="desktop-drag h-11 shrink-0" aria-hidden="true" />}
      {tabs.length > 0 && (
        <div
          role="tablist"
          className="desktop-drag flex shrink-0 items-end border-b border-sidebar-border bg-sidebar px-2 pt-1.5"
        >
          {/* top-px 挂在滚动容器上而不是每个 tab 上：tab 的相对位移会制造 1px 纵向滚动溢出，
              overflow-x-auto 会让 overflow-y 计算为 auto，从而在容器右缘冒出一条纵向滚动条 */}
          <div ref={scrollerRef} className="relative top-px flex min-w-0 flex-1 items-end gap-0.5 overflow-x-auto">
            {tabs.map((tab) => {
              const Icon = getTabIcon(tab)
              const active = tab.id === activeTabId
              const coverUrl = tab.type === "novel" ? coverByNovel.get(tab.novelId) : null
              const suffix = tab.type === "chapter-content" ? "正文" : tab.type === "chapter-outline" ? "大纲" : tab.type === "chapter-candidate" ? "候选稿" : null
              const title = suffix ? `${tab.title} · ${suffix}` : tab.title
              return (
                <div
                  key={tab.id}
                  role="tab"
                  aria-selected={active}
                  aria-label={title}
                  title={title}
                  tabIndex={0}
                  onClick={() => activateTab(tab.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") activateTab(tab.id)
                  }}
                  onAuxClick={(e) => {
                    if (e.button === 1) closeTab(tab.id)
                  }}
                  className={cn(
                    "group relative flex h-8 max-w-[min(13rem,100%)] min-w-24 shrink-0 cursor-pointer items-center gap-1.5 rounded-t-lg border border-b-0 px-3 text-[12.5px] select-none",
                    active
                      ? "border-sidebar-border bg-editor text-foreground shadow-[inset_0_2px_0_var(--primary)]"
                      : "border-transparent text-muted-foreground hover:bg-hover-wash hover:text-foreground"
                  )}
                >
                  {coverUrl ? (
                    /* eslint-disable-next-line @next/next/no-img-element -- 本地封面缩略图 */
                    <img
                      src={coverUrl}
                      alt=""
                      className="aspect-[2/3] h-4 shrink-0 rounded-[2px] object-cover"
                    />
                  ) : (
                    <Icon className="size-3.5 shrink-0" />
                  )}
                  <span className="truncate">{tab.title}</span>
                  {tab.type === "novel" && isTentativeNovelTitle(tab.title) && <TentativeBadge />}
                  {suffix && <span className="shrink-0 text-muted-foreground" data-tab-type={tab.type}>· {suffix}</span>}
                  <button
                    type="button"
                    aria-label={`关闭 ${title}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      closeTab(tab.id)
                    }}
                    className={cn(
                      "ml-0.5 flex size-[15px] shrink-0 items-center justify-center rounded hover:bg-hover-wash",
                      active ? "opacity-60 hover:opacity-100" : "opacity-0 group-hover:opacity-60 hover:opacity-100!"
                    )}
                  >
                    <X className="size-3" />
                  </button>
                </div>
              )
            })}
          </div>
          {/* 全屏切换：进入=隐藏中间 AI 对话面板、内容区吃满；退出=恢复三栏布局 */}
          <button
            type="button"
            aria-label={fullscreen ? "退出全屏" : "进入全屏"}
            aria-pressed={fullscreen}
            title={fullscreen ? "退出全屏（显示 AI 对话面板）" : "进入全屏（隐藏 AI 对话面板）"}
            onClick={onToggleFullscreen}
            className={cn(
              "mb-1 ml-1 flex size-6 shrink-0 items-center justify-center rounded-md transition-colors",
              fullscreen
                ? "bg-active-wash text-primary"
                : "text-muted-foreground hover:bg-hover-wash hover:text-foreground"
            )}
          >
            {fullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
          </button>
          {/* 显示/隐藏内容面板：收起整个右侧内容区；无高亮态（tab 条在面板必然展开），
              恢复入口在对话区头部按钮与侧栏树 */}
          <button
            type="button"
            aria-label="显示 / 隐藏内容面板"
            title="显示 / 隐藏内容面板"
            onClick={onToggleContent}
            className="mb-1 ml-1 flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-hover-wash hover:text-foreground"
          >
            <PanelRight className="size-3.5" />
          </button>
        </div>
      )}

      {activeTab && <StoryActivityBanner novelId={activeTab.novelId} />}
      {activeTab?.refId && ["chapter-outline", "chapter-content"].includes(activeTab.type) && <StorySources novelId={activeTab.novelId} artifactKey={`${activeTab.type}:${activeTab.refId}`} />}
      {activeTab && <StoryLivePreview tab={activeTab} />}
      <div className="min-h-0 flex-1">
        {activeTab ? (
          // Monaco 的实例不能在 Activity 清理 effect 后复用；只隐藏可保留编辑实例与草稿。
          tabs.map(tab => (
            <div key={tab.id} hidden={tab.id !== activeTabId} className="h-full">
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
