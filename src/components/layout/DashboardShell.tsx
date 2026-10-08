"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Group, Panel, Separator, useGroupRef } from "react-resizable-panels"

import { CommentDraftAccount } from "@/components/comments/comment-drafts"
import { useTabsStore } from "@/stores/tabs"
import { useChatStore } from "@/stores/chat"
import { Button } from "@/components/ui/button"
import { useDesktopCommands } from "@/lib/desktop/use-command-target"
import {desktopWorkspaceDraftSource,registerWorkspaceLayoutAdapter,type WorkspaceLayout} from "@/lib/desktop/workspace-draft-source"
import {settledWorkspaceLayout} from "@/lib/desktop/workspace-layout"

import { ChatPanel } from "./ChatPanel"
import { ContentTabs } from "./ContentTabs"
import { SidebarTree } from "./SidebarTree"

interface DashboardShellProps {
  user: { id: string; name: string; email: string; avatarUrl?: string }
}

/**
 * 弹簧阻尼系统的单位阶跃响应：t∈[0,1] 映射 0→1。zeta>=1 为临界阻尼（单调收敛、无过冲），
 * zeta<1 为欠阻尼（带一次过冲，越小过冲越明显）。
 * 角频率按「t=1 时包络衰减到约 1%」反推，保证动画在时长内收敛。
 */
function springEase(t: number, zeta: number): number {
  if (t <= 0) return 0
  if (t >= 1) return 1
  if (zeta >= 1) {
    // 临界阻尼：x(t) = 1 - (1 + wt)·e^(-wt)，w=6.6 时末帧残差约 1%
    const w = 6.6
    return 1 - (1 + w * t) * Math.exp(-w * t)
  }
  const w = 4.6 / zeta
  const wd = w * Math.sqrt(1 - zeta * zeta)
  return 1 - Math.exp(-zeta * w * t) * (Math.cos(wd * t) + ((zeta * w) / wd) * Math.sin(wd * t))
}

/** 展开动画：临界阻尼，顺滑滑入、无回弹 */
const OPEN_SPRING = { duration: 560, zeta: 1 }
/** 收起动画：临界阻尼，稍快地滑出、无回弹 */
const CLOSE_SPRING = { duration: 420, zeta: 1 }
/** chat 面板的像素最小宽度（与下方 Panel 的 minSize 保持一致） */
const CHAT_MIN_PX = 420

/** 分栏拖拽条：默认不可见，hover / 拖动时显示 primary 高亮；withLine 时常驻一条细浅的分割线 */
function ResizeHandle({ withLine = false }: { withLine?: boolean }) {
  return (
    <Separator className="flex w-1 justify-center bg-transparent transition-colors data-[separator=hover]:bg-primary/40 data-[separator=active]:bg-primary/40">
      {withLine && <div className="h-full w-px bg-border" />}
    </Separator>
  )
}

