"use client"

/**
 * 子代理行（§7.3 + 2026-08 SOP 角色扩展）：子代理在消息流中的锚点行（与 Worked/思考行同族：
 * 左类型图标 + mono 13.5px + 右侧 chevron）。
 * 角色：judge 评委 / reader 读者团 / editor 平台编辑 / playwright 剧作家 / writer 写手
 * （writer 经 generateChapterContent 的 FileCard 呈现正文产物，不走本行）。
 * running：shimmer「{名称} · {动作}{对象}」（§7.5 文字高光流动，无省略号）；
 * done：结论一行摘要（评分/收敛轮数/墨滴单列）；
 * error：「中断」destructive。
 * 点击在右侧内容区开 subagent tab（运行回放的只读视图）。
 * 这类工具从 work-log 分流，不再渲染为普通工具行、不参与归组。
 */
import { BookOpen, ChevronRight, Drama, Gavel, TrendingUp, Users } from "lucide-react"

import { cn } from "@/lib/utils"
import { buildTabId, useTabsStore } from "@/stores/tabs"

import { summarizeOutput, type ToolCallView } from "./types"
import type { EntityIndex } from "./use-entity-index"

/** 子代理工具判定（评委/读者团/平台编辑/剧作家/总编面板） */
export function isSubAgentTool(toolName: string): boolean {
  return (
    toolName === "requestAIReview" ||
    toolName === "requestReaderReview" ||
    toolName === "assessThemeMarket" ||
    toolName === "summonPlaywright" ||
    toolName === "reviewWholeNovel"
  )
}

const TOOL_META: Record<
  string,
  { label: string; verb: string; Icon: typeof Gavel; interruptText: string }
> = {
  requestAIReview: { label: "评委子代理", verb: "评阅", Icon: Gavel, interruptText: "评审中断" },
  requestReaderReview: {
    label: "读者团子代理",
    verb: "试读",
    Icon: BookOpen,
    interruptText: "试读中断",
  },
  assessThemeMarket: {
    label: "平台编辑子代理",
    verb: "评估主题",
    Icon: TrendingUp,
    interruptText: "评估中断",
  },
  summonPlaywright: {
    label: "剧作家子代理",
    verb: "产出",
    Icon: Drama,
    interruptText: "产出中断",
  },
  reviewWholeNovel: {
    label: "总编面板",
    verb: "整书审视",
    Icon: Users,
    interruptText: "审视中断",
  },
}

const PLAYWRIGHT_KIND_LABELS: Record<string, string> = {
  world: "世界观",
  character: "角色",
  setting: "设定",
  outline: "卷大纲",
}

/** done 态一行摘要（评分/收敛/墨滴；兼容读者团新旧两种输出形态） */
function doneSummary(call: ToolCallView, output: Record<string, unknown>): string {
  const parts: string[] = []
  const usage = output.tokenUsage as { input?: unknown; output?: unknown } | undefined
  const usageTotal =
    typeof usage?.input === "number" && typeof usage?.output === "number"
      ? usage.input + usage.output
      : null

  if (call.toolName === "requestReaderReview") {
    // 新形态：读者团聚合；旧形态（历史消息）：单读者 score
    const aggregate = typeof output.aggregateScore === "number" ? output.aggregateScore : null
    const legacy = typeof output.score === "number" ? output.score : null
    const score = aggregate ?? legacy
    if (score != null) parts.push(aggregate != null ? `均分 ${score}/100` : `评分 ${score}/100`)
    if (Array.isArray(output.readers)) {
      const per = (output.readers as { label?: unknown; score?: unknown }[])
        .map((r) => (typeof r.score === "number" ? `${r.label ?? "读者"} ${r.score}` : null))
        .filter(Boolean)
        .join(" / ")
      if (per) parts.push(per)
    }
    return parts.join(" · ")
  }

  if (call.toolName === "summonPlaywright") {
    if (typeof output.chapterCount === "number") {
      parts.push(`卷框架 ${output.chapterCount} 章`)
    } else {
      if (typeof output.finalScore === "number") parts.push(`评分 ${output.finalScore}/100`)
      if (typeof output.iterations === "number") {
        parts.push(output.converged === true ? `${output.iterations} 轮收敛` : `${output.iterations} 轮未收敛`)
      }
    }
    return parts.join(" · ")
  }

  if (call.toolName === "reviewWholeNovel") {
    if (typeof output.score === "number") parts.push(`综合 ${output.score}/100`)
    const judge = output.judge as { findings?: unknown } | undefined
    if (Array.isArray(judge?.findings)) parts.push(`${judge.findings.length} 条待办`)
    return parts.join(" · ")
  }

  // requestAIReview / assessThemeMarket
  if (typeof output.score === "number") parts.push(`评分 ${output.score}/100`)
  if (Array.isArray(output.comments)) parts.push(`${output.comments.length} 条批注`)
  if (usageTotal != null) parts.push(`约 ${usageTotal.toLocaleString()} 墨滴`)
  return parts.join(" · ")
}

