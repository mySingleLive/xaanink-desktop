"use client"

/**
 * 进程面板（2026-08 zcode/codex 式任务进程框，取代原内联 TaskListCard 清单卡）：
 * - 数据：deriveChatProgress 从消息流推断——任务清单取「最近一轮有批量任务」的助手消息
 *   （推断规则与原清单卡一致：连续同组 ≥4 才成清单，宁缺毋假）；智能体区取全会话
 *   最近 5 条子代理调用（评委/读者团/平台编辑/剧作家/总编面板）。
 * - 形态：单一浮层卡（340px，shadow-2 + 描边）绝对定位于消息区右上角。宽屏
 *   （chatpane ≥800px）由 ChatPanel 给滚动区右侧预留「面板宽 clamp(260px,30%,340px) + 28px」
 *   水槽（pr），消息不被遮挡、滚动条始终位于面板右侧；窄屏（<800px）直接覆盖消息区。
 * - 高度：面板一直被内容撑开，永远不出滚动条——清单超过 FOLD_MIN_ITEMS 条时把开头的
 *   连续已完成条目折进「已完成 N 项」（悬停在行左侧弹出浮层展示、点击钉住，至少保留
 *   尾部 VISIBLE_TAIL 条可见）；子代理超过 AGENT_FOLD_MIN 个时把已结束的折进「已结束 N 个」（同上）。
 * - 视觉：头部「进程 N/M」（全部完成时计数转 success 绿，呼应 zcode）+ 折叠 chevron +
 *   关闭 X；done 条目按 zcode 形态删除线 + muted；折叠走 Collapse 200ms 过渡。
 */
import { useRef, useState, type ReactNode } from "react"
import { Check, ChevronDown, ChevronLeft, ChevronRight, X } from "lucide-react"

import { cn } from "@/lib/utils"

import type { SopPlanView } from "./SopPlanCard"
import { Collapse } from "./Collapse"
import { SubAgentRow, isSubAgentTool } from "./SubAgentRow"
import {
  groupToolCalls,
  isToolGroup,
  summarizeOutput,
  type ChatMessageView,
  type ToolCallView,
} from "./types"
import type { EntityIndex } from "./use-entity-index"

/** 清单条目三态 + 失败（勾圈派圆点，done 条目文字删除线） */
type TaskStatus = "done" | "active" | "pending" | "failed"

interface TaskItem {
  key: string
  label: string
  status: TaskStatus
}

interface TaskList {
  key: string
  title: string
  items: TaskItem[]
  doneCount: number
}

/** 面板派生结果：任务清单（最近一轮）+ 子代理（全会话最近几条）；key 供关闭-重现判定 */
export interface ChatProgress {
  key: string
  lists: TaskList[]
  agents: ToolCallView[]
  doneCount: number
  totalCount: number
  allDone: boolean
}

/** 可 UI 化为清单的创作任务组（其余归组只走 §2.2 计数行） */
const TASK_GROUP_TOOLS = new Set(["createChapter", "createCharacter", "generateCharacterImage"])

/** 智能体区展示的最近子代理条数上限 */
const AGENT_SECTION_MAX = 5

/** 清单超过此条数才把开头的连续已完成折进「已完成 N 项」 */
const FOLD_MIN_ITEMS = 7
/** 折叠时始终保留的尾部可见条数（进行中断点附近的上下文） */
const VISIBLE_TAIL = 3
/** 子代理超过此个数才把已结束的折进「已结束 N 个」 */
const AGENT_FOLD_MIN = 3

