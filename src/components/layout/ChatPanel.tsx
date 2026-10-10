"use client"
import { useNovelList, appendCreatedNovel, type NovelList } from "@/lib/novel-list"
import { useSceneUiStore } from "@/stores/scene-ui"
import { parseSceneIdentity } from "@/lib/scene-context"
import { splitMentionToken } from "@/lib/mention-token"
import { positionForCreation } from "@/lib/creation-wizard/position"
import { useDesktopCommands } from "@/lib/desktop/use-command-target"
import { useDesktopStore,updateDesktopSettings } from "@/stores/desktop"
import { ComposerHistory } from "@/lib/desktop/composer-history"
import {composerBindingHint,composerSendPreset,setComposerSendPreset} from "@/lib/desktop/composer-shortcuts"
import {desktopCommandCatalog} from "@/lib/desktop/command-runtime"
import {consumeDesktopComposerPaste} from "@/lib/desktop/native-text-edits"

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  AtSign,
  BookOpen,
  BookX,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ClipboardList,
  Cog,
  Copy,
  Feather,
  Globe,
  Hash,
  ImageIcon,
  Keyboard,
  ListTodo,
  ListTree,
  MessageSquare,
  PanelLeft,
  PanelRight,
  Paperclip,
  Plus,
  Search,
  Shield,
  Slash,
  Square,
  UserPlus,
  Wifi,
  Wrench,
  type LucideIcon,
} from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { formatDuration } from "@/lib/duration"
import { renderMarkdownBlocks } from "@/lib/markdown"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { StorySelection } from "@/lib/story-task"
import type { ChatAction } from "@/lib/chat-parts"
import { drawResultOf } from "@/lib/draw-redraw"
import { fallbackTitle } from "@/lib/creation-wizard/fallback-title"
import { useChatStore } from "@/stores/chat"
import { useTabsStore } from "@/stores/tabs"
import { AskUserPanel, MARKERS } from "@/components/chat/AskUserPanel"
import { CandidateActionPanel } from "@/components/chat/CandidateActionPanel"
import { useCardSelection } from "@/components/chat/use-card-selection"
import { ChangesCard } from "@/components/chat/ChangesCard"
import { FileCards } from "@/components/chat/FileCard"
import {
  entityRefFromElement,
  escapeHtml,
  linkifyHtml,
  openEntityRef,
} from "@/components/chat/entity-refs"
import { Collapse } from "@/components/chat/Collapse"
import { InternalFailuresFold, WorkLogRows, isFoldableInternalFailure } from "@/components/chat/GroupedToolRows"
import { SubAgentRow, isSubAgentTool } from "@/components/chat/SubAgentRow"
import { deriveChatProgress, ProgressPanel } from "@/components/chat/ProgressPanel"
import { ActivePlanBar, SopPlanCard, useSopPlans } from "@/components/chat/SopPlanCard"
import { StoryWorkflowBar } from "@/components/content/StoryWorkflowPanel"
import { ReviewCards } from "@/components/chat/ReviewCard"
import { ManuscriptCards } from "@/components/chat/ManuscriptCard"
import { CandidateDrawCards } from "@/components/chat/CandidateDrawCard"
import { NarrativeCheckCards } from "@/components/chat/NarrativeCheckCard"
import { ImageCards } from "@/components/chat/ImageCard"
import { EntityHoverCard } from "@/components/chat/EntityHoverCard"
import { QueueRows } from "@/components/chat/QueueRow"
import { SearchPalette } from "@/components/chat/SearchPalette"
import { TurnProgressCard, type TurnProgressDraft } from "@/components/chat/TurnProgressCard"
import { useAgentChat } from "@/components/chat/use-agent-chat"
import { isInternalToolCall, foldInternalFailureRuns, visibleToolCalls, toolLabel, TOOL_ICONS, type ChatMessageView, type QuestionMarkerStyle, type ThinkingView } from "@/components/chat/types"
import {
  useNovelEntityIndex,
  type EntityIndex,
} from "@/components/chat/use-entity-index"
import {
  useMentionCandidates,
  type MentionItem,
} from "@/components/chat/use-mention-candidates"
import {
  MentionPopup,
  MentionItemVisual,
  MENTION_GROUP_ICONS,
} from "@/components/chat/MentionPopup"
import { ModelPicker } from "@/components/chat/ModelPicker"
import { classifyWireError, type ErrorUserAction } from "@/lib/ai/error-classification"
import { CHAT_FOCUS_COMPOSER_EVENT, CHAT_OPEN_MODEL_PICKER_EVENT, CHAT_SEND_MESSAGE_EVENT, dispatchChatUiEvent } from "@/components/chat/ui-events"
import {
  editorToText,
  selectedEditorText,
  getCaretTextOffset,
  getDropTextOffset,
  insertMentionChip,
  insertDraftAtCaret,
  deleteDraftSelection,
  insertTextAtCaret,
  renderDraftIntoEditor,
  type ChipData,
} from "@/components/chat/composer-editor"
import { hasChipDrag, readChipDrag } from "@/components/chat/chip-drag"
import { StagedChips, StagedHistoryChips } from "@/components/chat/StagedChips"
import { ComposerChipHoverCard } from "@/components/chat/ComposerChipHoverCard"
import { useStagedChangesStore } from "@/stores/staged-changes"
import { useStoryActivityStore } from "@/stores/story-activity"
import { stagedMessageSummary } from "@/lib/staged-save"

interface ConversationSummary {
  id: string
  title: string
  novelId: string | null
  updatedAt: string
}

interface NovelSummaryItem {
  id: string
  title: string
}

/** 空会话引导页的模板提示词卡片：点击填入草稿，作者确认后再发送（生成要耗墨滴，不抢跑） */
const TEMPLATE_CARDS: { icon: LucideIcon; title: string; desc: string; prompt: string }[] = [
  {
    icon: UserPlus,
    title: "创建一个角色",
    desc: "外貌、性格、背景与目标",
    prompt: "帮我创建一个新角色",
  },
  {
    icon: Feather,
    title: "写一段剧情",
    desc: "来一段仙侠风的精彩片段",
    prompt: "帮我写一段仙侠风格的精彩剧情",
  },
  {
    icon: Globe,
    title: "搭建世界观",
    desc: "玄幻类的世界观设定",
    prompt: "帮我搭建一套玄幻风格的世界观设定",
  },
  {
    icon: ListTree,
    title: "规划大纲",
    desc: "卷章结构与情节走向",
    prompt: "帮我规划小说的章节大纲",
  },
]

async function fetchConversations(): Promise<ConversationSummary[]> {
  const res = await fetch("/api/chat/conversations")
  if (!res.ok) throw new Error("加载会话列表失败")
  const data = (await res.json()) as { conversations: ConversationSummary[] }
  return data.conversations
}

/**
 * 展开/收起保持触发点视口锚点（§5.3：展开块在视口内时不跳滚）。
 * toggle 前记录元素视口位置，随后 240ms（覆盖 200ms 折叠过渡）逐帧按位移差
 * 补偿最近滚动祖先的 scrollTop，让触发元素在动画全程保持视口位置不动。
 */