export function DashboardShell({ user }: DashboardShellProps) {
  const [initialLayout]=useState(()=>typeof window!=="undefined"&&window.desktop?desktopWorkspaceDraftSource.read().layout:null)
  const [narrowPane, setNarrowPane] = useState<"chat" | "content" | "sidebar">(initialLayout?.narrowPane??"chat")
  // 初始只展示「侧栏 + AI 对话」，打开/激活任意内容 tab 时自动展开右侧内容区
  const [contentVisible, setContentVisible] = useState(initialLayout?.contentVisible??false)
  // 内容区挂载状态：收起动画播放期间保持挂载，动画结束才卸载
  const [contentMounted, setContentMounted] = useState(initialLayout?.contentVisible??false)
  // 动画播放中：临时放开 content 的 minSize，允许宽度经过 0~30% 区间
  const [animating, setAnimating] = useState(false)
  const groupRef = useGroupRef()
  /** 状态镜像（订阅/动画回调里读最新值） */
  const visibleRef = useRef(initialLayout?.contentVisible??false)
  const mountedRef = useRef(initialLayout?.contentVisible??false)
  /** 重新展开时恢复到的宽度百分比；null = 从未展开过（首次均分） */
  const lastContentSizeRef = useRef<number | null>(initialLayout?.lastContentSize??null)
  /** 进行中的布局动画（换向时取消） */
  const animRef = useRef<{ cancel: () => void } | null>(null)
  // 侧栏显示/隐藏：初始展开；面板保持挂载（面板集合不变，避免触发库的组合布局记忆），
  // 隐藏时宽度弹到 0 并保持 minSize 0，恢复时弹回上次宽度
  const [sidebarVisible, setSidebarVisible] = useState(initialLayout?.sidebarVisible??true)
  const [sidebarAnimating, setSidebarAnimating] = useState(false)
  const sidebarVisibleRef = useRef(initialLayout?.sidebarVisible??true)
  /** 隐藏前的侧栏宽度百分比，供恢复；null = 从未隐藏过（用默认 260px 换算） */
  const lastSidebarSizeRef = useRef<number | null>(initialLayout?.lastSidebarSize??null)
  /** 进行中的侧栏动画（与内容区动画相互独立，可同时播放） */
  const sidebarAnimRef = useRef<{ cancel: () => void } | null>(null)
  /** 展开动画的目标宽度（动画途中收起时记为下次的恢复值） */
  const animTargetRef = useRef<number | null>(null)
  // 内容区全屏（隐藏中间 AI 对话面板）：与侧栏隐藏同款——chat 面板保持挂载、宽度弹到 0
  // （面板集合不变，不触发库的组合布局记忆，无需钉回），content 吸收全部空间；
  // 退出全屏弹回隐藏前宽度
  const [chatVisible, setChatVisible] = useState(initialLayout?.chatVisible??true)
  const [chatAnimating, setChatAnimating] = useState(false)
  const chatVisibleRef = useRef(initialLayout?.chatVisible??true)
  /** 隐藏前的 chat 宽度百分比，供退出全屏恢复；null = 从未隐藏过（用默认 560px 换算） */
  const lastChatSizeRef = useRef<number | null>(initialLayout?.lastChatSize??null)
  const layoutListeners=useRef(new Set<()=>void>())
  const narrowPaneRef=useRef(narrowPane);narrowPaneRef.current=narrowPane
  const pendingLayout=useRef<WorkspaceLayout|null>(null)
  const lastMeasuredSizes=useRef<WorkspaceLayout["sizes"]>(initialLayout?.sizes??{})
  const restoredFrame=useRef<number|null>(null)
  const announceLayout=useCallback(()=>{for(const listener of layoutListeners.current)listener()},[])
  /**
   * content 挂载前捕获的 sidebar 实时宽度（%）。库会按面板 id 组合记忆布局，
   * content 挂载导致面板集合变化时会恢复 "sidebar,chat,content" 组合记住的旧布局
   * （sidebar 跳回旧值），所以挂载前要存下实时值，注册完成后由 startWhenReady 钉回。
   */
  const preservedSidebarRef = useRef<number | null>(null)

  const cancelAnimation = useCallback(() => {
    animRef.current?.cancel()
    animRef.current = null
  }, [])

  const cancelSidebarAnimation = useCallback(() => {
    sidebarAnimRef.current?.cancel()
    sidebarAnimRef.current = null
  }, [])

  /** 逐帧把 sidebar 宽度弹到 target（布局百分比）：content 不动，chat 吸收全部变化量 */
  const animateSidebarTo = useCallback(
    (target: number, spring: { duration: number; zeta: number }, onDone: () => void) => {
      cancelSidebarAnimation()
      const group = groupRef.current
      const layout = group?.getLayout() ?? {}
      if (!group || layout.sidebar == null || layout.chat == null) {
        onDone()
        return
      }
      const { sidebar: sidebarFrom, chat: chatFrom, content } = layout
      /* 全屏（chat 0 宽）时 sidebar 的变化量改由 content 吸收，chat 保持 0 宽不动 */
      const chatHidden = !chatVisibleRef.current && content != null
      // 与 animateContentTo 同理：展开目标不得把 chat 压到 minSize 以下
      const chatMinPct = (CHAT_MIN_PX / window.innerWidth) * 100
      const clampedTarget = chatHidden
        ? Math.max(target, 0)
        : Math.min(target, Math.max(chatFrom + sidebarFrom - chatMinPct, 0))
      const chatTo = chatHidden ? 0 : chatFrom + (sidebarFrom - clampedTarget)
      const contentTo = chatHidden ? content + (sidebarFrom - clampedTarget) : content
      const startedAt = performance.now()
      let rafId = 0
      const frame = (now: number) => {
        const t = Math.min((now - startedAt) / spring.duration, 1)
        const e = springEase(t, spring.zeta)
        group.setLayout({
          sidebar: Math.max(sidebarFrom + (clampedTarget - sidebarFrom) * e, 0),
          chat: chatFrom + (chatTo - chatFrom) * e,
          ...(content != null
            ? { content: chatHidden ? content + (contentTo - content) * e : content }
            : {}),
        })
        if (t < 1) {
          rafId = requestAnimationFrame(frame)
        } else {
          group.setLayout({
            sidebar: clampedTarget,
            chat: chatTo,
            ...(content != null ? { content: contentTo } : {}),
          })
          sidebarAnimRef.current = null
          onDone()
        }
      }
      rafId = requestAnimationFrame(frame)
      sidebarAnimRef.current = { cancel: () => cancelAnimationFrame(rafId) }
    },
    [cancelSidebarAnimation, groupRef]
  )

  /** 展开侧栏：从 0 宽弹回上次宽度（未隐藏过则为 260px 换算值） */
  const showSidebar = useCallback(() => {
    if (sidebarVisibleRef.current) return
    sidebarVisibleRef.current = true
    setSidebarVisible(true)
    setSidebarAnimating(true)
    const target =
      lastSidebarSizeRef.current ?? (260 / window.innerWidth) * 100
    animateSidebarTo(target, OPEN_SPRING, () => setSidebarAnimating(false))
  }, [animateSidebarTo])

  /** 隐藏侧栏：记下当前宽度后弹到 0 宽（面板保持挂载，minSize 放开为 0） */
  const hideSidebar = useCallback(() => {
    if (!sidebarVisibleRef.current) return
    sidebarVisibleRef.current = false
    setSidebarVisible(false)
    const current = groupRef.current?.getLayout().sidebar
    if (current != null && current > 0) lastSidebarSizeRef.current = current
    setSidebarAnimating(true)
    animateSidebarTo(0, CLOSE_SPRING, () => setSidebarAnimating(false))
  }, [animateSidebarTo, groupRef])

  /** 逐帧把 content 宽度弹到 target（布局百分比）：sidebar 不动，chat 吸收全部变化量 */
  const animateContentTo = useCallback(
    (target: number, spring: { duration: number; zeta: number }, onDone: () => void) => {
      cancelAnimation()
      const group = groupRef.current
      const layout = group?.getLayout() ?? {}
      if (!group || layout.sidebar == null || layout.chat == null || layout.content == null) {
        onDone()
        return
      }
      const { sidebar, chat: chatFrom, content: contentFrom } = layout
      // 窄窗下展开目标会把 chat 压到 minSize 以下，触发库的约束重分配（缺口从 sidebar
      // 开始扣，sidebar 被压缩）。收紧 content 目标宽度，保证 chat 始终 ≥ minSize。
      // group 满宽布局，其像素宽度即 window.innerWidth。
      const chatMinPct = (CHAT_MIN_PX / window.innerWidth) * 100
      const clampedTarget = Math.min(target, Math.max(chatFrom + contentFrom - chatMinPct, 0))
      const chatTo = chatFrom + (contentFrom - clampedTarget)
      const startedAt = performance.now()
      let rafId = 0
      const frame = (now: number) => {
        const t = Math.min((now - startedAt) / spring.duration, 1)
        const e = springEase(t, spring.zeta)
        group.setLayout({
          sidebar,
          chat: chatFrom + (chatTo - chatFrom) * e,
          content: Math.max(contentFrom + (clampedTarget - contentFrom) * e, 0),
        })
        if (t < 1) {
          rafId = requestAnimationFrame(frame)
        } else {
          // 精确落位（弹簧末帧仍带 ~1% 残差）
          group.setLayout({ sidebar, chat: chatTo, content: clampedTarget })
          animRef.current = null
          onDone()
        }
      }
      rafId = requestAnimationFrame(frame)
      animRef.current = { cancel: () => cancelAnimationFrame(rafId) }
    },
    [cancelAnimation, groupRef]
  )

  /**
   * content 卸载后面板集合变回两栏，库会恢复 "sidebar,chat" 组合记住的旧布局
   * （sidebar 跳回旧值）。等卸载生效（getLayout 里 content 键消失）后钉回实时宽度。
   */
  const repinAfterUnmount = useCallback(
    (sidebar: number) => {
      let attempts = 0
      let rafId = 0
      const repin = () => {
        const group = groupRef.current
        const layout = group?.getLayout() ?? {}
        if (group && layout.sidebar != null && layout.chat != null && layout.content == null) {
          animRef.current = null
          group.setLayout({ sidebar, chat: 100 - sidebar })
          return
        }
        if (++attempts < 20) {
          rafId = requestAnimationFrame(repin)
        } else {
          animRef.current = null
        }
      }
      rafId = requestAnimationFrame(repin)
      animRef.current = { cancel: () => cancelAnimationFrame(rafId) }
    },
    [groupRef]
  )

  /** 逐帧把 chat 宽度弹到 target（布局百分比）：sidebar 不动，content 吸收全部变化量 */
  const animateChatTo = useCallback(
    (target: number, spring: { duration: number; zeta: number }, onDone: () => void) => {
      cancelAnimation()
      const group = groupRef.current
      const layout = group?.getLayout() ?? {}
      if (!group || layout.sidebar == null || layout.chat == null || layout.content == null) {
        onDone()
        return
      }
      const { sidebar, chat: chatFrom, content: contentFrom } = layout
      const clampedTarget = Math.max(target, 0)
      const contentTo = contentFrom + (chatFrom - clampedTarget)
      const startedAt = performance.now()
      let rafId = 0
      const frame = (now: number) => {
        const t = Math.min((now - startedAt) / spring.duration, 1)
        const e = springEase(t, spring.zeta)
        group.setLayout({
          sidebar,
          chat: Math.max(chatFrom + (clampedTarget - chatFrom) * e, 0),
          content: contentFrom + (contentTo - contentFrom) * e,
        })
        if (t < 1) {
          rafId = requestAnimationFrame(frame)
        } else {
          // 精确落位（弹簧末帧仍带 ~1% 残差）
          group.setLayout({ sidebar, chat: clampedTarget, content: contentTo })
          animRef.current = null
          onDone()
        }
      }
      rafId = requestAnimationFrame(frame)
      animRef.current = { cancel: () => cancelAnimationFrame(rafId) }
    },
    [cancelAnimation, groupRef]
  )

  /** 进入全屏：隐藏 AI 对话面板（chat 弹到 0 宽，content 吃满剩余空间） */
  const enterContentFullscreen = useCallback(() => {
    if (!chatVisibleRef.current || !mountedRef.current) return // 内容区未挂载时无全屏可言
    chatVisibleRef.current = false
    setChatVisible(false)
    const current = groupRef.current?.getLayout().chat
    if (current != null && current > 0) lastChatSizeRef.current = current
    setChatAnimating(true)
    animateChatTo(0, CLOSE_SPRING, () => setChatAnimating(false))
  }, [animateChatTo, groupRef])

  /** 退出全屏：chat 弹回隐藏前宽度（未隐藏过则为 560px 换算值），content 相应让位 */
  const exitContentFullscreen = useCallback(() => {
    if (chatVisibleRef.current) return
    chatVisibleRef.current = true
    setChatVisible(true)
    setChatAnimating(true)
    const target = lastChatSizeRef.current ?? (560 / window.innerWidth) * 100
    animateChatTo(target, OPEN_SPRING, () => setChatAnimating(false))
  }, [animateChatTo])

  useEffect(() => useChatStore.subscribe((state, previous) => {
    if (state.chatFocusNonce !== previous.chatFocusNonce) exitContentFullscreen()
  }), [exitContentFullscreen])

  /** 内容区 Tabs 栏右侧的全屏切换按钮 */
  const toggleContentFullscreen = useCallback(() => {
    if (chatVisibleRef.current) enterContentFullscreen()
    else exitContentFullscreen()
  }, [enterContentFullscreen, exitContentFullscreen])

  /** 展开内容区：挂载并钉在 0 宽，等 Panel 注册进布局后滑入到目标宽度 */
  const showContent = useCallback(() => {
    if (visibleRef.current) return // 已展开或正在展开
    visibleRef.current = true
    setContentVisible(true)
    setAnimating(true)

    const finishOpen = () => {
      animTargetRef.current = null
      setAnimating(false)
    }

    if (mountedRef.current) {
      // 收起动画途中重新展开：从当前宽度直接弹回上次尺寸
      const target = lastContentSizeRef.current ?? 50
      animTargetRef.current = target
      animateContentTo(target, OPEN_SPRING, finishOpen)
      return
    }

    // 首次挂载：content Panel 在渲染提交后才注册进布局，逐帧等它就位
    mountedRef.current = true
    // 面板集合变化会让库恢复该组合记住的旧布局（sidebar 跳回旧值），先存下实时宽度
    preservedSidebarRef.current = groupRef.current?.getLayout().sidebar ?? null
    setContentMounted(true)
    let attempts = 0
    let rafId = 0
    const startWhenReady = () => {
      const group = groupRef.current
      const layout = group?.getLayout() ?? {}
      if (group && layout.sidebar != null && layout.content != null) {
        // 钉回挂载前捕获的 sidebar 实时宽度，纠正库恢复的旧布局
        const sidebar = preservedSidebarRef.current ?? layout.sidebar
        preservedSidebarRef.current = null
        // 首次展开均分侧栏之外的宽度；之后恢复上次尺寸
        const target = lastContentSizeRef.current ?? (100 - sidebar) / 2
        // 先钉在 0 宽（chat 吃满），避免挂载瞬间按自动布局闪一下再开始滑入
        group.setLayout({ sidebar, chat: 100 - sidebar, content: 0 })
        animTargetRef.current = target
        animateContentTo(target, OPEN_SPRING, finishOpen)
        return
      }
      if (++attempts < 20) {
        rafId = requestAnimationFrame(startWhenReady)
      } else {
        setAnimating(false) // 等不到注册就放弃动画，交给 minSize 约束兜底
      }
    }
    rafId = requestAnimationFrame(startWhenReady)
    animRef.current = { cancel: () => cancelAnimationFrame(rafId) }
  }, [animateContentTo, groupRef])

  /** 收起内容区：滑出到 0 宽后再卸载 Panel */
  const hideContent = useCallback(() => {
    if (!visibleRef.current) return // 已收起或正在收起
    visibleRef.current = false
    setContentVisible(false)
    if (!mountedRef.current) return

    // 记住当前尺寸供下次展开恢复；展开动画途中收起则记动画的目标值
    const layout = groupRef.current?.getLayout() ?? {}
    if (animTargetRef.current != null) lastContentSizeRef.current = animTargetRef.current
    else if (layout.content != null) lastContentSizeRef.current = layout.content
    animTargetRef.current = null
    // 收起全程 sidebar 不动，卸载后用它钉回库恢复的旧布局
    const endSidebar = layout.sidebar

    setAnimating(true)
    animateContentTo(0, CLOSE_SPRING, () => {
      mountedRef.current = false
      setContentMounted(false)
      setAnimating(false)
      /* 全屏状态下关闭整个内容区：chat 已在收起动画中吸收全部空间，全屏态随之复位 */
      chatVisibleRef.current = true
      setChatVisible(true)
      lastChatSizeRef.current = null
      if (endSidebar != null) repinAfterUnmount(endSidebar)
    })
  }, [animateContentTo, repinAfterUnmount, groupRef])

  /** 显示/隐藏内容面板（按钮在内容区 tab 条右侧、全屏切换按钮旁） */
  const toggleContent = useCallback(() => {
    if (visibleRef.current) hideContent()
    else showContent()
  }, [hideContent, showContent])
  useEffect(()=>{
    if(!window.desktop)return
    const release=registerWorkspaceLayoutAdapter({
      read:()=>{
        const measured=groupRef.current?.getLayout()
        // Group clears its imperative ref before the parent's passive cleanup.
        // Keep the last complete measurement instead of replacing it with {}.
        if(measured?.sidebar!==undefined&&measured.chat!==undefined)lastMeasuredSizes.current=measured
        return pendingLayout.current??settledWorkspaceLayout({version:1,narrowPane:narrowPaneRef.current,contentVisible:visibleRef.current,sidebarVisible:sidebarVisibleRef.current,chatVisible:chatVisibleRef.current,sizes:lastMeasuredSizes.current,lastContentSize:lastContentSizeRef.current,lastSidebarSize:lastSidebarSizeRef.current,lastChatSize:lastChatSizeRef.current})
      },
      subscribe:listener=>{layoutListeners.current.add(listener);return()=>{layoutListeners.current.delete(listener)}},
      apply:input=>{
        const layout=settledWorkspaceLayout(input);pendingLayout.current=layout
        cancelAnimation();cancelSidebarAnimation()
        if(restoredFrame.current!==null)cancelAnimationFrame(restoredFrame.current)
        visibleRef.current=layout.contentVisible;mountedRef.current=layout.contentVisible;sidebarVisibleRef.current=layout.sidebarVisible;chatVisibleRef.current=layout.chatVisible
        lastContentSizeRef.current=layout.lastContentSize;lastSidebarSizeRef.current=layout.lastSidebarSize;lastChatSizeRef.current=layout.lastChatSize
        setContentVisible(layout.contentVisible);setContentMounted(layout.contentVisible);setSidebarVisible(layout.sidebarVisible);setChatVisible(layout.chatVisible);setNarrowPane(layout.narrowPane)
        setAnimating(false);setSidebarAnimating(false);setChatAnimating(false)
        let attempts=0
        const apply=()=>{
          const group=groupRef.current,current=group?.getLayout()
          if(group&&current?.sidebar!==undefined&&current.chat!==undefined&&(!layout.contentVisible||current.content!==undefined)){
            if(Object.keys(layout.sizes).length)group.setLayout(layout.sizes)
            pendingLayout.current=null;restoredFrame.current=null;announceLayout()
          }else if(++attempts<20)restoredFrame.current=requestAnimationFrame(apply)
          else{pendingLayout.current=null;restoredFrame.current=null;announceLayout()}
        }
        restoredFrame.current=requestAnimationFrame(apply)
      },
    })
    return()=>{release();if(restoredFrame.current!==null)cancelAnimationFrame(restoredFrame.current);pendingLayout.current=null}
  },[groupRef,cancelAnimation,cancelSidebarAnimation,announceLayout])
  useEffect(()=>{announceLayout()},[narrowPane,contentVisible,sidebarVisible,chatVisible,announceLayout])
  useDesktopCommands({
    "view.sidebar":()=>{if(sidebarVisibleRef.current)hideSidebar();else showSidebar()},
    "view.content":toggleContent,
  })

  useEffect(() => {
    return useTabsStore.subscribe((s, prev) => {
      // activeTabId 变化（打开/切换 tab）→ 展开内容区；activationNonce 变化 =
      // 重复点击已激活 tab（内容区隐藏时按钮随面板一起卸载，只能经侧栏树恢复）→ 重新展开
      if (
        s.activeTabId &&
        (s.activeTabId !== prev.activeTabId || s.activationNonce !== prev.activationNonce)
      )
        showContent()
      // 关闭最后一个 tab 时隐藏整个内容区
      else if (s.tabs.length === 0 && prev.tabs.length > 0) hideContent()
    })
  }, [showContent, hideContent])

  // 卸载时停掉进行中的动画
  useEffect(
    () => () => {
      cancelAnimation()
      cancelSidebarAnimation()
    },
    [cancelAnimation, cancelSidebarAnimation]
  )

  return (
    <CommentDraftAccount userId={user.id}>
    <div className="dashboard-shell flex h-dvh flex-col overflow-hidden" data-narrow-pane={narrowPane}>
      <nav aria-label="创作工作区" className="hidden shrink-0 gap-1 border-b border-border bg-background px-2 py-1 max-[899px]:flex">
        <Button size="sm" variant="ghost" aria-pressed={narrowPane === "sidebar"} onClick={() => setNarrowPane("sidebar")}>作品目录</Button>
        <Button size="sm" variant="ghost" aria-pressed={narrowPane === "chat"} onClick={() => setNarrowPane("chat")}>返回对话</Button>
        <Button size="sm" variant="ghost" aria-pressed={narrowPane === "content"} disabled={!contentMounted} onClick={() => { showContent(); setNarrowPane("content") }}>查看内容</Button>
      </nav>
      <Group orientation="horizontal" className="workspace-group min-h-0 flex-1" groupRef={groupRef} defaultLayout={initialLayout&&Object.keys(initialLayout.sizes).length?initialLayout.sizes:undefined} onLayoutChanged={announceLayout}>
        <Panel
          id="sidebar"
          defaultSize={260}
          minSize={sidebarVisible && !sidebarAnimating ? 200 : 0}
          maxSize={420}
          groupResizeBehavior="preserve-pixel-size"
          className="workspace-sidebar h-full"
        >
          <SidebarTree user={user} onToggleSidebar={() => { if (window.innerWidth < 900) setNarrowPane("chat"); else hideSidebar() }} />
        </Panel>
        {sidebarVisible && chatVisible && <ResizeHandle />}
        <Panel
          id="chat"
          defaultSize={560}
          minSize={chatVisible && !chatAnimating ? CHAT_MIN_PX : 0}
          groupResizeBehavior="preserve-pixel-size"
          className="workspace-chat h-full"
        >
          <ChatPanel
            key={user.id}
            userId={user.id}
            contentHidden={!contentVisible}
            onShowContent={() => { showContent(); setNarrowPane("content") }}
            sidebarHidden={!sidebarVisible}
            onShowSidebar={() => { showSidebar(); setNarrowPane("sidebar") }}
          />
        </Panel>
        {contentMounted && (
          <>
            {chatVisible && <ResizeHandle withLine />}
            <Panel
              id="content"
              defaultSize={0}
              minSize={animating || chatAnimating ? 0 : "30%"}
              className="workspace-content h-full"
            >
              <ContentTabs
                fullscreen={!chatVisible}
                onToggleFullscreen={toggleContentFullscreen}
                onToggleContent={toggleContent}
              />
            </Panel>
          </>
        )}
      </Group>
    </div>
    </CommentDraftAccount>
  )
}