/** 条目标签：章节取标题、角色取名、出图取角色名 + 图类；解析不了返回 null（整组放弃） */
function itemLabel(call: ToolCallView, index: EntityIndex | undefined): string | null {
  const input = (call.input ?? {}) as Record<string, unknown>
  if (call.toolName === "createChapter") {
    return typeof input.title === "string" && input.title.trim() ? input.title : null
  }
  if (call.toolName === "createCharacter") {
    return typeof input.name === "string" && input.name.trim() ? input.name : null
  }
  if (call.toolName === "generateCharacterImage") {
    const id = typeof input.characterId === "string" ? input.characterId : null
    const ref = id && index ? index.characterById(id) : undefined
    const name = ref && "name" in ref ? ref.name : null
    if (!name) return null
    const kind =
      input.kind === "avatar" ? "头像" : input.kind === "portrait" ? "立绘" : "头像 + 立绘"
    return `${name} · ${kind}`
  }
  return null
}

/** 从一轮工具调用推断创作任务清单（推断不出则整组不渲染） */
export function deriveTaskLists(calls: ToolCallView[], index: EntityIndex | undefined): TaskList[] {
  const lists: TaskList[] = []
  for (const row of groupToolCalls(calls)) {
    if (!isToolGroup(row) || !TASK_GROUP_TOOLS.has(row.calls[0]?.toolName ?? "")) continue
    const items: TaskItem[] = []
    let abandoned = false
    for (const call of row.calls) {
      const label = itemLabel(call, index)
      if (!label) {
        abandoned = true
        break
      }
      const status: TaskStatus =
        call.status === "running"
          ? "active"
          : call.status === "unknown" || call.status === "error" ||
              !summarizeOutput(call.toolName, call.input, call.output).ok
            ? "failed"
            : "done"
      items.push({ key: call.toolCallId, label, status })
    }
    if (abandoned) continue
    lists.push({
      key: row.key,
      title: row.groupName,
      items,
      doneCount: items.filter((it) => it.status === "done").length,
    })
  }
  return lists
}

/**
 * 会话级进程派生：清单取「最近一轮有批量任务」的助手消息（新一轮还没凑够一组时
 * 回退到上一批，面板不闪空）；智能体取全会话最近 AGENT_SECTION_MAX 条（时间序）。
 * 两者皆空返回 null（面板不出现）。
 */
export function deriveChatProgress(
  messages: ChatMessageView[],
  index: EntityIndex | undefined,
  plan?: SopPlanView | null
): ChatProgress | null {
  const current = messages.at(-1)?.role === "assistant" ? messages.at(-1)! : null
  const lists: TaskList[] = plan ? [{ key: plan.id, title: plan.title, doneCount: plan.items.filter(i => i.status === "done").length,
    items: plan.items.map(i => ({ key: i.id, label: i.label, status: i.status === "skipped" ? "pending" : i.status })) }] : current ? deriveTaskLists(current.toolCalls, index) : []
  const roundKey = plan?.id ?? current?.id ?? ""
  const allAgents = current?.toolCalls.filter(c => isSubAgentTool(c.toolName)) ?? []
  const agents = allAgents.slice(-AGENT_SECTION_MAX)

  if (lists.length === 0 && agents.length === 0) return null

  const doneCount = lists.reduce((n, l) => n + l.doneCount, 0)
  const totalCount = lists.reduce((n, l) => n + l.items.length, 0)
  return {
    // 关闭后同一 key 不再自动出现；新一轮任务 / 新子代理出现时 key 变化 → 自动重现
    key: `${roundKey}:${allAgents.length}`,
    lists,
    agents,
    doneCount,
    totalCount,
    allDone: totalCount > 0 && doneCount === totalCount,
  }
}

/**
 * 清单折叠切分：条目超过 FOLD_MIN_ITEMS 时，把开头连续的 done 条目折进「已完成 N 项」
 * （进行中/待办/失败永不折叠——它们正是待办的意义；尾部至少保留 VISIBLE_TAIL 条可见）。
 */
function splitFold(items: TaskItem[]): { folded: TaskItem[]; visible: TaskItem[] } {
  if (items.length <= FOLD_MIN_ITEMS) return { folded: [], visible: items }
  const cutoff = items.length - VISIBLE_TAIL
  let n = 0
  while (n < cutoff && items[n].status === "done") n++
  return { folded: items.slice(0, n), visible: items.slice(n) }
}