function usePreserveAnchor() {
  const anchorRef = useRef<{ el: HTMLElement; top: number } | null>(null)
  useLayoutEffect(() => {
    const anchor = anchorRef.current
    if (!anchor) return
    anchorRef.current = null
    let scroller = anchor.el.parentElement
    while (scroller && scroller.scrollHeight - scroller.clientHeight < 1) {
      scroller = scroller.parentElement
    }
    if (!scroller) return
    const started = performance.now()
    let lastDelta = 0
    const tick = (now: number) => {
      const delta = anchor.el.getBoundingClientRect().top - anchor.top
      const adjust = delta - lastDelta
      if (Math.abs(adjust) >= 0.5) {
        scroller!.scrollTop += adjust
        lastDelta = delta
      }
      if (now - started < 240) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  return (el: HTMLElement, toggle: () => void) => {
    anchorRef.current = { el, top: el.getBoundingClientRect().top }
    toggle()
  }
}

/**
 * 光标前的 @ 提及片段：@ 与光标之间不含空白/@ 即视为正在输入提及 →
 * 返回 { start: @ 的下标, query: @ 后已输入的过滤词 }，否则 null。
 * （中文行文不习惯在 @ 前加空格，故不要求前置空白；代价是邮箱等场景会误触发，
 * 创作对话场景可接受。）
 */
function getMentionAtCaret(
  text: string,
  caret: number
): { start: number; query: string } | null {
  const before = text.slice(0, caret)
  const at = before.lastIndexOf("@")
  if (at < 0) return null
  const query = before.slice(at + 1)
  if (/[\s@]/.test(query)) return null
  return { start: at, query }
}

/** 用户消息：列内右侧胶囊气泡（实体名同样渲染为可点芯片；先转义再芯片化）。
 *  hover 出幽灵复制钮（§2.3）；渲染高度超 ~8 行（160px）时半折叠 + 渐变遮罩（§2.4，折叠 200ms 过渡） */
function UserMessage({
  mid,
  content,
  entityIndex,
  stagedBatches,
}: {
  mid: string
  content: string
  entityIndex: EntityIndex
  stagedBatches?: ChatMessageView["stagedBatches"]
}) {
  // 三阶段保存：摘要首行（【修改】「X」N 处）由芯片替代渲染，正文只保留用户实际输入
  const displayContent = useMemo(() => {
    if (!stagedBatches?.length) return content
    const summary = stagedMessageSummary(stagedBatches)
    return content.startsWith(summary) ? content.slice(summary.length).replace(/^\n+/, "") : content
  }, [content, stagedBatches])
  const html = useMemo(
    () => linkifyHtml(escapeHtml(displayContent), entityIndex, { explicitOnly: true }),
    [displayContent, entityIndex]
  )
  const preserveAnchor = usePreserveAnchor()
  const innerRef = useRef<HTMLDivElement>(null)
  const [foldable, setFoldable] = useState(false)
  const [folded, setFolded] = useState(true)
  /** 内容自然高度（量内层无约束容器，展开/折叠切换时 max-height 两端都是确定值才能过渡） */
  const [fullHeight, setFullHeight] = useState<number | null>(null)

  // 渲染高度量测：超过阈值才出现「展开」入口（ResizeObserver 回调异步，不触发渲染期 setState）
  useEffect(() => {
    const el = innerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setFoldable(el.scrollHeight > 170)
      setFullHeight(el.scrollHeight)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const collapsed = foldable && folded
  return (
    <div
      data-mid={mid}
      className="chat-msg-enter group relative w-fit max-w-[min(78%,640px)] self-end rounded-bubble border border-(--chat-line) bg-chat-surface px-3.5 py-2 text-[13px] leading-[1.65] shadow-1 dark:border-[rgba(255,248,240,0.07)] dark:bg-accent"
    >
      <CopyButton
        text={displayContent}
        title="复制消息"
        className="absolute -top-2 right-2 z-10 opacity-0 transition-opacity group-hover:opacity-100"
      />
      {stagedBatches?.length ? <div className="mb-1.5"><StagedHistoryChips batches={stagedBatches} /></div> : null}
      {displayContent && (
      <div
        className={cn(
          "transition-[max-height] duration-200 ease-in-out motion-reduce:transition-none",
          foldable && "overflow-hidden"
        )}
        style={foldable ? { maxHeight: collapsed ? 160 : (fullHeight ?? "none") } : undefined}
      >
        <div
          ref={innerRef}
          className="whitespace-pre-wrap"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
      )}
      {collapsed && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[26px] rounded-b-bubble bg-gradient-to-b from-transparent to-(--chat-surface) dark:to-(--accent)" />
      )}
      {foldable && (
        <button
          type="button"
          onClick={(e) => preserveAnchor(e.currentTarget, () => setFolded((v) => !v))}
          className="relative mt-1 flex items-center gap-0.5 text-[11.5px] text-muted-foreground transition-colors hover:text-foreground"
        >
          {collapsed ? (
            <>
              展开 <ChevronDown className="size-3" />
            </>
          ) : (
            <>
              收起 <ChevronUp className="size-3" />
            </>
          )}
        </button>
      )}
    </div>
  )
}

/** 助手消息正文：Markdown 渲染（表格 / 代码高亮 / 标题 / 加粗等）+ 实体芯片，排版复用 globals.css 的 .markdown-body */
function AssistantMarkdown({
  content,
  entityIndex,
  caret,
}: {
  content: string
  entityIndex: EntityIndex
  /** 流式中在最后一个文本节点后附行内 blink 光标（§3.6，不独立成行） */
  caret?: boolean
}) {
  const blocks = useMemo(() => renderMarkdownBlocks(content), [content])
  return <div className="markdown-body chat-message min-w-0 max-w-full">{blocks.map((html, i) => <AssistantBlock key={i} html={html} entityIndex={entityIndex} caret={caret && i === blocks.length - 1} />)}</div>
}
const AssistantBlock = memo(function AssistantBlock({ html, entityIndex, caret }: { html: string; entityIndex: EntityIndex; caret?: boolean }) {
  const rendered = useMemo(() => {
    const linked = linkifyHtml(html, entityIndex)
    if (!caret) return linked
    const tail = /<\/(p|li|h1|h2|h3|h4|blockquote)>\s*$/
    return tail.test(linked) ? linked.replace(tail, `<span class="chat-caret">▍</span>$&`) : `${linked}<span class="chat-caret">▍</span>`
  }, [html, entityIndex, caret])
  return <div dangerouslySetInnerHTML={{ __html: rendered }} />
})

/** 本轮写工具的量化成果（§4.1「字数即增量」）：累计正文写工具返回的 wordCount，无字段不回填假数字 */
function workedQuantity(message: ChatMessageView): string | null {
  let words = 0
  for (const c of message.toolCalls) {
    if (c.status !== "done" || (c.output as { committed?: boolean } | null)?.committed === false) continue
    if (c.toolName !== "generateChapterContent" && c.toolName !== "writeChapterContent") continue
    const wc = (c.output as { wordCount?: unknown } | null | undefined)?.wordCount
    if (typeof wc === "number" && Number.isFinite(wc)) words += wc
  }
  return words > 0 ? `写入 ${words.toLocaleString()} 字` : null
}

/** 行内复制小钮：点击复制后图标变 Check 1.2s（sonner 免打扰） */
function CopyButton({
  text,
  title,
  className,
}: {
  text: string
  title: string
  className?: string
}) {
  const [ok, setOk] = useState(false)
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={async (e) => {
        e.stopPropagation()
        await navigator.clipboard.writeText(text)
        setOk(true)
        setTimeout(() => setOk(false), 1200)
      }}
      className={cn(
        "flex size-[22px] items-center justify-center rounded-md border border-(--chat-line) bg-popover text-muted-foreground transition-colors hover:text-foreground",
        className
      )}
    >
      {ok ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
    </button>
  )
}

/** 锚点行计时显示的阈值：少于此秒数只显示「正在…」，超过后才实时跳秒（避免无意义闪烁）。思考/工作行共用 */
const PENDING_TIMER_THRESHOLD_SEC = 3

/**
 * 思考行（§7.2）：锚点行样式（mono 12px + chevron，无图标槽），全程默认折叠；
 * 进行中 shimmer「正在思考 · N 秒」，正文开始自动定格「已思考 · N 秒」，
 * 点击展开限高滚动区，流式时实时滚动更新（吸底跟随）。
 * open/onToggle 可选受控：流式轮由 ChatPanel 统一持有（与首字节占位联动），历史轮用内部态。
 */
function ThinkingRow({
  thinking,
  open,
  onToggle,
}: {
  thinking: ThinkingView
  open?: boolean
  onToggle?: () => void
}) {
  const [internalOpen, setInternalOpen] = useState(false)
  const isOpen = open ?? internalOpen
  const toggle = onToggle ?? (() => setInternalOpen((v) => !v))
  const [elapsed, setElapsed] = useState(0)
  const bodyRef = useRef<HTMLDivElement>(null)
  const active = thinking.active
  /** 吸底跟随开关：用户上滚暂停跟随（§7.2），滚回底部（40px 阈值）恢复 */
  const [stickBottom, setStickBottom] = useState(true)

  // 进行中秒级计时
  useEffect(() => {
    if (!active) return
    const started = thinking.startedAt ?? Date.now()
    const t = setInterval(
      () => setElapsed(Math.floor((Date.now() - started) / 1000)),
      1000
    )
    return () => clearInterval(t)
  }, [active, thinking.startedAt])

  // 展开且仍在流出时吸底跟随（实时滚动更新；用户上滚后不抢滚动条）
  useEffect(() => {
    if (isOpen && active && stickBottom) {
      bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight })
    }
  }, [thinking.text, isOpen, active, stickBottom])

  const label = active
    ? `正在思考${elapsed >= PENDING_TIMER_THRESHOLD_SEC ? ` ${formatDuration(elapsed)}` : ""}`
    : `已思考${thinking.durationSec != null ? ` ${formatDuration(thinking.durationSec)}` : ""}`

  return (
    <div>
      <button
        type="button"
        onClick={toggle}
        className="group/think flex w-fit items-center gap-1.5 font-mono text-[13.5px] text-muted-foreground select-none transition-colors hover:text-foreground"
      >
        <Brain className="size-3.5 shrink-0" />
        {active ? (
          <span className="text-shimmer tabular-nums">{label}</span>
        ) : (
          <span className="tabular-nums">{label}</span>
        )}
        {/* 展开指示在右侧：折叠时仅悬停本行显示（命名组，避免被消息级 group 的悬停牵连），展开后变向下且常驻 */}
        {isOpen ? (
          <ChevronDown className="size-3.5 shrink-0" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0 opacity-0 transition-opacity group-hover/think:opacity-100" />
        )}
      </button>
      <Collapse open={isOpen} className="mt-0.5 ml-2 border-l border-border/70 pl-4">
        <div
          ref={bodyRef}
          onScroll={(e) => {
            const el = e.currentTarget
            setStickBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 40)
          }}
          className="max-h-[220px] overflow-y-auto text-[13px] leading-[1.7] whitespace-pre-wrap text-muted-foreground/80"
        >
          {thinking.text}
        </div>
      </Collapse>
    </div>
  )
}

/** 首字节等待占位（§7.5 与思考行同一语言）： shimmer「正在思考 · N 秒」，可点击展开——
 *  思维链尚未开始回传时给等待提示，reasoning 流到达后由 ThinkingRow 接管（共享展开态） */
function ThinkingPlaceholder({
  elapsedSeconds,
  open,
  onToggle,
}: {
  elapsedSeconds: number
  open: boolean
  onToggle: () => void
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="group/think flex w-fit items-center gap-1.5 font-mono text-[13.5px] text-muted-foreground select-none transition-colors hover:text-foreground"
      >
        <Brain className="size-3.5 shrink-0" />
        <span className="text-shimmer tabular-nums">
          正在思考
          {elapsedSeconds >= PENDING_TIMER_THRESHOLD_SEC
            ? ` ${formatDuration(elapsedSeconds)}`
            : ""}
        </span>
        {open ? (
          <ChevronDown className="size-3.5 shrink-0" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0 opacity-0 transition-opacity group-hover/think:opacity-100" />
        )}
      </button>
      <Collapse open={open} className="mt-0.5 ml-2 border-l border-border/70 pl-4">
        <div className="text-[13px] leading-[1.7] text-muted-foreground/60">
          等待模型回传思维链，开始推理后在此实时滚动
        </div>
      </Collapse>
    </div>
  )
}

/** askUserQuestion 提问的历史固化形态（§2.7 一次性消费） */
type AskSummary =
  | { kind: "answered"; items: { question: string; marker: string | null; answer: string }[] }
  | { kind: "skipped" }

/**
 * 派生提问的固化摘要（零 schema 变更）：提问工具调用之后若配对了「【回答问题】」用户消息 →
 * 只读答案摘要块；无配对且面板已被取消（Esc）→ 「已跳过的提问」；用户改用大白话回答 → 不渲染。
 */
function deriveAskSummary(
  messages: ChatMessageView[],
  index: number,
  panelOpen: boolean
): AskSummary | null {
  const m = messages[index]
  if (m.role !== "assistant" || m.streaming === true) return null
  if (m.turnId && m.interaction?.kind !== "question") return null
  if (m.turnId && m.interaction?.state === "skipped") return { kind: "skipped" }
  if (m.turnId && m.interaction?.state !== "answered") return null
  const call = m.toolCalls.find((c) => c.toolName === "askUserQuestion")
  if (!call) return null
  const input = (call.input ?? {}) as {
    questions?: { question: string; options?: string[] }[]
    markerStyle?: QuestionMarkerStyle
  }
  const questions = Array.isArray(input.questions) ? input.questions : []
  const nextUser = m.turnId ? messages.find(mm => mm.id === m.interaction?.responseMessageId) : messages.slice(index + 1).find((mm) => mm.role === "user")
  if (nextUser && nextUser.content.startsWith("【回答问题】")) {
    const body = nextUser.content.replace(/^【回答问题】\n?/, "")
    const pairs = [...body.matchAll(/(?:^|\n)(?:\d+\.\s*)?([^\n]+?)\n我的回答：([^\n]*)/g)]
    const markers = MARKERS[input.markerStyle ?? "letters"] ?? MARKERS.letters
    const items = questions
      .map((q, qi) => {
        const pair = pairs.find((p) => p[1] === q.question) ?? pairs[qi]
        const answer = pair?.[2]?.trim() ?? ""
        const optIdx = q.options?.indexOf(answer) ?? -1
        return {
          question: q.question,
          marker: optIdx >= 0 ? (markers[optIdx] ?? null) : null,
          answer,
        }
      })
      .filter((it) => it.answer)
    return items.length > 0 ? { kind: "answered", items } : null
  }
  if (!m.turnId && !nextUser && !panelOpen) return { kind: "skipped" }
  return null
}

/**
 * 网络重试行（锚点行家族）：服务端网络重试时展示「网络重试 N/M」（Wifi 图标 +
 * shimmer），N 随服务端 data-network-retry 实时递增；渲染在消息内容末尾（流卡顿点），
 * 新一轮内容到达自动消失（use-agent-chat 在各内容分支清除 networkRetry）。
 */
function NetworkRetryRow({ retry }: { retry: { attempt: number; maxRetries: number } }) {
  return (
    <div className="flex w-fit items-center gap-1.5 font-mono text-[13.5px] text-muted-foreground select-none">
      <Wifi className="size-3.5 shrink-0" />
      <span className="text-shimmer tabular-nums">
        网络重试 {retry.attempt}/{retry.maxRetries}
      </span>
    </div>
  )
}

/** 错误卡标题：按统一错误分类的 userAction 决定；返回 null 时回退到「已停止/生成中断/生成失败」状态二分 */
const ERROR_CARD_TITLES: Record<ErrorUserAction, (category: string) => string | null> = {
  recharge: () => "墨滴余额不足",
  switch_model: category => category === "model_unavailable" ? "所选模型不可用" : "模型服务额度不可用",
  edit_input: () => "内容未通过审核",
  wait_retry: () => "请求受限",
  retry: category => category === "network" ? "网络异常" : category === "generation_timeout" ? "生成超时" : null,
  feedback: () => "执行异常",
  check_state: () => null,
}

/** 用户主动停止（本地停止/服务端取消/执行中断）不是错误：渲染中性状态，不用报错样式 */
const USER_STOPPED_CODES = new Set(["USER_STOPPED", "USER_CANCELLED", "EXECUTION_INTERRUPTED"])

/** 助手消息：Worked 行（可展开 work-log 工具调用列表）+ Markdown 正文 + 错误块 + 本次改动卡片 */
function AttemptHistory({ historical, children }: { historical: boolean; children: React.ReactNode }) {
  return historical ? <details className="rounded-card border border-border p-3"><summary className="cursor-pointer text-xs text-muted-foreground">历史尝试 · 只读记录</summary><div className="mt-3">{children}</div></details> : children
}

function AssistantMessage({
  message,
  streaming,
  elapsedSeconds,
  workedSeconds,
  entityIndex,
  novelId,
  onResend,
  onRefreshNavigation,
  askSummary,
  thinkingOpen,
  onToggleThinking,
  storyDraft,
  suppressedDrawIds,
}: {
  message: ChatMessageView
  streaming: boolean
  elapsedSeconds: number
  workedSeconds?: number
  entityIndex: EntityIndex
  novelId: string | null
  onResend?: () => void
  /** 导航面板答案提交撞上过期内容（版本冲突/已刷新）：引导重载会话查看最新选项 */
  onRefreshNavigation?: () => void
  askSummary?: AskSummary | null
  /** 思考行展开态（流式轮由 ChatPanel 与首字节占位共享；历史轮不传走内部态） */
  thinkingOpen?: boolean
  onToggleThinking?: () => void
  /** 本回合正在写入的草稿活动（W4 进度卡预览；store 核对会话后由 ChatPanel 传入） */
  storyDraft?: TurnProgressDraft | null
  /** 此前消息已渲染过的抽卡批次（会话级同批去重，转发 CandidateDrawCards） */
  suppressedDrawIds?: ReadonlySet<string>
}) {
  // 折叠默认状态（§5.2/§2.9）：流式展开 → 完成自动收起；用户手动展开/收起后不再被流式行为重置
  // W6：内部摩擦失败不自动展开 work-log（中性折叠行已足够），业务性失败/待确认仍外露
  const [openOverride, setOpenOverride] = useState<boolean | null>(null)
  const visibleCalls = visibleToolCalls(message.toolCalls)
  const logOpen = openOverride ?? (streaming || visibleCalls.some(c => c.status === "unknown" || (c.status === "error" && !isInternalToolCall(c.toolName, c.output))))
  // 子代理工具（评委/读者）从 work-log 分流：渲染为消息级子代理行（§7.3），不进普通工具行与归组
  const subAgentCalls = visibleCalls.filter((c) => isSubAgentTool(c.toolName))
  const logCalls = visibleCalls.filter((c) => !isSubAgentTool(c.toolName))
  const hasTools = logCalls.length > 0
  // 未完成/失败的外露区：内部摩擦失败折为一行中性摘要，业务性失败逐条外露（W6）
  const pendingCalls = logCalls.filter(call => call.status !== "done")
  const exposedCalls = pendingCalls.filter(call => !isFoldableInternalFailure(call))
  const internalCalls = pendingCalls.filter(isFoldableInternalFailure)
  // 有序流内连续内部失败归并（首 partId → run；covered 位置跳过）
  const internalFold = foldInternalFailureRuns(message.parts, logCalls)
  const ordered = message.parts?.some(part => ["text", "tool", "plan"].includes(part.type)) ?? false
  const WorkLine = ordered ? "div" : "button"
  const quantity = workedQuantity(message)
  const preserveAnchor = usePreserveAnchor()
  // 错误卡按统一错误分类的 userAction 渲染标题与行动按钮（分类见 lib/ai/error-classification.ts）
  const errorClassified = message.error ? classifyWireError(message.errorCode, message.error) : null
  const errorTitle = !errorClassified ? null : ERROR_CARD_TITLES[errorClassified.userAction](errorClassified.category)

  return (
    <div data-mid={message.id} className="chat-msg-enter group relative flex flex-col gap-2.5">
      {message.content && !streaming && (
        <CopyButton
          text={message.content}
          title="复制回复"
          className="absolute -top-2 right-0 z-10 opacity-0 transition-opacity group-hover:opacity-100"
        />
      )}
      {/* W4：阶段文案由回合进度卡统一呈现（长任务全程可见），不再单列顶部阶段行 */}
      {/* 完成态锚点行留在回合顶部原位置；进行中（shimmer 正在思考/进度卡）移到回合最下方，跟随最新内容 */}
      {message.thinking && !streaming && (
        <ThinkingRow thinking={message.thinking} open={thinkingOpen} onToggle={onToggleThinking} />
      )}
      {hasTools && !streaming && (
        <WorkLine
          onClick={ordered ? undefined : (e) => preserveAnchor(e.currentTarget, () => setOpenOverride(!logOpen))}
          className="group/work flex w-fit items-center gap-1.5 font-mono text-[13.5px] text-muted-foreground select-none transition-colors hover:text-foreground"
        >
          <Cog className="size-3.5 shrink-0" />
          {workedSeconds != null ? (
            <span className="tabular-nums">
              已工作 {formatDuration(workedSeconds)}
              {quantity && <span className="text-foreground/75"> · {quantity}</span>}
              {message.roundUsage != null && (
                <span className="text-foreground/75">
                  {" "}
                  · 约 {message.roundUsage.toLocaleString()} 墨滴
                </span>
              )}
            </span>
          ) : (
            "已工作"
          )}
          {/* 展开指示在右侧：折叠时仅悬停本行显示（命名组隔离），展开后变向下且常驻 */}
          {!ordered && (logOpen ? (
            <ChevronDown className="size-3.5 shrink-0" />
          ) : (
            <ChevronRight className="size-3.5 shrink-0 opacity-0 transition-opacity group-hover/work:opacity-100" />
          ))}
        </WorkLine>
      )}
      {!ordered && <Collapse open={hasTools && logOpen} className="ml-2 border-l border-border/70 pl-4">
        <div className="flex flex-col gap-1">
          <WorkLogRows calls={logCalls.filter(call => call.status === "done")} />
        </div>
      </Collapse>}
      {!ordered && <WorkLogRows calls={exposedCalls} />}
      {!ordered && internalCalls.length > 0 && <InternalFailuresFold calls={internalCalls} />}
      {/* 子代理实时进度行并入 W4 回合进度卡（流式分支底部），不再单列 */}
      {!ordered && subAgentCalls.map((call) => (
        <SubAgentRow key={call.toolCallId} call={call} index={entityIndex} novelId={novelId} />
      ))}
      {!ordered && message.content && (
        <AssistantMarkdown content={message.content} entityIndex={entityIndex} caret={streaming} />
      )}
      {ordered && message.parts?.map((part, index) => {
        if (part.type === "text") return <AssistantMarkdown key={part.id} content={part.text} entityIndex={entityIndex} caret={streaming && index === message.parts!.length - 1} />
        if (part.type === "tool") {
          const call = visibleCalls.find(c => c.toolCallId === part.toolCallId)
          if (!call) return null
          if (isSubAgentTool(call.toolName)) return <SubAgentRow key={part.id} call={call} index={entityIndex} novelId={novelId} />
          // W6：连续内部失败折为一行中性摘要，run 后续位置被覆盖不重复渲染
          if (internalFold.covered.has(part.id)) return null
          const fold = internalFold.runs.get(part.id)
          if (fold) return <InternalFailuresFold key={part.id} calls={fold} />
          if (call.status === "done") {
            const Icon = TOOL_ICONS[call.toolName] ?? Wrench
            return (
              <details key={part.id} className="group/completed text-muted-foreground">
                <summary className="group/tool flex w-fit cursor-pointer list-none items-center gap-1.5 font-mono text-[13.5px] select-none transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
                  <Icon className="size-3.5 shrink-0" />
                  <span>{toolLabel(call.toolName)} · 已完成</span>
                  <ChevronRight className="size-3.5 shrink-0 opacity-0 transition-opacity group-open/completed:rotate-90 group-open/completed:opacity-100 group-hover/tool:opacity-100" />
                </summary>
                <WorkLogRows calls={[call]} />
              </details>
            )
          }
          return <WorkLogRows key={part.id} calls={[call]} />
        }
        if (part.type === "plan") {
          const items = <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">{part.payload.items.map((item, i) => <li key={i}>{item.label}</li>)}</ol>
          const closed = message.interaction?.state === "approved" || message.interaction?.state === "skipped"
          return closed ? <details key={part.id} className="rounded-card border border-border p-3 text-sm text-muted-foreground"><summary className="cursor-pointer">{message.interaction?.state === "approved" ? "已批准的计划提案" : "已跳过的计划提案"} · {part.payload.title}</summary>{items}</details> : <div key={part.id} className="rounded-card border border-border bg-card p-3"><strong>{part.payload.title}</strong>{items}</div>
        }
        return null
      })}
      {!message.turnId && message.toolCalls.length > 0 && <p className="text-xs text-muted-foreground">历史消息：工具与正文的精确交错未记录。</p>}
      {askSummary?.kind === "answered" && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="shrink-0">已回答</span>
          {askSummary.items.map((it, i) => (
            <span
              key={i}
              title={`${it.question} 〔${it.answer}〕`}
              className="max-w-72 truncate rounded-full border border-(--chat-line) px-2 py-[1px] text-[11.5px]"
            >
              {it.question} 〔{it.marker ? `${it.marker} · ` : ""}
              {it.answer}〕
            </span>
          ))}
        </div>
      )}
      {askSummary?.kind === "skipped" && (
        <div className="text-xs text-muted-foreground italic">已跳过的提问</div>
      )}
      {message.error && errorClassified && USER_STOPPED_CODES.has(message.errorCode ?? "") && (
        <div role="status" className="flex w-full flex-col gap-1.5 rounded-card border border-border bg-muted/40 px-3.5 py-2.5">
          <p className="text-[12.5px] leading-[1.6] text-muted-foreground">
            {message.error}
          </p>
          {message.hasWriteEffects && <p className="text-xs text-muted-foreground">请先在内容面板查看已保存的改动，确认剩余工作后再继续。</p>}
          {message.savedEffects && message.savedEffects.length > 0 && <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">查看已保存改动（{message.savedEffects.length} 条记录）</summary><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap">{JSON.stringify(message.savedEffects, null, 2)}</pre></details>}
          {onResend && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onResend}
                className="rounded-inner border border-input px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-hover-wash hover:text-foreground"
              >
                {message.turnId ? message.canResume ? "核对后继续未完成步骤" : "重试本轮" : "作为新消息重发"}
              </button>
            </div>
          )}
        </div>
      )}
      {message.error && errorClassified && !USER_STOPPED_CODES.has(message.errorCode ?? "") && (
        <div role="status" className="flex w-full flex-col gap-1.5 rounded-card border border-destructive/25 bg-destructive/6 px-3.5 py-2.5">
          <div className="flex items-center gap-1.5 text-[13px] font-semibold text-destructive">
            <AlertCircle className="size-4 shrink-0" />
            {errorTitle ?? (message.status === "interrupted" ? (message.errorCode === "USER_STOPPED" ? "已停止" : "生成中断") : "生成失败")}
          </div>
          <p className="line-clamp-2 text-[12.5px] leading-[1.6] text-foreground/80">
            {message.error}
          </p>
          {message.hasWriteEffects && <p className="text-xs text-muted-foreground">请先在内容面板查看已保存的改动，确认剩余工作后再继续。</p>}
          {message.savedEffects && message.savedEffects.length > 0 && <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">查看已保存改动（{message.savedEffects.length} 条记录）</summary><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap">{JSON.stringify(message.savedEffects, null, 2)}</pre></details>}
          <div className="flex items-center gap-2">
            {onRefreshNavigation && (
              <button
                type="button"
                onClick={onRefreshNavigation}
                className="rounded-inner border border-input bg-primary/10 px-2.5 py-1 text-xs text-primary transition-colors hover:bg-primary/20"
              >
                查看最新选项
              </button>
            )}
            {errorClassified.userAction === "recharge" && (
              <Link
                href="/#pricing"
                className="rounded-inner border border-input px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-hover-wash hover:text-foreground"
              >
                查看套餐
              </Link>
            )}
            {errorClassified.userAction === "switch_model" && (
              <button
                type="button"
                onClick={() => dispatchChatUiEvent(CHAT_OPEN_MODEL_PICKER_EVENT)}
                className="rounded-inner border border-input px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-hover-wash hover:text-foreground"
              >
                切换模型
              </button>
            )}
            {errorClassified.userAction === "edit_input" && (
              <button
                type="button"
                onClick={() => dispatchChatUiEvent(CHAT_FOCUS_COMPOSER_EVENT)}
                className="rounded-inner border border-input px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-hover-wash hover:text-foreground"
              >
                修改输入
              </button>
            )}
            {onResend && errorClassified.userAction !== "recharge" && errorClassified.userAction !== "edit_input" && (
              <button
                type="button"
                onClick={onResend}
                className="rounded-inner border border-input px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-hover-wash hover:text-foreground"
              >
                {message.turnId ? message.canResume ? "核对后继续未完成步骤" : "重试本轮" : "作为新消息重发"}
              </button>
            )}
            <CopyButton text={message.error} title="复制错误详情" />
          </div>
        </div>
      )}
      {novelId && (
        <NarrativeCheckCards toolCalls={message.toolCalls} novelId={novelId} />
      )}
      {novelId && (
        <CandidateDrawCards toolCalls={message.toolCalls} novelId={novelId} suppressedDrawIds={suppressedDrawIds} />
      )}
      {novelId && (
        <FileCards toolCalls={message.toolCalls} index={entityIndex} novelId={novelId} />
      )}
      {novelId && (
        <ManuscriptCards toolCalls={message.toolCalls} index={entityIndex} novelId={novelId} />
      )}
      {novelId && (
        <ReviewCards toolCalls={message.toolCalls} index={entityIndex} novelId={novelId} />
      )}
      {novelId && <ImageCards toolCalls={message.toolCalls} index={entityIndex} novelId={novelId} />}
      {novelId && (
        <ChangesCard toolCalls={message.toolCalls} index={entityIndex} novelId={novelId} />
      )}
      {message.networkRetry && <NetworkRetryRow retry={message.networkRetry} />}
      {/* 进行中的思考/进度卡钉在回合最下方，跟随最新内容；定格后的「已思考/已工作」锚点行留在顶部原位置 */}
      {streaming && message.thinking && (
        <ThinkingRow thinking={message.thinking} open={thinkingOpen} onToggle={onToggleThinking} />
      )}
      {/* 工具条目已在消息流展示，底部只补充整体进度、子任务与草稿。 */}
      {streaming && (
        <TurnProgressCard message={message} elapsedSeconds={elapsedSeconds} draft={storyDraft} showToolLog={false} />
      )}
      {streaming && !message.content && !message.networkRetry && (
        <span className="chat-caret w-fit">▍</span>
      )}
    </div>
  )
}