export function SubAgentRow({
  call,
  index,
  novelId,
}: {
  call: ToolCallView
  index: EntityIndex
  novelId: string | null
}) {
  const openTab = useTabsStore((s) => s.openTab)
  const meta = TOOL_META[call.toolName] ?? TOOL_META.requestAIReview
  const Icon = meta.Icon

  const input = (call.input ?? {}) as Record<string, unknown>
  const output = (call.output ?? {}) as Record<string, unknown>
  const targetId =
    typeof input.targetId === "string"
      ? input.targetId
      : typeof input.chapterId === "string"
        ? input.chapterId
        : null
  const chapterLabel = (targetId && index.chapterLabelById(targetId)) || null
  // 剧作家按 kind 给对象词；其余用章节标签
  const objectLabel =
    call.toolName === "summonPlaywright"
      ? PLAYWRIGHT_KIND_LABELS[typeof input.kind === "string" ? input.kind : ""] ?? null
      : chapterLabel

  const running = call.status === "running"
  const ok = call.status === "done" && summarizeOutput(call.toolName, call.input, call.output).ok
  const summary = ok ? doneSummary(call, output) : ""
  const runId = typeof output.subAgentRunId === "string" ? output.subAgentRunId : null
  const clickable = !!runId && !!novelId && !running

  const openReplay = () => {
    if (!clickable || !runId || !novelId) return
    openTab({
      id: buildTabId("subagent", novelId, { refId: runId }),
      type: "subagent",
      novelId,
      refId: runId,
      title: `${meta.label} · ${objectLabel ?? meta.verb}`,
    })
  }

  return (
    <div>
      <button
        type="button"
        onClick={openReplay}
        disabled={!clickable}
        title={clickable ? "查看子代理运行回放" : undefined}
        className={cn(
          // max-w-full + 文本 truncate：进程面板（340px 窄卡）复用本行时长摘要不溢出
          "group/sub flex w-fit max-w-full items-center gap-1.5 font-mono text-[13.5px] select-none",
          clickable
            ? "text-muted-foreground transition-colors hover:text-foreground"
            : "cursor-default text-muted-foreground"
        )}
      >
        <Icon className="size-3.5 shrink-0" />
        {running ? (
          <span className="text-shimmer min-w-0 truncate tabular-nums">
            {meta.label} · {meta.verb}
            {objectLabel ?? ""}
          </span>
        ) : ok ? (
          <span className="min-w-0 truncate tabular-nums">
            {meta.label}
            {summary && ` · ${summary}`}
          </span>
        ) : (
          <span className="min-w-0 truncate text-destructive">
            {meta.label} · {call.status === "unknown" ? "结果待确认" : meta.interruptText}
          </span>
        )}
        {clickable && (
          <ChevronRight className="size-3.5 shrink-0 opacity-0 transition-opacity group-hover/sub:opacity-100" />
        )}
      </button>
    </div>
  )
}
