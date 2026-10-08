"use client"

/**
 * 子代理运行回放的只读视图（§7.3，拍板：一律只读、无输入框不开放追问）。
 * 头部：类型图标 + {名称}子代理 · {任务} + mono 副题（状态 · 约 N 墨滴 · 独立上下文）；
 * 评委：评分 + 逐条意见（aspect/issue/suggestion，excerpt 走稿纸引用块）；
 * 读者：评分 + 总评 + 试读感受分节。running 中 3s 轮询，done/error 停止。
 */
import { useQuery } from "@tanstack/react-query"
import {
  AlertCircle,
  BookOpen,
  Clapperboard,
  Drama,
  Gavel,
  Loader2,
  PenLine,
  ShieldCheck,
  TrendingUp,
  UserRound,
  Users,
} from "lucide-react"

import { apiGet } from "./api"
import type { ContentPanelProps } from "./registry"

interface SubAgentRunView {
  id: string
  agentKind: string
  task: string
  status: string
  transcript: unknown
  result: unknown
  tokenUsage: unknown
  errorMessage: string | null
  createdAt: string
  updatedAt: string
}

interface JudgeTranscript {
  score?: number
  comments?: { aspect?: string; issue?: string; suggestion?: string; excerpt?: string }[]
  /** judge.whole（整书审视）：按环节路由的待办 */
  findings?: { targetNode?: string; issue?: string; suggestion?: string }[]
}

interface ReaderTranscript {
  score?: number
  impressions?: { aspect?: string; detail?: string }[]
  summary?: string
}

/** 角色子代理（历史档案兼容，2026-09 角色团试读已下线）：旧 run 的 transcript 形状 */
interface CharacterTranscript {
  score?: number
  dimensions?: { dimension?: string; score?: number }[]
  summary?: string
  suggestion?: string
  comments?: { aspect?: string; dimension?: string; issue?: string; suggestion?: string; excerpt?: string }[]
}

interface EditorTranscript {
  score?: number
  verdict?: string
  risks?: string[]
  suggestions?: string[]
}

interface PlaywrightTranscript {
  name?: string
  title?: string
  description?: string
  summary?: string
  chapters?: { index?: number; title?: string; outline?: string }[]
  questions?: string[]
}

interface WriterTranscript {
  wordCount?: number
  preview?: string
}

const KIND_META: Record<string, { label: string; Icon: typeof Gavel }> = {
  judge: { label: "审稿人子代理", Icon: Gavel },
  reader: { label: "读者子代理", Icon: BookOpen },
  character: { label: "角色子代理", Icon: UserRound },
  editor: { label: "平台编辑子代理", Icon: TrendingUp },
  playwright: { label: "剧作家子代理", Icon: Drama },
  writer: { label: "写手子代理", Icon: PenLine },
  // 情景试验场多代理（transcript 均为 { prompt, output }）
  scenarioActor: { label: "扮演者子代理", Icon: Users },
  scenarioDirector: { label: "导演子代理", Icon: Clapperboard },
  scenarioCheck: { label: "一致性检查子代理", Icon: ShieldCheck },
  scenarioWriter: { label: "样文写手子代理", Icon: PenLine },
}

const SCENARIO_KINDS = new Set([
  "scenarioActor",
  "scenarioDirector",
  "scenarioCheck",
  "scenarioWriter",
])

function usageTotal(tokenUsage: unknown): number | null {
  const u = tokenUsage as { input?: unknown; output?: unknown } | null
  if (u && typeof u.input === "number" && typeof u.output === "number") {
    return u.input + u.output
  }
  return null
}

function ScoreBlock({ score }: { score: number }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="font-mono text-2xl font-semibold text-primary tabular-nums">
        {Math.round(score)}
      </span>
      <span className="text-xs text-muted-foreground">/ 100</span>
    </div>
  )
}