/** 子代理折叠切分：超过 AGENT_FOLD_MIN 个时，已结束的折进「已结束 N 个」，运行中的逐条展示 */
function splitAgents(agents: ToolCallView[]): {
  folded: ToolCallView[]
  running: ToolCallView[]
} {
  const running = agents.filter((c) => c.status !== "done")
  const finished = agents.filter((c) => c.status === "done")
  if (agents.length <= AGENT_FOLD_MIN || finished.length < 2) {
    return { folded: [], running: agents }
  }
  return { folded: finished, running }
}

/** 三态圆点（15px）：done=success 实底白勾 / failed=destructive 实底叉 / active=primary 半填 / pending=input 空心 */
function TaskDot({ status }: { status: TaskStatus }) {
  if (status === "done") {
    return (
      <span className="flex size-[15px] shrink-0 items-center justify-center rounded-full bg-success">
        <Check className="size-[9px] text-primary-foreground" strokeWidth={3.5} />
      </span>
    )
  }
  if (status === "failed") {
    return (
      <span className="flex size-[15px] shrink-0 items-center justify-center rounded-full bg-destructive">
        <X className="size-[9px] text-primary-foreground" strokeWidth={3.5} />
      </span>
    )
  }
  if (status === "active") {
    return (
      <span className="size-[15px] shrink-0 rounded-full border-2 border-primary [background:linear-gradient(90deg,var(--primary)_50%,transparent_50%)]" />
    )
  }
  return <span className="size-[15px] shrink-0 rounded-full border-[1.5px] border-input" />
}

function TaskItemRow({ item }: { item: TaskItem }) {
  return (
    <div className="flex items-center gap-2 text-[12.5px] leading-[1.5]">
      <TaskDot status={item.status} />
      <span
        className={cn(
          "min-w-0 truncate",
          item.status === "pending" && "text-muted-foreground",
          // zcode 形态：已完成条目删除线 + 弱化
          item.status === "done" && "text-muted-foreground line-through"
        )}
      >
        {item.label}
        {item.status === "active" && (
          <span className="text-muted-foreground">（进行中）</span>
        )}
      </span>
    </div>
  )
}

/**
 * 折叠行（「已完成 N 项」/「已结束 N 个」）：悬停时在本行左侧弹出浮层展示被折条目、点击钉住。
 * 浮层用 fixed 定位（z 同 EntityHoverCard）：Collapse 的 overflow:hidden + max-height 会裁掉
 * 绝对定位的浮层，fixed 脱出裁剪与局部层叠；120ms 离场延迟吸收行→浮层的光标移动。
 * 不做原位展开——原位展开会改变面板高度，相邻折叠行会在光标移动中被布局位移「甩出」悬停区。
 */
function FoldedSection({ label, children }: { label: string; children: ReactNode }) {
  const rowRef = useRef<HTMLButtonElement>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [hover, setHover] = useState(false)
  const [pinned, setPinned] = useState(false)
  /** 浮层 fixed 锚点（行左上角）；每次悬停重取 */
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null)
  const open = hover || pinned

  const enter = () => {
    clearTimeout(closeTimerRef.current)
    const r = rowRef.current?.getBoundingClientRect()
    if (r) setAnchor({ top: r.top, right: window.innerWidth - r.left + 6 })
    setHover(true)
  }
  const leave = () => {
    closeTimerRef.current = setTimeout(() => setHover(false), 120)
  }

  return (
    <div>
      <button
        ref={rowRef}
        type="button"
        onClick={() => setPinned((v) => !v)}
        onMouseEnter={enter}
        onMouseLeave={leave}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 rounded-inner bg-hover-wash px-2 py-1 text-[12px] text-muted-foreground transition-colors select-none hover:text-foreground"
      >
        <ChevronLeft className="size-3 shrink-0" />
        {label}
      </button>
      {open && anchor && (
        <div
          onMouseEnter={enter}
          onMouseLeave={leave}
          className="fixed z-[3000] max-h-[70dvh] w-[min(280px,80vw)] overflow-y-auto rounded-card border border-(--chat-line-strong) bg-chat-overlay surface-plain p-2.5 shadow-2"
          style={{ top: anchor.top, right: anchor.right }}
        >
          <div className="mb-1 text-[11px] text-muted-foreground">{label}</div>
          <div className="flex flex-col gap-1">{children}</div>
        </div>
      )}
    </div>
  )
}