/**
 * 进程面板水槽（800~1720px 中间带）：滚动区与输入区共用同一右内边距，
 * 保证 960 内容列与 composer 在面板占位时仍严格左右对齐（宽度与位置一致）
 */
const PROGRESS_GUTTER_CLASS =
  "@min-[800px]:@max-[1719px]:pr-[calc(clamp(260px,30%,340px)_+_1.75rem)]"

/** 中栏 AI 对话面板：会话管理 + zcode 风消息流 + 创作参谋输入区 */
export function ChatPanel({
  userId,
  contentHidden = false,
  onShowContent,
  sidebarHidden = false,
  onShowSidebar,
}: {
  userId: string
  /** 右侧内容面板处于隐藏态：在头部最右侧提供「显示内容面板」恢复按钮 */
  contentHidden?: boolean
  /** 恢复显示右侧内容面板（DashboardShell 的 showContent） */
  onShowContent?: () => void
  /** 左侧导航栏处于隐藏态：在头部最左侧提供「显示左侧导航栏」恢复按钮 */
  sidebarHidden?: boolean
  /** 恢复显示左侧导航栏（DashboardShell 的 showSidebar） */
  onShowSidebar?: () => void
}) {
  const queryClient = useQueryClient()
  const tabs = useTabsStore((s) => s.tabs)
  const activeTabId = useTabsStore((s) => s.activeTabId)
  const activeNovelId = tabs.find((t) => t.id === activeTabId)?.novelId ?? null

  const conversationId = useChatStore((s) => s.conversationId)
  const requestedConversationId = useChatStore((s) => s.requestedConversationId)
  const clearRequestedConversation = useChatStore((s) => s.clearRequestedConversation)
  const clearNewConversationRequest = useChatStore((s) => s.clearNewConversationRequest)
  const draft = useChatStore((s) => s.draft)
  const isGenerating = useChatStore((s) => s.isGenerating)
  const recoveryStatus = useChatStore(s => s.recoveryStatus)
  const recoveryNotice = useChatStore(s => s.recoveryNotice)
  const storageNotice = useChatStore(s => s.storageNotice)
  const creatingNovel = useChatStore(s => s.creatingNovel)
  const suspendedExecution = useChatStore(s => s.suspendedExecution)
  const storedNovelId = useChatStore(s => s.draftNovelId)
  const composerCaret = useRef<number | null>(null)
  const canSend = recoveryStatus === "ready" && !creatingNovel
  const setDraft = useChatStore((s) => s.setDraft)
  const mode = useChatStore((s) => s.mode)
  const setMode = useChatStore((s) => s.setMode)
  const enterToSend = useChatStore((s) => s.enterToSend)
  const setEnterToSend = useChatStore((s) => s.setEnterToSend)
  const desktopBootstrap=useDesktopStore(state=>state.bootstrap)
  const sendPreset=desktopBootstrap?composerSendPreset(desktopCommandCatalog(desktopBootstrap.platform),desktopBootstrap.settings.shortcuts[desktopBootstrap.platform]):enterToSend?"enter":"shift"
  const saveSendPreset=async(value:boolean)=>{
    const desktop=useDesktopStore.getState().bootstrap
    if(!desktop){setEnterToSend(value);return}
    try{await updateDesktopSettings(before=>({...before,shortcuts:{...before.shortcuts,[desktop.platform]:setComposerSendPreset(desktopCommandCatalog(desktop.platform),before.shortcuts[desktop.platform],value)}}))}
    catch(error){toast.error(error instanceof Error?error.message:"发送方式保存失败",{action:{label:"快捷键设置",onClick:()=>window.dispatchEvent(new CustomEvent("desktop:settings",{detail:"shortcuts"}))}})}
  }
  const pendingQuestion = useChatStore((s) => s.pendingQuestion)
  const pendingRequest = useChatStore(s => s.pendingRequest)
  const pendingPlan = useChatStore(s => s.pendingPlan)
  /** 创建作品向导对话入口留下的待创建书名（首条消息发送时才真正落库） */
  const pendingNovelTitle = useChatStore((s) => s.pendingNovelTitle)
  const { messages, loadConversation, resetConversation, send, stop, retryTurn, skipQuestion, reconcilePending, cancelFollowing, following, approvePlan, skipPlan, isLoadingConversation, activeNovelId: conversationNovelId, setActiveNovelId: setConversationNovelId } =
    useAgentChat(userId)
  const [inputHistory]=useState(()=>new ComposerHistory())
  useEffect(()=>{
    if(conversationId&&recoveryStatus==="ready"&&!isLoadingConversation)inputHistory.seed(conversationId,messages.filter(message=>message.role==="user").map(message=>message.content))
  },[conversationId,messages,inputHistory,recoveryStatus,isLoadingConversation])

  /** 参谋提问待回答且生成已结束（历史标记/摘要语义；不受选卡覆盖影响） */
  const askPanelPending = pendingQuestion !== null && !isGenerating

  /** 引导页小说选择：undefined=跟随激活 tab，null=不关联（仅闲聊），string=指定小说 */
  const [heroNovelPick, setHeroNovelPick] = useState<string | null | undefined>(undefined)
  const [novelQuery, setNovelQuery] = useState("")
  /** 空会话引导页生效的关联小说（有消息后回退到激活 tab / 会话自身关联） */
  const heroNovelId = storedNovelId ?? (heroNovelPick === undefined ? (conversationNovelId ?? activeNovelId) : heroNovelPick)
  const composerNovelId =
    messages.length === 0 ? heroNovelId : (conversationNovelId ?? activeNovelId)

  // 三阶段保存：当前会话作品的气泡（决定空文本时是否可发送）
  const stagedChipCount = useStagedChangesStore(s => s.chips.filter(c => !composerNovelId || c.novelId === composerNovelId).length)

  // 实体芯片索引：以会话关联的小说为准（历史会话切换小说 tab 后仍能正确解析），fallback 到引导页选择/当前激活 tab
  const entityNovelId = conversationNovelId ?? composerNovelId
  const entityIndex = useNovelEntityIndex(entityNovelId)

  // 选卡操作面板（card-select F1）：点抽卡候选卡后接管 composer 槽位；
  // 选稿问答（带 drawRedraw）待答且选中同章卡时，槽位切换为该卡的选卡操作面板——
  // 问答让位（选中态保留），清除选中后问答恢复（override 按 chapterId 判定：CardSelection 不记 drawId）
  const cardSelection = useCardSelection((s) => s.selection)
  const selectionOverridesAsk =
    cardSelection !== null &&
    cardSelection.conversationId === conversationId &&
    cardSelection.novelId === entityNovelId &&
    messages.length > 0 &&
    pendingQuestion?.drawRedraw?.chapterId === cardSelection.chapterId
  const showAskPanel = askPanelPending && !selectionOverridesAsk
  const showCardPanel =
    (selectionOverridesAsk || !showAskPanel) &&
    cardSelection !== null &&
    cardSelection.conversationId === conversationId &&
    cardSelection.novelId === entityNovelId &&
    messages.length > 0

  // 进程面板（2026-08 zcode 式进程框，取代原内联清单卡）：任务清单取最近一轮推断结果 +
  // 智能体区列最近子代理；浮于消息区右上角——chatpane ≥1720px 时右侧边距天然容纳、不占位
  // （消息保持 960 原宽居中）；800~1720px 滚动区右侧预留等宽水槽（消息按比例让宽不被遮挡、
  // 滚动条位于面板右侧）；<800px 直接覆盖。水槽类名统一走 PROGRESS_GUTTER_CLASS，滚动区与
  // 输入区共用，保证 960 消息列与 composer 始终严格对齐。
  const planQuery = useSopPlans(conversationId, isGenerating)
  const chatProgress = useMemo(
    () => planQuery.isLoading ? null : deriveChatProgress(messages, entityIndex, planQuery.data?.active),
    [messages, entityIndex, planQuery.isLoading, planQuery.data?.active]
  )
  /**
   * 会话级抽卡同批去重（CandidateDrawCards）：按消息数组顺序累计已出现 drawId，
   * 每条消息得到「此前已渲染 drawId 集」——同一 drawId 只在首个出现位置渲染完整组卡，
   * 后续 getChapterCandidates 重现/同参重放折叠为提示行。扫描守卫与组卡分派同源
   * （原始 message.toolCalls；reconcile 重排消息顺序时首现位置随数组移动，属既有行为）。
   */
  const suppressedDrawIdsById = useMemo(() => {
    const seen = new Set<string>()
    const byId = new Map<string, ReadonlySet<string>>()
    for (const m of messages) {
      byId.set(m.id, new Set(seen))
      for (const call of m.toolCalls ?? []) {
        if ((call.toolName === "drawChapterCandidates" || call.toolName === "getChapterCandidates") && call.status === "done") {
          const draw = drawResultOf(call.output)
          if (draw) seen.add(draw.drawId)
        }
      }
    }
    return byId
  }, [messages])
  const [progressOpen, setProgressOpen] = useState(true)
  const [progressDismissedKey, setProgressDismissedKey] = useState<string | null>(null)
  const progressVisible = chatProgress != null && chatProgress.key !== progressDismissedKey
  // SOP 吸顶条显示中时悬浮面板下移让位（与 ActivePlanBar 同一 query，缓存去重无额外请求）
  const planBarActive = planQuery.data?.active != null

  // @ 提及自动补全：候选分组（与实体索引同源缓存）+ 弹窗状态
  const mentionGroups = useMentionCandidates(entityNovelId)
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null)
  const [mentionIndex, setMentionIndex] = useState(0)
  /** Esc 关闭时记住片段位置：同一片段继续输入（query 变化）前不因 keyup/click 重开弹窗 */
  const mentionDismissedRef = useRef<{ start: number; query: string } | null>(null)

  /** 按 @ 后已输入字符过滤候选（分组内无命中则整组隐藏） */
  const filteredMentionGroups = useMemo(() => {
    if (!mention) return []
    const q = mention.query.toLowerCase()
    return mentionGroups
      .map((g) => ({
        ...g,
        items: g.items.filter(
          (it) =>
            it.name.toLowerCase().includes(q) ||
            it.insertText.toLowerCase().includes(q) ||
            (it.kind === "scene" && it.detail?.replace(/\s+/g, "").toLowerCase().includes(q.replace(/\s+/g, "")))
        ),
      }))
      .filter((g) => g.items.length > 0)
  }, [mention, mentionGroups])
  /** 跨组扁平化的候选列表（键盘导航的下标空间） */
  const flatMentionItems = useMemo(
    () => filteredMentionGroups.flatMap((g) => g.items),
    [filteredMentionGroups]
  )

  /** 消息区点击委托：命中 .entity-ref 芯片时打开对应右侧面板 */
  const handleMessageAreaClick = (e: React.MouseEvent) => {
    const chip = (e.target as HTMLElement).closest(".entity-ref")
    if (!(chip instanceof HTMLElement)) return
    const ref = entityRefFromElement(chip)
    if (ref && entityNovelId) openEntityRef(ref, entityNovelId)
  }

  const { data: conversations } = useQuery({
    queryKey: ["chat-conversations"],
    queryFn: fetchConversations,
  })
  const { data: novelList } = useNovelList<NovelSummaryItem>()
  const novels = novelList?.novels
  const heroNovel = novels?.find((n) => n.id === heroNovelId)
  /** 引导页小说下拉的搜索过滤 */
  const filteredHeroNovels = (novels ?? []).filter((n) =>
    n.title.toLowerCase().includes(novelQuery.trim().toLowerCase())
  )

  // 滚动：用户位于底部附近时新消息保持吸底，远离底部时显示「回到底部」悬浮钮
  const scrollRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const nearBottomRef = useRef(true)
  const [showScrollBottom, setShowScrollBottom] = useState(false)
  /** 离开底部期间有新内容流入 → 回到底部钮带 primary 未读点 */
  const [hasUnread, setHasUnread] = useState(false)

  // 生成计时：流式期间每秒刷新，结束时把总时长记到最后一条含工具调用的助手消息
  const [clock, setClock] = useState({ startedAt: 0, seconds: 0 })
  /** 思考行展开态：首字节占位与流式思考行共享（占位点开展开后，思维链到达时保持展开） */
  const [thinkingOpen, setThinkingOpen] = useState(false)

  const textareaRef = useRef<HTMLDivElement>(null)
  /** 编辑器 → store 最近一次同步的草稿值（识别外部 draft 变化，避免回写打断输入/光标） */
  const lastSyncedRef = useRef<string>("")
  /** 最新 sendText 闭包：新建会话订阅回调的 autoSend 延迟发送经它取重渲染后的新闭包 */
  const sendTextRef = useRef<((text: string) => Promise<void>) | null>(null)

  // 侧栏树等外部组件请求切换会话：加载后清除请求标记
  useEffect(() => {
    if (!requestedConversationId) return
    clearRequestedConversation()
    void loadConversation(requestedConversationId)
  }, [requestedConversationId, loadConversation, clearRequestedConversation])

  // 错误卡「修改输入」行动按钮经 UI 事件聚焦输入区
  useEffect(() => {
    const focus = () => { textareaRef.current?.scrollIntoView({ block: "nearest" }); textareaRef.current?.focus() }
    window.addEventListener(CHAT_FOCUS_COMPOSER_EVENT, focus)
    return () => window.removeEventListener(CHAT_FOCUS_COMPOSER_EVENT, focus)
  }, [])

  // 会话切换（加载历史/新建/清空）时复位「回到底部」悬浮态：showScrollBottom 只在
  // 滚动事件里重算，切到空会话后消息区隐藏再无滚动事件，残留 true 会把按钮留在引导页上
  // （store 订阅是受支持的 setState 通道；effect 体内同步 setState 会被 eslint 拦）
  useEffect(() => {
    return useChatStore.subscribe((state, prev) => {
      if (state.conversationId === prev.conversationId) return
      nearBottomRef.current = true
      setShowScrollBottom(false)
      setHasUnread(false)
      // 选卡操作面板的选中态随会话清空（card-select F1：切换会话/小说清空）
      useCardSelection.getState().clearCard()
    })
  }, [])

  // 侧栏树「创建对话」按钮/创建作品向导请求新建会话：store 订阅消费（effect 体内同步
  // setState 会被 react-hooks/set-state-in-effect 拦，订阅回调是受支持的模式）。
  // 带载荷时关联指定小说（heroNovelPick 同步钉住，空会话的首条消息以它为准）并预填草稿；
  // 无载荷时跟随当前激活 tab（订阅触发时现读 tabs store，比对依赖数组更及时）。
  useEffect(() => {
    return useChatStore.subscribe((state) => {
      if (!state.newConversationRequested) return
      const payload = state.newConversationPayload
      // 必须先清标记再应用：下面的 store 写（setConversationId/setDraft 等）会同步重入
      // 通知本订阅，标记不清会无限递归直至栈溢出
      clearNewConversationRequest()
      if (payload) {
        // autoSend 守卫（读实时 store，且必须先于 resetConversation 读——reset 会清掉
        // pendingQuestion）：生成中/问答面板待回答时不自动发，降级为只填草稿
        const { isGenerating: generating, pendingQuestion: pendingQ, recoveryStatus: recovery, creatingNovel: creating } = useChatStore.getState()
        const autoText =
          payload.autoSend && recovery === "ready" && !creating && !generating && !pendingQ ? (payload.draft?.trim() ?? "") : ""
        resetConversation(payload.novelId, payload.draft ?? "", payload.action ?? null, payload)
        setHeroNovelPick(payload.novelId)
        if (autoText) {
          // 与手动发送完全相同的入口（sendText），但 defer 一帧：上面的 resetConversation /
          // setHeroNovelPick 本轮重渲染提交后，sendText 新闭包里的 conversationId 才是 null、
          // composerNovelId 才指向 payload.novelId；同 tick 直发会带着旧闭包的旧会话/旧关联
          // 发出去。setTimeout(0) 宏任务晚于 React 的同步 store 刷新与批量 flush，此时
          // sendTextRef 已指向新闭包。发送即消费草稿，清空输入框（同手动发送）。
          const draftId = useChatStore.getState().draftId
          setTimeout(() => {
            const current = useChatStore.getState()
            if (current.draftId === draftId && current.recoveryStatus === "ready" && !current.isGenerating && !current.creatingNovel && !current.pendingQuestion && !current.pendingPlan && current.draft.trim() === autoText) void sendTextRef.current?.(autoText)
          }, 0)
        } else if (payload.draft) {
          setDraft(payload.draft)
          // 向导/入口预填草稿后 composer 获得焦点（UI 稿 §7），用户可直接续改
          textareaRef.current?.focus()
        }
      } else {
        const { tabs: openTabs, activeTabId: activeId } = useTabsStore.getState()
        resetConversation(openTabs.find((t) => t.id === activeId)?.novelId ?? null)
        // 一并清掉上一轮（含创建作品向导）钉住的 hero 选择，恢复「跟随激活 tab」
        setHeroNovelPick(undefined)
      }
    })
  }, [resetConversation, clearNewConversationRequest, setDraft])

  useEffect(() => {
    if (nearBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" })
    } else {
      setHasUnread(true)
    }
  }, [messages])

  // 切换会话后直接落底（滚动事件会同步刷新悬浮钮显隐）
  useEffect(() => {
    nearBottomRef.current = true
    bottomRef.current?.scrollIntoView({ behavior: "auto" })
  }, [conversationId])

  const runningStartedAt = messages.find(m => m.streaming)?.startedAt
  const elapsedSeconds = clock.startedAt === runningStartedAt ? clock.seconds : 0
  /** W4 进度卡草稿预览：store 里本会话的最新草稿活动（归属回合由卡片按 toolCallId 核对） */
  const storyActivity = useStoryActivityStore(s => s.activity)
  const storyDraft: TurnProgressDraft | null =
    storyActivity && conversationId && storyActivity.conversationId === conversationId
      ? { toolCallId: storyActivity.toolCallId, title: storyActivity.title, text: storyActivity.text }
      : null
  useEffect(() => {
    if (!isGenerating || runningStartedAt == null) return
    const timer = setInterval(() => setClock({ startedAt: runningStartedAt, seconds: Math.max(0, Math.floor((Date.now() - runningStartedAt) / 1000)) }), 1000)
    return () => clearInterval(timer)
  }, [isGenerating, runningStartedAt])

  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight
    nearBottomRef.current = dist <= 160
    setShowScrollBottom(dist > 160)
    if (dist <= 160) setHasUnread(false)
  }

  // Esc 停止生成（§5.4 层级第三级）：输入框失焦时也生效；MentionPopup/AskUser/下拉弹层
  // 消费过的（defaultPrevented）或弹层内触发的不抢。停止只停当前流，不影响排队消息。
  useEffect(() => {
    if (!isGenerating) return
    const onKeyDown = (e: KeyboardEvent) => {
      const desktop=useDesktopStore.getState().bootstrap
      if (desktop) return
      if (e.key !== "Escape" || e.defaultPrevented || e.isComposing || e.keyCode===229) return
      const target = e.target as HTMLElement | null
      if (target?.closest('[role="menu"], [role="dialog"], [role="listbox"]')) return
      e.preventDefault()
      stop()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [isGenerating, stop])

  /**
   * 所有发送路径的统一入口（含延迟建书）：创建作品向导的对话入口不落库，
   * 首条消息发送前才以 pendingNovelTitle 创建小说并关联本会话；建书失败则放弃本次发送。
   */
  const sendBusyRef = useRef<symbol | null>(null)
  const sendText = useCallback(async (text: string, storySelection?: StorySelection) => {
    const before = useChatStore.getState()
    if (sendBusyRef.current || before.recoveryStatus !== "ready" || before.isGenerating || before.creatingNovel) return
    const sending = Symbol()
    sendBusyRef.current = sending
    const draftId = before.draftId
    let novelId = before.draftNovelId ?? composerNovelId
    const stillCurrent = () => useChatStore.getState().draftId === draftId && useChatStore.getState().accountId === userId
    try {
      if (before.pendingNovelTitle && !novelId) {
        // 发送前解析最终可见草稿，避免编辑或删除定位后使用向导旧快照。
        const position = positionForCreation(text, !!before.pendingNovelPosition)
        const requestId = before.novelCreationRequestId ?? crypto.randomUUID()
        useChatStore.setState({ creatingNovel: true, pendingNovelPosition: position ?? null, novelCreationRequestId: requestId, draft: text })
        const res = await fetch("/api/novels", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: before.pendingNovelTitle, requestId, position }) })
        const data = await res.json().catch(() => null) as { novel?: NovelSummaryItem; error?: string } | null
        if (!res.ok || !data?.novel) throw new Error(data?.error ?? "创建作品失败，请稍后重试")
        queryClient.invalidateQueries({ queryKey: ["novels"] })
        if (!stillCurrent()) return
        novelId = data.novel.id
        const created = data.novel
        queryClient.setQueryData<NovelList<NovelSummaryItem>>(["novels"], current => appendCreatedNovel(current, created))
        setConversationNovelId(novelId)
        useChatStore.setState({ pendingNovelTitle: null, pendingNovelPosition: null, novelCreationRequestId: null, creatingNovel: false })
      }
      if (!stillCurrent()) return
      useChatStore.setState({ creatingNovel: false, draft: "" })
      nearBottomRef.current = true
      const pending = send(text, novelId, undefined, undefined, storySelection)
      if (sendBusyRef.current === sending) sendBusyRef.current = null
      const accepted = await pending
      if (!accepted && stillCurrent() && !useChatStore.getState().draft) useChatStore.getState().setDraft(text)
      queryClient.invalidateQueries({ queryKey: ["chat-conversations"] })
    } catch (error) {
      toast.error(error instanceof Error && /[\u4e00-\u9fff]/.test(error.message) ? error.message : "创建请求结果待确认，书名和草稿已保留；重试会核对同一请求")
    } finally {
      if (sendBusyRef.current === sending) sendBusyRef.current = null
      if (stillCurrent()) useChatStore.setState({ creatingNovel: false })
    }
  }, [composerNovelId, userId, queryClient, send, setConversationNovelId])

  // 每次提交后刷新 sendTextRef：订阅回调里 setTimeout 延迟触发的 autoSend 据此拿到新闭包
  useEffect(() => {
    sendTextRef.current = sendText
    return () => { if (sendTextRef.current === sendText) sendTextRef.current = null }
  }, [sendText])

  const handleSend = async () => {
    const text = useChatStore.getState().draft.trim()
    // 三阶段保存：气泡存在时即使无文本也可发送（仅发气泡）
    if ((!text && stagedChipCount === 0) || !canSend || sendBusyRef.current) return
    const before=useChatStore.getState(),sourceDraft=before.draftId
    // 生成中点击发送 → 进入队列（§2.5），当前轮流结束后自动按序发送
    if (useChatStore.getState().isGenerating) {
      useChatStore.getState().enqueueMessage({
        id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        text,
      })
      setDraft("")
      inputHistory.remember(before.conversationId??sourceDraft,text)
      return
    }
    await sendText(text)
    const current=useChatStore.getState()
    if(current.draftId===sourceDraft)inputHistory.remember(current.conversationId??sourceDraft,text)
  }

  // 面板 [发送] 桥：StagedSaveSurface 经暂存仓请求发送 → 走与手动发送完全相同的 sendText 入口
  useEffect(() => {
    return useStagedChangesStore.subscribe((state, prev) => {
      const req = state.sendRequest
      if (!req || req === prev.sendRequest) return
      useStagedChangesStore.getState().clearStagedSend()
      const { isGenerating: generating, pendingQuestion: pendingQ, recoveryStatus: recovery, creatingNovel: creating } = useChatStore.getState()
      if (recovery !== "ready" || creating || generating || pendingQ) {
        toast.info("当前正在生成或待回答问题，请在结束后重试发送")
        return
      }
      useChatStore.getState().requestChatFocus()
      // defer 一帧：与 autoSend 同理，等本轮重渲染提交后 sendTextRef 指向新闭包
      setTimeout(() => {
        const current = useChatStore.getState()
        if (current.recoveryStatus === "ready" && !current.isGenerating && !current.creatingNovel && !current.pendingQuestion && !current.pendingPlan) {
          void sendTextRef.current?.("")
        }
      }, 0)
    })
  }, [])

  // 队列自动按序发送（§2.5）：当前轮流结束（含手动停止）且队列非空 → 取队首发送；
  // 问答面板待回答时不自动发（排队消息是作者在看到问题之前写的，抢发会跳过提问）
  const queuedMessages = useChatStore((s) => s.queuedMessages)
  const queuePaused = useChatStore((s) => s.queuePaused)
  useEffect(() => {
    if (isGenerating || queuePaused || pendingQuestion || pendingPlan) return
    const current = useChatStore.getState()
    if (current.recoveryStatus !== "ready" || current.creatingNovel || current.isGenerating || current.queuePaused || current.pendingQuestion || current.pendingPlan || current.queuedMessages.length === 0 || sendBusyRef.current) return
    const next = current.queuedMessages[0]
    useChatStore.getState().removeQueuedMessage(next.id)
    // 队列项携带的回合动作（正文改进对话框）随出队置回，发送未被收下时兜底清除防串轮
    if (next.action) useChatStore.setState({ draftAction: next.action })
    void sendText(next.text).finally(() => {
      const after = useChatStore.getState()
      if (next.action && after.draftAction === next.action) useChatStore.setState({ draftAction: null })
    })
  }, [isGenerating, queuePaused, queuedMessages, pendingQuestion, pendingPlan, sendText])

  /** 队列行「立即发送」：提到队首 + 停止当前流（流结束后自动按序机制拿起队首，避免双发） */
  const handleSendQueuedNow = (id: string) => {
    const current = useChatStore.getState()
    if (!current.isGenerating && current.queuePaused) {
      const item = current.queuedMessages.find(q => q.id === id)
      if (item) { current.setDraft(item.text); current.removeQueuedMessage(id) }
      toast.info("已放回输入框，请核对已保存的改动后再发送")
      return
    }
    useChatStore.getState().moveQueuedToFront(id)
    stop()
  }

  // ⌘K 对话内搜索（§5.4）：空会话没有可搜内容，不开启
  const [searchOpen, setSearchOpen] = useState(false)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const desktop=useDesktopStore.getState().bootstrap
      if(desktop)return
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "k" || e.defaultPrevented) return
      if(e.isComposing||e.keyCode===229)return
      e.preventDefault()
      setSearchOpen((v) => !v)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  /** 搜索跳转：滚动定位命中消息 + 短暂高亮（闪烁类由 JS 移除） */
  const jumpToMessage = (id: string) => {
    const el = document.querySelector(`[data-mid="${CSS.escape(id)}"]`)
    if (el) {
      el.scrollIntoView({ block: "center", behavior: "smooth" })
      el.classList.add("search-hit-flash")
      setTimeout(() => el.classList.remove("search-hit-flash"), 1200)
    }
    setSearchOpen(false)
  }

  /** 计划模式「批准并执行」：切回标准模式并让参谋按历史中的计划动手 */
  const handleApprovePlan = async () => {
    if (isGenerating) return
    await approvePlan()
  }

  /** 问答面板提交：回答作为普通用户消息发出（send 内部会清掉 pendingQuestion） */
  const handleAnswerQuestion = async (text: string, selection?: StorySelection) => {
    if (isGenerating) return
    await sendText(text, selection)
  }

  /** 内容面板发来的用户消息（chat:send-message）：走统一发送入口；生成中/恢复未就绪时进队列（同手动发送的排队语义）。
      有待答问题时普通消息也进队列：问答退去后自动按序发出——send 会把 pendingQuestion.interaction
      附给下一条直接发送的消息，普通通知直发会意外「答掉」不相关的待答问题。
      带 action 的消息（正文改进对话框）：当前有待答问答时先退出问答（等同面板 Esc 取消的 skipQuestion），
      再立即执行，不让改进任务排队等待旧问题；直发前置 draftAction 随请求上行（发送被收下后由 send 清掉，
      未被收下此处兜底清），其余忙碌态仍随队列项落存、出队时置回。
      任何消息一旦立即发送（任务开始执行），关闭选卡操作面板回输入框——与面板自身
      「选项即点即执行则关闭、入队保留」语义一致（入队时选中态保留）。 */
  const handleSendCardMessage = useCallback(async (text: string, action?: ChatAction) => {
    let state = useChatStore.getState()
    if (action && state.pendingQuestion) {
      await skipQuestion()
      state = useChatStore.getState()
    }
    if (state.pendingQuestion || state.pendingPlan || state.isGenerating || state.recoveryStatus !== "ready" || state.creatingNovel) {
      state.enqueueMessage({
        id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        text,
        ...(action ? { action } : {}),
      })
      toast.info("已加入发送队列，当前轮结束后自动发送")
      return
    }
    if (action) useChatStore.setState({ draftAction: action })
    // 立即发送即任务开始执行：关闭选卡操作面板回输入框（与面板自身「选项即点即执行则关闭，入队保留」语义一致）
    useCardSelection.getState().clearCard()
    await sendText(text)
    const after = useChatStore.getState()
    if (action && after.draftAction === action) useChatStore.setState({ draftAction: null })
  }, [sendText, skipQuestion])

  // 订阅内容面板的 chat:send-message：来源小说与当前会话关联一致时发进当前会话；
  // 不一致（面板属于另一作品/会话未关联）时不串戏，退回新建会话入口（同「改进正文」机制）；
  // answer=true 的回答与 AskUserPanel 提交同路径（send 自动附 pendingQuestion.interaction 并退去问答面板），作品不匹配时宁可不答也不退化为新会话消息
  useEffect(() => {
    const onSend = (e: Event) => {
      const detail = (e as CustomEvent<{ text?: string; novelId?: string | null; answer?: boolean; action?: ChatAction }>).detail
      const text = detail?.text?.trim()
      if (!text) return
      if (detail?.novelId && detail.novelId !== entityNovelId) {
        if (detail.answer) {
          toast.error("对话已切换，请在该候选所属作品的对话里提交选稿")
          return
        }
        useChatStore.getState().requestNewConversation({ novelId: detail.novelId, draft: text, ...(detail.action ? { action: detail.action } : {}), autoSend: true })
        return
      }
      if (detail?.answer) {
        if (useChatStore.getState().isGenerating) {
          toast.info("正在生成中，请稍候再提交回答")
          return
        }
        void sendText(text)
        return
      }
      void handleSendCardMessage(text, detail?.action)
    }
    window.addEventListener(CHAT_SEND_MESSAGE_EVENT, onSend)
    return () => window.removeEventListener(CHAT_SEND_MESSAGE_EVENT, onSend)
  }, [handleSendCardMessage, entityNovelId, sendText])

  /** 错误块「重新发送」：以最近一条用户消息原样重发 */
  const handleResend = async () => {
    if (isGenerating) return
    const latest = messages.at(-1)
    if (latest?.turnId) { await retryTurn(latest.turnId); return }
    const lastUser = [...messages].reverse().find((m) => m.role === "user")
    if (!lastUser) return
    await sendText(lastUser.content)
  }

  /** 引导页小说选择：记下选择并同步关联全新会话；不自动展开右侧内容区（已加载的历史会话保持原关联） */
  const handleSelectNovel = (novel: NovelSummaryItem) => {
    setHeroNovelPick(novel.id)
    setNovelQuery("")
    // 手动改选关联后，向导留下的待创建书名不再适用
    useChatStore.getState().setPendingNovelTitle(null)
    if (!conversationId) resetConversation(novel.id, useChatStore.getState().draft)
  }

  /** 引导页选择「不关联小说」：仅闲聊，参谋不使用读写工具 */
  const handleClearHeroNovel = () => {
    setHeroNovelPick(null)
    setNovelQuery("")
    useChatStore.getState().setPendingNovelTitle(null)
    if (!conversationId) resetConversation(null, useChatStore.getState().draft)
  }

  /** 引导页「新建作品」：挂起兜底书名（首条消息发送时才落库，与创建向导同一延迟建书链路） */
  const handleCreateHeroNovel = () => {
    // 关联钉为 null（产品 B1：防 draftNovelId/composerNovelId 残留错发旧书）
    setHeroNovelPick(null)
    setNovelQuery("")
    // 重置后挂起书名，防止重置清除刚创建的定位。
    if (!conversationId) resetConversation(null, useChatStore.getState().draft)
    useChatStore.setState({ pendingNovelTitle: fallbackTitle(novels ?? []), pendingNovelPosition: null, novelCreationRequestId: crypto.randomUUID() })
  }

  /** insertText → 候选数据（全量重建时水合芯片的头像/图标） */
  const chipHydrate = useMemo(() => {
    const map = new Map<string, ChipData>()
    for (const g of mentionGroups) {
      for (const it of g.items) {
        map.set(it.insertText, {
          insertText: it.insertText,
          label: it.name,
          groupLabel: it.groupLabel,
          kind: it.kind,
          avatarUrl: it.avatarUrl,
          settingType: it.settingType,
        })
      }
    }
    return (insertText: string) => map.get(insertText)
  }, [mentionGroups])

  // 外部草稿变化（建议 chips、发送后清空、切换会话等）→ 全量重建编辑器 DOM；
  // 用户正常输入时 draft 来自编辑器自身同步（值相同），不会触发重建打断光标
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    if (draft === lastSyncedRef.current) return
    lastSyncedRef.current = draft
    renderDraftIntoEditor(el, draft, chipHydrate)
    if (window.desktop) el.dataset.desktopEmpty = draft === "" ? "true" : "false"
  }, [draft, chipHydrate])

  // 草稿变化时自适应输入框高度（上限 140px；须在上面的 DOM 重建之后执行）
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`
  }, [draft])

  /** 编辑器 DOM → 纯文本草稿同步到 store（chip 还原为 @[类型/名称] 序列） */
  const syncFromEditor = () => {
    const el = textareaRef.current
    if (!el) return
    const text = editorToText(el)
    // 清空内容时清掉残留 <br> 等空节点，保证 :empty 占位样式生效
    if (window.desktop) el.dataset.desktopEmpty = text === "" ? "true" : "false"
    else if (text === "" && el.innerHTML !== "") el.innerHTML = ""
    lastSyncedRef.current = text
    setDraft(text)
    updateMention()
  }

  /** 在光标处插入 @ / / 等触发符并重新聚焦输入框 */
  const insertToken = (token: string) => {
    const el = textareaRef.current
    if (!el) return
    insertTextAtCaret(el, token)
    syncFromEditor()
  }

  /** 「+」菜单多级提及：直接在光标处插入所选资源的引用 chip（不经 @ 弹窗） */
  const insertMentionAtCaret = (item: MentionItem) => {
    const el = textareaRef.current
    if (!el) return
    el.focus()
    const caret = getCaretTextOffset(el) ?? editorToText(el).length
    insertMentionChip(
      el,
      {
        insertText: item.insertText,
        label: item.name,
        groupLabel: item.groupLabel,
        kind: item.kind,
        avatarUrl: item.avatarUrl,
        settingType: item.settingType,
      },
      caret,
      caret
    )
    syncFromEditor()
  }

  /** 依据光标位置刷新 @ 提及弹窗的开关与过滤词（输入/点击/移动光标后调用） */
  const updateMention = () => {
    const el = textareaRef.current
    if (!el || !entityNovelId) {
      setMention(null)
      return
    }
    const caret = getCaretTextOffset(el)
    if (caret == null) {
      setMention(null)
      return
    }
    const m = getMentionAtCaret(editorToText(el), caret)
    if (!m) {
      mentionDismissedRef.current = null
      setMention(null)
      return
    }
    // Esc 忽略过的同一片段：query 没变就保持关闭，继续输入（query 变化）自动复活
    const dismissed = mentionDismissedRef.current
    if (dismissed && dismissed.start === m.start && dismissed.query === m.query) {
      setMention(null)
      return
    }
    if (m.query !== mention?.query) setMentionIndex(0)
    setMention(m)
  }

  /** 选中候选：把 @query 段替换为引用 chip（@[类型/名称] 序列 + 气泡 UI），光标落到其后 */
  const selectMention = (item: MentionItem) => {
    const el = textareaRef.current
    if (!el || !mention) return
    const caret = getCaretTextOffset(el) ?? editorToText(el).length
    insertMentionChip(
      el,
      {
        insertText: item.insertText,
        label: item.name,
        groupLabel: item.groupLabel,
        kind: item.kind,
        avatarUrl: item.avatarUrl,
        settingType: item.settingType,
      },
      mention.start,
      caret
    )
    syncFromEditor()
  }

  useEffect(() => useSceneUiStore.subscribe((state, previous) => {
    const sceneReference = state.reference
    if (!sceneReference || sceneReference === previous.reference) return
    useSceneUiStore.getState().consume()
    if (!canSend || !textareaRef.current) {toast.error("请先展开可编辑的创作输入框"); return}
    if (composerNovelId && composerNovelId !== sceneReference.novelId) {toast.error("该场景属于另一部作品，不能引用到当前对话"); return}
    if (!composerNovelId) {setHeroNovelPick(sceneReference.novelId); setConversationNovelId(sceneReference.novelId); useChatStore.setState({draftNovelId: sceneReference.novelId})}
    const element = textareaRef.current
    const caret = getCaretTextOffset(element) ?? composerCaret.current ?? editorToText(element).length
    element.focus(); insertMentionChip(element, sceneReference.chip, caret, caret); syncFromEditor()
  }), [canSend, composerNovelId, setConversationNovelId]) // eslint-disable-line react-hooks/exhaustive-deps

  const currentConversation = conversations?.find((c) => c.id === conversationId)
  const historyInput=(direction:-1|1)=>{
    const current=useChatStore.getState(),element=textareaRef.current
    const text=inputHistory.move(current.conversationId??current.draftId,direction,current.draft)
    if(!element||text===current.draft)return
    renderDraftIntoEditor(element,text,chipHydrate);syncFromEditor();element.focus()
    const selection=window.getSelection(),range=document.createRange();range.selectNodeContents(element);range.collapse(false);selection?.removeAllRanges();selection?.addRange(range)
  }
  useDesktopCommands({
    "composer.focus":()=>{useChatStore.getState().requestChatFocus();textareaRef.current?.scrollIntoView({block:"nearest"});textareaRef.current?.focus()},
    "chat.search":()=>setSearchOpen(value=>!value),
    "ai.stop":{enabled:()=>isGenerating&&!mention,run:stop},
  })
  useDesktopCommands({
    "ai.send":{enabled:()=>canSend&&!mention,run:handleSend},
    "ai.newline":{enabled:()=>canSend&&!mention,run:()=>{textareaRef.current?.focus();document.execCommand("insertLineBreak");syncFromEditor()}},
    "ai.models":()=>dispatchChatUiEvent(CHAT_OPEN_MODEL_PICKER_EVENT),
    "ai.mention":{enabled:()=>canSend,run:()=>insertToken("@")},
    "ai.mentionNext":{enabled:()=>!!mention&&flatMentionItems.length>0,run:()=>setMentionIndex(index=>(index+1)%flatMentionItems.length)},
    "ai.mentionPrev":{enabled:()=>!!mention&&flatMentionItems.length>0,run:()=>setMentionIndex(index=>(index-1+flatMentionItems.length)%flatMentionItems.length)},
    "ai.mentionConfirm":{enabled:()=>!!mention&&flatMentionItems.length>0,run:()=>selectMention(flatMentionItems[Math.min(mentionIndex,flatMentionItems.length-1)])},
    "ai.mentionClose":{enabled:()=>!!mention,run:()=>{mentionDismissedRef.current=mention;setMention(null)}},
    "ai.clear":{enabled:()=>canSend,run:()=>{const element=textareaRef.current;if(!element)return;element.focus();const selection=window.getSelection(),range=document.createRange();range.selectNodeContents(element);selection?.removeAllRanges();selection?.addRange(range);document.execCommand("delete");syncFromEditor()}},
    "ai.historyPrev":{enabled:()=>canSend,run:()=>historyInput(-1)},
    "ai.historyNext":{enabled:()=>canSend,run:()=>historyInput(1)},
  },textareaRef)

  /** W7 输入提示：随 enterToSend 设置反转（placeholder 与发送方式菜单同文案） */
  const composerEnterHint = desktopBootstrap?composerBindingHint(desktopCommandCatalog(desktopBootstrap.platform),desktopBootstrap.settings.shortcuts[desktopBootstrap.platform]):enterToSend ? "Enter 发送，Shift+Enter 换行" : "Shift+Enter 发送，Enter 换行"

  return (
    <div className="chatpane flex h-full flex-col bg-chat-bg" aria-busy={!canSend}>
      {/* header：标题 + 会话选择 + 关联小说指示胶囊 */}
      <div data-desktop-caption={desktopBootstrap?.platform === "win32" ? "win32" : undefined} className="desktop-drag flex h-11 shrink-0 items-center gap-2 border-b border-border px-3"
        style={desktopBootstrap?.platform === "win32" && contentHidden ? {
          paddingRight: `calc(max(100vw - env(titlebar-area-width, calc(100vw - 138px)), ${138 / desktopBootstrap.settings.appearance.zoom}px) + ${28 / desktopBootstrap.settings.appearance.zoom}px + 12px)`,
        } : undefined}>
        {/* macOS 窗控不随网页缩放：抵消标题 .75rem 内边距，
            将恢复按钮左缘留在原生窗控右侧的 88px 安全位置。 */}
        {sidebarHidden && onShowSidebar && (
          <button
            type="button"
            aria-label="显示左侧导航栏"
            title="显示左侧导航栏"
            onClick={onShowSidebar}
            style={desktopBootstrap?.platform === "darwin" ? { marginLeft: `calc(${88 / desktopBootstrap.settings.appearance.zoom}px - .75rem)` } : undefined}
            className="-ml-1.5 flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-hover-wash hover:text-foreground"
          >
            <PanelLeft className="size-4" />
          </button>
        )}
        {/* 顶栏：AI 对话图标 + 当前会话标题（2026-09 简化：去掉会话切换下拉、
            「创作参谋」文字与关联小说下拉；切换会话走侧栏树「对话」节点。
            空会话引导页不显示图标与标题（有对话内容才出现）；flex-1 占位 span 常驻，保住右侧恢复钮位置） */}
        {messages.length > 0 && <MessageSquare className="size-3.5 shrink-0 text-primary" />}
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
          {messages.length > 0 ? (currentConversation?.title ?? "新会话") : ""}
        </span>

        {/* 右侧内容面板隐藏时的恢复入口（隐藏按钮在内容区 tab 条上、随面板一起卸载） */}
        {contentHidden && onShowContent && (
          <button
            type="button"
            aria-label="显示内容面板"
            title="显示内容面板"
            onClick={onShowContent}
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-hover-wash hover:text-foreground"
          >
            <PanelRight className="size-4" />
          </button>
        )}
      </div>

      <StoryWorkflowBar novelId={conversationNovelId ?? heroNovelId} running={isGenerating} />
      {recoveryStatus !== "ready" && <div role="status" className="border-b border-border bg-card px-4 py-2 text-sm text-muted-foreground">正在恢复会话…</div>}
      {(recoveryNotice || storageNotice) && <div role="status" className="border-b border-border bg-card px-4 py-2 text-xs text-muted-foreground">{storageNotice ?? recoveryNotice}</div>}
      {creatingNovel && <div role="status" className="border-b border-border bg-card px-4 py-2 text-sm text-muted-foreground">正在创建《{pendingNovelTitle}》，书名和草稿已保留…</div>}

      {/* 消息区（相对定位容器承载「回到底部」悬浮钮）；空会话时隐藏，由下方输入区转为居中引导页。
          进程面板为右上角浮层：chatpane ≥1720px 时 960 内容两侧边距已足够容纳面板，浮层不占位、
          消息保持原宽且居中；800~1720px 滚动区右侧预留等宽水槽（消息按比例让宽不被遮挡），
          <800px 直接覆盖消息区右上角。滚动条始终位于面板右侧 */}
      <div className={messages.length === 0 ? "hidden" : "relative flex min-h-0 flex-1 flex-col"}>
        {/* SOP 进行中计划吸顶条（2026-08）：有计划时钉在消息区顶部，点击滚动定位到计划卡 */}
        {conversationId && (
          <ActivePlanBar
            conversationId={conversationId}
            streaming={isGenerating}
            onLocate={(planId) => {
              const el = scrollRef.current?.querySelector(`[data-sop-plan="${planId}"]`)
              el?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" })
            }}
          />
        )}
        {/* 进程面板（zcode 式）：浮于滚动区右上角；中间宽度带由下方水槽预留宽度故不压消息；SOP 吸顶条在时下移让位 */}
        {progressVisible && chatProgress && (
          <div className={cn("absolute top-2.5 right-4 z-30", planBarActive && "top-11")}>
            <ProgressPanel
              progress={chatProgress}
              index={entityIndex}
              novelId={entityNovelId}
              open={progressOpen}
              onToggleOpen={() => setProgressOpen((v) => !v)}
              onClose={() => setProgressDismissedKey(chatProgress.key)}
            />
          </div>
        )}
        {/* 面板被 X 关闭后的重开入口：同一右上角位置的纯图标钮（新一轮任务/新子代理使面板自动重现时让位） */}
        {!progressVisible && chatProgress && (
          <button
            type="button"
            title="显示任务清单"
            aria-label="显示任务清单"
            onClick={() => setProgressDismissedKey(null)}
            className={cn(
              "absolute top-2.5 right-4 z-30 flex size-[30px] items-center justify-center rounded-full border border-(--chat-line) bg-popover text-muted-foreground shadow-2 transition-colors hover:text-foreground",
              planBarActive && "top-11"
            )}
          >
            <ListTodo className="size-3.5" />
          </button>
        )}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          onClick={handleMessageAreaClick}
          className={cn(
            "min-h-0 flex-1 overflow-y-auto px-4 py-[18px]",
            // 面板可见且 chatpane 处于 800~1720px 中间带：右侧预留「面板宽 clamp(260,30%,340) + 28px」
            // 水槽，滚动条落在水槽右缘 = 面板右侧；≥1720 边距天然够用不预留（消息原宽居中），<800 覆盖式
            progressVisible && PROGRESS_GUTTER_CLASS
          )}
        >
            <div className="mx-auto flex w-full max-w-[960px] flex-col gap-4">
              {conversationId && <SopPlanCard conversationId={conversationId} planId={null} streaming={isGenerating} />}
              {conversationId && !!planQuery.data?.recent.length && <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">历史计划（{planQuery.data.recent.length}）</summary>{planQuery.data.recent.map(plan => <SopPlanCard key={plan.id} conversationId={conversationId} planId={plan.id} streaming={false} />)}</details>}
              {messages.map((m, mi) =>
                m.role === "user" ? (
                  <UserMessage key={m.id} mid={m.id} content={m.content} entityIndex={entityIndex} stagedBatches={m.stagedBatches} />
                ) : (
                  <AttemptHistory key={m.id} historical={!!m.turnId && messages.some((later, li) => li > mi && later.turnId === m.turnId && later.role === "assistant")} >
                  <AssistantMessage
                    message={m}
                    streaming={isGenerating && m.streaming === true}
                    elapsedSeconds={elapsedSeconds}
                    workedSeconds={m.workedSeconds}
                    entityIndex={entityIndex}
                    novelId={entityNovelId}
                    onResend={m.error && mi === messages.length - 1 && (m.turnId ? m.canRetry || m.canResume : !m.hasWriteEffects) && !isGenerating ? handleResend : undefined}
                    onRefreshNavigation={m.error && mi === messages.length - 1 && !m.turnId && ["VERSION_CONFLICT", "INTERACTION_STALE", "NAVIGATION_REFRESHED"].includes(m.errorCode ?? "") && conversationId ? () => void loadConversation(conversationId) : undefined}
                    askSummary={deriveAskSummary(messages, mi, askPanelPending)}
                    thinkingOpen={
                      isGenerating && m.streaming === true ? thinkingOpen : undefined
                    }
                    onToggleThinking={
                      isGenerating && m.streaming === true
                        ? () => setThinkingOpen((v) => !v)
                        : undefined
                    }
                    storyDraft={isGenerating && m.streaming === true ? storyDraft : null}
                    suppressedDrawIds={suppressedDrawIdsById.get(m.id)}
                  />
                  </AttemptHistory>
                )
              )}
              {isGenerating && !messages.some((m) => m.streaming === true) && (
                <ThinkingPlaceholder
                  elapsedSeconds={elapsedSeconds}
                  open={thinkingOpen}
                  onToggle={() => setThinkingOpen((v) => !v)}
                />
              )}
              <div ref={bottomRef} />
            </div>
        </div>
        {/* 实体芯片 hover 卡（§4.5）：监听消息区芯片悬停，fixed 渲染 popover */}
        <EntityHoverCard containerRef={scrollRef} index={entityIndex} novelId={entityNovelId} />
        {/* ⌘K 对话内搜索（§5.4） */}
        {searchOpen && messages.length > 0 && (
          <SearchPalette messages={messages} onJump={jumpToMessage} onClose={() => setSearchOpen(false)} />
        )}
      </div>

      {/* 输入区：空会话时转为居中引导页（标题 + 输入框 + 模板提示词卡片），有消息后固定底部。
          与消息区之间不设分割线、不放建议气泡，视觉一体化。水平内边距与消息滚动区一致（px-4 +
          同一进程面板水槽），保证 composer 与 960 消息列宽度、位置完全对齐 */}
      <div
        className={cn(
          messages.length === 0
            ? "flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-4 pt-6 pb-16"
            : "shrink-0 px-4 pt-2 pb-3.5",
          progressVisible && PROGRESS_GUTTER_CLASS
        )}
      >
        {messages.length === 0 && (
          <h1 className="w-full max-w-[720px] text-center font-serif text-2xl font-semibold tracking-[0.04em] text-foreground dark:font-sans">
            {heroNovel
              ? `今天想为《${heroNovel.title}》写点什么？`
              : pendingNovelTitle
                ? `今天想为《${pendingNovelTitle}》写点什么？`
                : "今天想写点什么？"}
          </h1>
        )}

        {/* 计划模式：参谋产出计划后显示批准条，点击切回标准模式执行（问答面板展示时让位） */}
        {pendingPlan && !isGenerating && !askPanelPending && <div data-testid="plan-approval" className="mx-auto mb-2 flex w-full max-w-[960px] flex-wrap items-center gap-2.5 rounded-card border border-primary/30 bg-primary/5 px-3 py-2">
          <ClipboardList className="size-4 shrink-0 text-primary" /><span className="min-w-0 flex-1 text-sm">{pendingPlan.payload.title} · 等待批准</span>
          <Button size="sm" onClick={handleApprovePlan}>批准此版并执行</Button><Button size="sm" variant="outline" onClick={() => void skipPlan()}>暂不执行</Button>
        </div>}

        {/* 执行中排队的消息（§2.5）：composer 上方，当前轮流结束后自动按序发送 */}
        {queuePaused && queuedMessages.length > 0 && <div className="mx-auto mb-2 flex w-full max-w-[960px] items-center gap-2 text-xs text-muted-foreground">
          <span>{suspendedExecution ? "请核对上次改动，排队消息可放回输入框确认。" : "排队消息等待确认，尚未发送。"}</span>
          {!suspendedExecution && !pendingQuestion && !pendingPlan && canSend && <Button size="sm" variant="outline" onClick={() => useChatStore.setState({ queuePaused: false })}>确认后继续队列</Button>}
        </div>}
        {following && !isGenerating && <div className="mx-auto mb-2 w-full max-w-[960px]"><Button size="sm" variant="outline" onClick={() => void cancelFollowing()}>停止执行</Button></div>}
        {pendingRequest && !isGenerating && <div className="mx-auto mb-2 flex w-full max-w-[960px] items-center gap-2 text-xs text-muted-foreground"><span>上次发送结果待确认，草稿已保留。</span><Button size="sm" variant="outline" onClick={() => void reconcilePending()}>核对上次发送</Button></div>}
        <QueueRows onSendNow={handleSendQueuedNow} />

        {/* 参谋提问待回答：问答面板替换 composer 输入框；Esc 取消不发送任何消息。
            无待答问答时，点选抽卡候选卡切换为选卡操作面板（card-select F1） */}
        {showAskPanel && pendingQuestion ? (
          <AskUserPanel
            pending={pendingQuestion}
            onSubmit={handleAnswerQuestion}
            onCancel={() => void skipQuestion()}
          />
        ) : showCardPanel && entityNovelId ? (
          <CandidateActionPanel novelId={entityNovelId} conversationId={conversationId} />
        ) : (
        <div
          className={cn(
            "relative mx-auto w-full rounded-composer border border-(--chat-line-strong) bg-chat-surface",
            messages.length === 0
              ? "mt-9 max-w-[720px] shadow-3 dark:border-foreground/12 dark:bg-popover"
              : "max-w-[960px]"
          )}
        >
          {mention && (
            <MentionPopup
              groups={filteredMentionGroups}
              activeIndex={mentionIndex}
              onActiveChange={setMentionIndex}
              onSelect={selectMention}
            />
          )}
          {/* 芯片悬停卡：等级（@[设定·名/{id}·{等级名}]，按 id 反查）与角色（@[角色/名]，实体索引解析） */}
          <ComposerChipHoverCard containerRef={textareaRef} novelId={composerNovelId} index={entityIndex} />
          {/* 回到底部：悬浮于输入框上边缘中心，与上边缘保持 4px 微距；问答面板接管时不显示；
              空会话（无消息区可滚动）不显示（状态残留的双保险，订阅复位见上） */}
          {showScrollBottom && messages.length > 0 && (
            <button
              type="button"
              title="回到底部"
              aria-label="回到底部"
              onClick={() => {
                nearBottomRef.current = true
                setShowScrollBottom(false)
                setHasUnread(false)
                bottomRef.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" })
              }}
              className="absolute -top-[34px] left-1/2 z-40 flex size-[30px] -translate-x-1/2 items-center justify-center rounded-full border border-(--chat-line) bg-popover text-muted-foreground shadow-2 transition-colors hover:text-foreground"
            >
              <ArrowDown className="size-3.5" />
              {hasUnread && (
                <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-primary" />
              )}
            </button>
          )}
          {/* contenteditable composer：@ 引用以原子 chip 内联展示（图标/头像 + 高亮名称，无气泡），
              纯文本草稿（@[类型/名称] 序列）存 store，经 syncFromEditor 单向同步 */}
          {/* 三阶段保存气泡行：修改批次芯片（整行不可输入；悬停明细卡 + 右上角删除） */}
          <StagedChips novelId={composerNovelId} />
          <div
            ref={textareaRef}
            contentEditable={canSend}
            aria-readonly={!canSend}
            role="textbox"
            aria-multiline="true"
            aria-label="消息输入框"
            data-testid="composer-editor"
            data-placeholder={
              composerNovelId
                ? mode === "plan"
                  ? `描述目标，参谋会先出计划待你批准…（@ 提及章节 / 角色；${composerEnterHint}）`
                  : `吩咐你的创作参谋…（@ 提及章节 / 角色，/ 命令；${composerEnterHint}）`
                : `说说你的灵感，也可以直接创建一部新小说…（${composerEnterHint}）`
            }
            onInput={syncFromEditor}
            onKeyUp={updateMention}
            onClick={updateMention}
            onCopy={(e) => {
              const text = selectedEditorText(e.currentTarget)
              if (text === null) return
              e.clipboardData.setData("text/plain", text)
              e.preventDefault()
            }}
            onPaste={(e) => {
              const pasteText = (text: string) => {
                if (!canSend) throw new Error("当前消息输入框只读，未粘贴内容")
                if (text) insertDraftAtCaret(e.currentTarget, text, chipHydrate, { nativeUndo: !!window.desktop })
                syncFromEditor()
              }
              if (consumeDesktopComposerPaste(e.nativeEvent, pasteText)) { e.preventDefault(); return }
              e.preventDefault()
              if (!canSend) return
              const text = e.clipboardData.getData("text/plain")
              try { pasteText(text) } catch { toast.error("消息输入框无法粘贴，请重试") }
            }}
            onCut={(e) => {
              if (!window.desktop) return
              e.preventDefault()
              if (!canSend) return
              const text = selectedEditorText(e.currentTarget)
              if (text === null) return
              e.clipboardData.setData("text/plain", text)
              try { deleteDraftSelection(e.currentTarget); syncFromEditor() } catch { toast.error("消息输入框无法剪切，请重试") }
            }}
            // 实体卡片拖拽（chip-drag payload：等级/角色等）：dragover 只读 types 放行；
            // drop 在释放点插入引用芯片（落点无效时追加到草稿末尾），复用单向同步
            onDragOver={(e) => {
              if (!canSend || !hasChipDrag(e.dataTransfer)) return
              e.preventDefault()
              e.dataTransfer.dropEffect = "copy"
            }}
            onDrop={(e) => {
              if (!canSend) return
              const chip = readChipDrag(e.dataTransfer)
              if (!chip) return
              const identity = parseSceneIdentity(splitMentionToken(chip.insertText).payload)
              if (chip.kind === "scene" && (!identity || composerNovelId && identity.novelId !== composerNovelId)) {e.preventDefault(); toast.error("该场景属于另一部作品或引用已失效"); return}
              if (identity && !composerNovelId) {setHeroNovelPick(identity.novelId); setConversationNovelId(identity.novelId); useChatStore.setState({draftNovelId: identity.novelId})}
              // 阻止 contenteditable 的原生 drop（插纯文本 + 改光标）与 mention 弹窗误触发
              e.preventDefault()
              e.stopPropagation()
              const el = textareaRef.current
              if (!el) return
              el.focus()
              const offset = getDropTextOffset(el, e.clientX, e.clientY) ?? editorToText(el).length
              insertMentionChip(el, chip, offset, offset)
              syncFromEditor()
            }}
            onBlur={() => {composerCaret.current = textareaRef.current ? getCaretTextOffset(textareaRef.current) : null; setMention(null)}}
            onKeyDown={(e) => {
              // Desktop bindings (including mention contexts) are dispatched
              // once by the shared capture listener, from committed settings.
              if(useDesktopStore.getState().bootstrap)return
              // @ 弹窗打开期间：↑/↓ 导航、Enter/Tab 选中（不发送）、Esc 关闭
              if (mention && !e.nativeEvent.isComposing) {
                if (e.key === "ArrowDown" && flatMentionItems.length > 0) {
                  e.preventDefault()
                  setMentionIndex((i) => (i + 1) % flatMentionItems.length)
                  return
                }
                if (e.key === "ArrowUp" && flatMentionItems.length > 0) {
                  e.preventDefault()
                  setMentionIndex(
                    (i) => (i - 1 + flatMentionItems.length) % flatMentionItems.length
                  )
                  return
                }
                if ((e.key === "Enter" || e.key === "Tab") && flatMentionItems.length > 0) {
                  e.preventDefault()
                  selectMention(
                    flatMentionItems[Math.min(mentionIndex, flatMentionItems.length - 1)]
                  )
                  return
                }
                if (e.key === "Escape") {
                  e.preventDefault()
                  mentionDismissedRef.current = mention
                  setMention(null)
                  return
                }
              }
              if (e.key === "Escape" && isGenerating) {
                // Esc 层级第三级（§5.4）：@ 弹窗已在上文消费；此处停止当前生成（不清队列）
                e.preventDefault()
                stop()
                return
              }
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                // W7：Enter 发送 / Shift+Enter 换行（随 enterToSend 设置反转；IME 合成中不发送）
                const sendNow = enterToSend ? !e.shiftKey : e.shiftKey
                if (sendNow) {
                  e.preventDefault()
                  handleSend()
                }
              }
            }}
            className={cn(
              "chat-composer-editable max-h-[140px] w-full overflow-y-auto bg-transparent px-3.5 pt-3 pb-1 text-[13.5px] leading-[1.6] wrap-break-word whitespace-pre-wrap text-foreground outline-none",
              "data-[desktop-empty=true]:before:content-[attr(data-placeholder)] data-[desktop-empty=true]:before:text-muted-foreground/70 data-[desktop-empty=true]:before:pointer-events-none",
              messages.length === 0 ? "min-h-[92px]" : "min-h-[52px]"
            )}
          />
          <div className="flex items-center justify-between gap-2 px-2 pt-1 pb-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <button
                      type="button"
                      title="添加"
                      aria-label="添加"
                      className="flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-hover-wash hover:text-foreground"
                    />
                  }
                >
                  <Plus className="size-3.5" />
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="start" sideOffset={8} className="w-60">
                  <DropdownMenuItem onClick={() => toast("即将支持")}>
                    <ImageIcon className="size-3.5" />
                    添加图片
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => toast("即将支持")}>
                    <Paperclip className="size-3.5" />
                    添加附件文件
                  </DropdownMenuItem>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger disabled={!entityNovelId}>
                      <AtSign className="size-3.5" />
                      插入角色·场景·大纲
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="w-52">
                      {mentionGroups.length === 0 ? (
                        <DropdownMenuItem disabled>暂无可引用资源</DropdownMenuItem>
                      ) : (
                        mentionGroups.map((g) => {
                          const GroupIcon = MENTION_GROUP_ICONS[g.key] ?? AtSign
                          return (
                            <DropdownMenuSub key={g.key}>
                              <DropdownMenuSubTrigger>
                                <GroupIcon className="size-3.5" />
                                <span className="min-w-0 flex-1 truncate">{g.label}</span>
                                <span className="text-[10.5px] text-muted-foreground">
                                  {g.items.length}
                                </span>
                              </DropdownMenuSubTrigger>
                              <DropdownMenuSubContent className="w-64">
                                <DropdownMenuGroup>
                                  <DropdownMenuLabel>{g.label}</DropdownMenuLabel>
                                  {g.items.map((item) => (
                                    <DropdownMenuItem
                                      key={item.key}
                                      onClick={() => insertMentionAtCaret(item)}
                                    >
                                      <MentionItemVisual item={item} />
                                      <span className="min-w-0 flex-1 truncate">
                                        {item.name}
                                      </span>
                                      {item.detail && (
                                        <span className="shrink-0 text-[10.5px] text-muted-foreground">
                                          {item.detail}
                                        </span>
                                      )}
                                    </DropdownMenuItem>
                                  ))}
                                </DropdownMenuGroup>
                              </DropdownMenuSubContent>
                            </DropdownMenuSub>
                          )
                        })
                      )}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuItem onClick={() => toast("即将支持")}>
                    <Hash className="size-3.5" />
                    插入 # 会话
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => insertToken("/")}>
                    <Slash className="size-3.5" />
                    插入 / 命令
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <button
                      type="button"
                      title="对话模式"
                      aria-label="对话模式"
                      className="flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs whitespace-nowrap text-muted-foreground transition-colors hover:bg-hover-wash hover:text-foreground"
                    />
                  }
                >
                  {mode === "plan" ? (
                    <ClipboardList className="size-3" />
                  ) : (
                    <Shield className="size-3" />
                  )}
                  {mode === "plan" ? "计划模式" : "标准模式"}
                  <ChevronDown className="size-3" />
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="start" sideOffset={8} className="w-56">
                  <DropdownMenuItem onClick={() => setMode("standard")}>
                    <Shield className="size-3.5" />
                    <span className="min-w-0 flex-1">标准模式</span>
                    {mode === "standard" && <Check className="size-3.5 text-primary" />}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setMode("plan")}>
                    <ClipboardList className="size-3.5" />
                    <span className="min-w-0 flex-1">计划模式</span>
                    {mode === "plan" && <Check className="size-3.5 text-primary" />}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>发送方式</DropdownMenuLabel>
                    <DropdownMenuItem onClick={() => {void saveSendPreset(true)}}>
                      <Keyboard className="size-3.5" />
                      <span className="min-w-0 flex-1">Enter 发送，Shift+Enter 换行</span>
                      {sendPreset==="enter" && <Check className="size-3.5 text-primary" />}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => {void saveSendPreset(false)}}>
                      <Keyboard className="size-3.5" />
                      <span className="min-w-0 flex-1">Shift+Enter 发送，Enter 换行</span>
                      {sendPreset==="shift" && <Check className="size-3.5 text-primary" />}
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className="flex items-center gap-1.5">
              {/* 模型选择器（两层列表：模型 → 思考强度；会话级持久化，来源 Admin 登记的可用模型） */}
              <ModelPicker />

              {isGenerating ? (
                <button
                  type="button"
                  onClick={stop}
                  title="停止生成"
                  aria-label="停止生成"
                  className="flex size-7 shrink-0 items-center justify-center rounded-full bg-destructive text-destructive-foreground transition-opacity hover:opacity-90"
                >
                  <Square className="size-3.5" fill="currentColor" strokeWidth={0} />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={!canSend || (!draft.trim() && stagedChipCount === 0)}
                  title="发送"
                  aria-label="发送"
                  className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <ArrowUp className="size-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>
        )}

        {messages.length === 0 && (
          /* 状态栏（Codex 式贴合）：顶部 -mt 塞入 composer 卡片底下（卡片 relative 压在其上，输入框四角圆角完整），两侧内缩 4px，仅露底部圆角；bg-primary/6 暖调装饰底与选中态 selected-surface 语义分离 */
          <div className="mx-auto -mt-2 flex w-[calc(100%-8px)] max-w-[712px] items-center rounded-b-composer border border-(--chat-line) bg-primary/6 px-2.5 pt-4 pb-2">
              <DropdownMenu onOpenChange={(open) => !open && setNovelQuery("")}>
                <DropdownMenuTrigger
                  render={
                    <button
                      type="button"
                      title="选择要创作的小说"
                      aria-label="选择要创作的小说"
                      className="flex h-7 max-w-full items-center gap-1.5 rounded-full px-2.5 text-xs text-muted-foreground transition-colors hover:bg-hover-wash hover:text-foreground"
                    />
                  }
                >
                  <BookOpen className="size-3.5 shrink-0" />
                  <span className="max-w-[220px] truncate">
                    {pendingNovelTitle ? `《${pendingNovelTitle}》（待创建）` : heroNovel ? `《${heroNovel.title}》` : heroNovelPick === null ? "不关联小说" : "选择要创作的小说"}
                  </span>
                  <ChevronDown className="size-3 shrink-0" />
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  side="bottom"
                  align="start"
                  sideOffset={8}
                  className="w-64 p-0"
                >
                  <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                    <Search className="size-3.5 shrink-0 text-muted-foreground" />
                    <input
                      value={novelQuery}
                      onChange={(e) => setNovelQuery(e.target.value)}
                      onKeyDown={(e) => e.stopPropagation()}
                      placeholder="搜索小说"
                      className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                    />
                  </div>
                  <div className="p-1">
                    {/* 新建作品：常驻列表区顶部，不参与 novelQuery 搜索过滤；挂起态右侧 ✓。
                        仅空会话（!conversationId）可点——已加载的空会话 storedNovelId 跟随旧书，
                        此时挂起新书会显示「待创建」但发送仍落旧书（守卫与 handleCreateHeroNovel 同边界） */}
                    {!conversationId && (
                      <DropdownMenuItem onClick={handleCreateHeroNovel}>
                        <Plus className="size-3.5 text-muted-foreground" />
                        <span className="min-w-0 flex-1">新建作品</span>
                        {pendingNovelTitle && <Check className="size-3.5 text-primary" />}
                      </DropdownMenuItem>
                    )}
                    {filteredHeroNovels.length === 0 && (
                      <div className="px-2 py-1.5 text-xs text-muted-foreground">
                        没有匹配的小说
                      </div>
                    )}
                    {filteredHeroNovels.map((n) => (
                      <DropdownMenuItem key={n.id} onClick={() => handleSelectNovel(n)}>
                        <BookOpen className="size-3.5 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate">《{n.title}》</span>
                        {n.id === heroNovelId && <Check className="size-3.5 text-primary" />}
                      </DropdownMenuItem>
                    ))}
                  </div>
                  <DropdownMenuSeparator />
                  <div className="p-1">
                    <DropdownMenuItem onClick={handleClearHeroNovel}>
                      <BookX className="size-3.5 text-muted-foreground" />
                      <span className="min-w-0 flex-1">不关联小说（仅闲聊）</span>
                      {heroNovelPick === null && !pendingNovelTitle && (
                        <Check className="size-3.5 text-primary" />
                      )}
                    </DropdownMenuItem>
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
        )}

        {messages.length === 0 && (
          <div className="mt-9 grid w-full max-w-[600px] grid-cols-2 gap-2.5">
            {TEMPLATE_CARDS.map((card) => (
              <button
                key={card.title}
                type="button"
                onClick={() => {
                  setDraft(card.prompt)
                  textareaRef.current?.focus()
                }}
                className="group flex flex-col items-start gap-1.5 rounded-card border border-(--chat-line) bg-chat-surface px-4 py-3.5 text-left shadow-1 transition-colors hover:border-primary/40 hover:bg-hover-wash"
              >
                <card.icon className="size-4 text-primary/80 transition-colors group-hover:text-primary" />
                <span className="text-[13px] font-medium text-foreground">{card.title}</span>
                <span className="text-[11.5px] leading-snug text-muted-foreground">
                  {card.desc}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