function JudgeReplay({ transcript }: { transcript: JudgeTranscript }) {
  const comments = Array.isArray(transcript.comments) ? transcript.comments : []
  const findings = Array.isArray(transcript.findings) ? transcript.findings : []
  return (
    <div className="flex flex-col gap-3">
      {typeof transcript.score === "number" && <ScoreBlock score={transcript.score} />}
      {comments.length > 0 && (
        <div className="flex flex-col gap-2.5">
          {comments.map((c, i) => (
            <div
              key={i}
              className="rounded-inner border border-border bg-card px-3 py-2 text-[12.5px] leading-[1.7]"
            >
              <div className="font-medium text-foreground">{c.aspect || "综合"}</div>
              {c.issue && <div className="mt-0.5 text-foreground/85">{c.issue}</div>}
              {c.suggestion && (
                <div className="mt-0.5 text-muted-foreground">建议：{c.suggestion}</div>
              )}
              {c.excerpt && <div className="comment-quote mt-1.5">{c.excerpt}</div>}
            </div>
          ))}
        </div>
      )}
      {findings.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="text-[12px] font-medium text-muted-foreground">
            路由回各环节的待办（{findings.length}）
          </div>
          {findings.map((f, i) => (
            <div
              key={i}
              className="rounded-inner border border-border bg-card px-3 py-2 text-[12.5px] leading-[1.7]"
            >
              <div className="font-mono text-[11px] text-primary">{f.targetNode}</div>
              {f.issue && <div className="mt-0.5 text-foreground/85">{f.issue}</div>}
              {f.suggestion && (
                <div className="mt-0.5 text-muted-foreground">建议：{f.suggestion}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ReaderReplay({ transcript }: { transcript: ReaderTranscript }) {
  const impressions = Array.isArray(transcript.impressions) ? transcript.impressions : []
  return (
    <div className="flex flex-col gap-3">
      {typeof transcript.score === "number" && <ScoreBlock score={transcript.score} />}
      {transcript.summary && (
        <p className="text-[13px] leading-[1.7] text-foreground/90">{transcript.summary}</p>
      )}
      {impressions.length > 0 && (
        <div className="flex flex-col gap-2.5">
          {impressions.map((imp, i) => (
            <div
              key={i}
              className="rounded-inner border border-border bg-card px-3 py-2 text-[12.5px] leading-[1.7]"
            >
              <div className="font-medium text-foreground">{imp.aspect || "感受"}</div>
              {imp.detail && <div className="mt-0.5 text-foreground/85">{imp.detail}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function CharacterReplay({ transcript }: { transcript: CharacterTranscript }) {
  const dimensions = Array.isArray(transcript.dimensions) ? transcript.dimensions : []
  const comments = Array.isArray(transcript.comments) ? transcript.comments : []
  return (
    <div className="flex flex-col gap-3">
      {typeof transcript.score === "number" && <ScoreBlock score={transcript.score} />}
      {dimensions.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {dimensions.map((d, i) => (
            <div key={i} className="flex items-center gap-2 text-[12.5px]">
              <span className="w-20 shrink-0 text-muted-foreground">{d.dimension ?? "维度"}</span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <span
                  className="block h-full rounded-full bg-primary"
                  style={{ width: `${Math.min(100, Math.max(0, d.score ?? 0))}%` }}
                />
              </span>
              <span className="w-8 text-right font-mono text-[12px] font-semibold text-foreground">
                {d.score ?? "—"}
              </span>
            </div>
          ))}
        </div>
      )}
      {transcript.summary && (
        <p className="text-[13px] leading-[1.7] text-foreground/90">{transcript.summary}</p>
      )}
      {transcript.suggestion && (
        <p className="text-[12.5px] leading-[1.7] text-muted-foreground">
          建议：{transcript.suggestion}
        </p>
      )}
      {comments.length > 0 && (
        <div className="flex flex-col gap-2.5">
          {comments.map((c, i) => (
            <div
              key={i}
              className="rounded-inner border border-border bg-card px-3 py-2 text-[12.5px] leading-[1.7]"
            >
              <div className="font-medium text-foreground">{c.aspect || c.dimension || "综合"}</div>
              {c.issue && <div className="mt-0.5 text-foreground/85">{c.issue}</div>}
              {c.suggestion && (
                <div className="mt-0.5 text-muted-foreground">建议：{c.suggestion}</div>
              )}
              {c.excerpt && <div className="comment-quote mt-1.5">{c.excerpt}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function EditorReplay({ transcript }: { transcript: EditorTranscript }) {
  const risks = Array.isArray(transcript.risks) ? transcript.risks : []
  const suggestions = Array.isArray(transcript.suggestions) ? transcript.suggestions : []
  return (
    <div className="flex flex-col gap-3">
      {typeof transcript.score === "number" && <ScoreBlock score={transcript.score} />}
      {transcript.verdict && (
        <p className="text-[13px] leading-[1.7] font-medium text-foreground/90">
          {transcript.verdict}
        </p>
      )}
      {risks.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="text-[12px] font-medium text-muted-foreground">风险</div>
          {risks.map((r, i) => (
            <div key={i} className="rounded-inner border border-border bg-card px-3 py-2 text-[12.5px] leading-[1.7] text-foreground/85">
              {r}
            </div>
          ))}
        </div>
      )}
      {suggestions.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="text-[12px] font-medium text-muted-foreground">方向建议</div>
          {suggestions.map((s, i) => (
            <div key={i} className="rounded-inner border border-border bg-card px-3 py-2 text-[12.5px] leading-[1.7] text-foreground/85">
              {s}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function PlaywrightReplay({ transcript }: { transcript: PlaywrightTranscript }) {
  const chapters = Array.isArray(transcript.chapters) ? transcript.chapters : []
  const questions = Array.isArray(transcript.questions) ? transcript.questions : []
  const title = transcript.name ?? transcript.title ?? null
  const body = transcript.description ?? transcript.summary ?? null
  return (
    <div className="flex flex-col gap-3">
      {title && <div className="text-[14px] font-semibold text-foreground">{title}</div>}
      {body && (
        <div className="rounded-inner border border-border bg-card px-3 py-2 text-[12.5px] leading-[1.7] whitespace-pre-wrap text-foreground/85">
          {body}
        </div>
      )}
      {chapters.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="text-[12px] font-medium text-muted-foreground">
            章节框架（{chapters.length}）
          </div>
          {chapters.map((c, i) => (
            <div key={i} className="rounded-inner border border-border bg-card px-3 py-2 text-[12.5px] leading-[1.7]">
              <span className="font-medium text-foreground">
                {c.index != null ? `第 ${c.index} 章` : "·"}《{c.title}》
              </span>
              {c.outline && <span className="text-foreground/75">　{c.outline}</span>}
            </div>
          ))}
        </div>
      )}
      {questions.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="text-[12px] font-medium text-muted-foreground">需要作者拍板的问题</div>
          {questions.map((q, i) => (
            <div key={i} className="rounded-inner border border-border bg-card px-3 py-2 text-[12.5px] leading-[1.7] text-foreground/85">
              {q}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function WriterReplay({ transcript }: { transcript: WriterTranscript }) {
  return (
    <div className="flex flex-col gap-3">
      {typeof transcript.wordCount === "number" && (
        <div className="font-mono text-[13px] text-foreground tabular-nums">
          正文 {transcript.wordCount.toLocaleString()} 字已落库
        </div>
      )}
      {transcript.preview && (
        <div className="rounded-inner border border-border bg-card px-3 py-2 text-[12.5px] leading-[1.7] whitespace-pre-wrap text-foreground/85">
          {transcript.preview}…
        </div>
      )}
      <div className="text-[12px] text-muted-foreground">完整正文请打开对应章节正文 tab 阅读。</div>
    </div>
  )
}

interface ScenarioTranscript {
  prompt?: string
  output?: unknown
}

/** 情景试验场四类子代理的通用回放：输出全文（JSON 或纯文本样文）+ 可折叠的输入上下文 */
function ScenarioReplay({ transcript }: { transcript: ScenarioTranscript }) {
  const outputText =
    transcript.output === undefined || transcript.output === null
      ? null
      : typeof transcript.output === "string"
        ? transcript.output
        : JSON.stringify(transcript.output, null, 2)
  return (
    <div className="flex flex-col gap-3">
      {outputText && (
        <div className="flex flex-col gap-1.5">
          <div className="text-[12px] font-medium text-muted-foreground">输出</div>
          <div className="rounded-inner border border-border bg-card px-3 py-2 font-mono text-[12px] leading-[1.7] whitespace-pre-wrap text-foreground/85">
            {outputText}
          </div>
        </div>
      )}
      {transcript.prompt && (
        <details className="rounded-inner border border-border bg-card px-3 py-2">
          <summary className="cursor-pointer text-[12px] font-medium text-muted-foreground select-none">
            输入上下文（{transcript.prompt.length.toLocaleString()} 字）
          </summary>
          <div className="mt-2 text-[12px] leading-[1.7] whitespace-pre-wrap text-foreground/75">
            {transcript.prompt}
          </div>
        </details>
      )}
    </div>
  )
}

export function SubAgentPanel({ refId }: ContentPanelProps) {
  const { data, isLoading } = useQuery({
    queryKey: ["subagent-run", refId],
    queryFn: () => apiGet<{ run: SubAgentRunView }>(`/api/subagent-runs/${refId}`, "加载子代理记录失败"),
    enabled: !!refId,
    refetchInterval: (query) => (query.state.data?.run.status === "running" ? 3000 : false),
  })

  const run = data?.run
  const meta = run ? (KIND_META[run.agentKind] ?? KIND_META.judge) : null
  const total = usageTotal(run?.tokenUsage)

  if (isLoading || !run || !meta) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" />
        加载子代理记录…
      </div>
    )
  }

  const statusText =
    run.status === "running" ? "运行中" : run.status === "done" ? "已完成" : "已中断"

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[720px] flex-col gap-4 px-6 py-6">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <meta.Icon className="size-4 shrink-0 text-primary" />
            <h2 className="text-[15px] font-semibold text-foreground">
              {meta.label} · {run.task}
            </h2>
          </div>
          <div className="font-mono text-[11.5px] text-muted-foreground">
            {statusText}
            {total != null && ` · 约 ${total.toLocaleString()} 墨滴`} · 独立上下文 · 只读回放
          </div>
        </div>

        {run.status === "running" && (
          <div className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            子代理运行中，完成后自动刷新
          </div>
        )}

        {run.status === "error" && (
          <div className="flex items-start gap-2 rounded-inner border border-destructive/25 bg-destructive/6 px-3 py-2 text-[12.5px] text-destructive">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
            {run.errorMessage ?? "运行中断"}
          </div>
        )}

        {run.status === "done" &&
          (SCENARIO_KINDS.has(run.agentKind) ? (
            <ScenarioReplay transcript={(run.transcript ?? {}) as ScenarioTranscript} />
          ) : run.agentKind === "reader" ? (
            <ReaderReplay transcript={(run.transcript ?? {}) as ReaderTranscript} />
          ) : run.agentKind === "character" ? (
            <CharacterReplay transcript={(run.transcript ?? {}) as CharacterTranscript} />
          ) : run.agentKind === "editor" ? (
            <EditorReplay transcript={(run.transcript ?? {}) as EditorTranscript} />
          ) : run.agentKind === "playwright" ? (
            <PlaywrightReplay transcript={(run.transcript ?? {}) as PlaywrightTranscript} />
          ) : run.agentKind === "writer" ? (
            <WriterReplay transcript={(run.transcript ?? {}) as WriterTranscript} />
          ) : (
            <JudgeReplay transcript={(run.transcript ?? {}) as JudgeTranscript} />
          ))}
      </div>
    </div>
  )
}