function TaskListSection({ list, showTitle }: { list: TaskList; showTitle: boolean }) {
  const { folded, visible } = splitFold(list.items)
  return (
    <div className="flex flex-col gap-1">
      {showTitle && <span className="text-[11px] text-muted-foreground">{list.title}</span>}
      {folded.length > 0 && (
        <FoldedSection label={`已完成 ${folded.length} 项`}>
          {folded.map((item) => (
            <TaskItemRow key={item.key} item={item} />
          ))}
        </FoldedSection>
      )}
      {visible.map((item) => (
        <TaskItemRow key={item.key} item={item} />
      ))}
    </div>
  )
}

export function ProgressPanel({
  progress,
  index,
  novelId,
  open,
  onToggleOpen,
  onClose,
}: {
  progress: ChatProgress
  index: EntityIndex
  novelId: string | null
  open: boolean
  onToggleOpen: () => void
  onClose: () => void
}) {
  const multiLists = progress.lists.length > 1
  const agents = splitAgents(progress.agents)
  return (
    <div
      className="chat-enter w-[340px] max-w-full rounded-card border border-(--chat-line-strong) bg-chat-overlay surface-plain shadow-2"
    >
      <div className="flex items-center gap-1.5 px-3 py-2 select-none">
        <span className="text-xs font-medium text-foreground">进程</span>
        {progress.totalCount > 0 && (
          <span
            className={cn(
              "font-mono text-[11.5px] tabular-nums",
              progress.allDone ? "text-success" : "text-muted-foreground"
            )}
          >
            成功 {progress.doneCount} / {progress.totalCount} · 失败 {progress.lists.flatMap(l => l.items).filter(i => i.status === "failed").length}
          </span>
        )}
        <div className="flex-1" />
        <button
          type="button"
          onClick={onToggleOpen}
          aria-label={open ? "收起进程面板" : "展开进程面板"}
          className="flex size-[22px] items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-hover-wash hover:text-foreground"
        >
          {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭进程面板"
          className="flex size-[22px] items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-hover-wash hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </div>
      {/* 面板一直被内容撑开、不出滚动条：过长由「已完成/已结束」折叠吸收，不设 max-height */}
      <Collapse open={open}>
        <div className="flex flex-col gap-1 px-3 pb-2.5">
          {progress.lists.map((list) => (
            <TaskListSection key={list.key} list={list} showTitle={multiLists} />
          ))}
          {progress.agents.length > 0 && (
            <div
              className={cn(
                "flex flex-col gap-1",
                progress.lists.length > 0 && "mt-1 border-t border-(--chat-line) pt-1.5"
              )}
            >
              <span className="text-[11px] text-muted-foreground">智能体</span>
              {agents.folded.length > 0 && (
                <FoldedSection label={`已结束 ${agents.folded.length} 个`}>
                  {agents.folded.map((call) => (
                    <SubAgentRow
                      key={call.toolCallId}
                      call={call}
                      index={index}
                      novelId={novelId}
                    />
                  ))}
                </FoldedSection>
              )}
              {agents.running.map((call) => (
                <SubAgentRow key={call.toolCallId} call={call} index={index} novelId={novelId} />
              ))}
            </div>
          )}
        </div>
      </Collapse>
    </div>
  )
}
