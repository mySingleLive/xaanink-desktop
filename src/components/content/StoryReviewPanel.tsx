"use client"
import { ScoreReportSections } from "@/components/score/ScoreReportPanel"
import { Button } from "@/components/ui/button"
import { useChatStore } from "@/stores/chat"
import { useStoryWorkflow } from "./StoryWorkflowPanel"
import type { ContentPanelProps } from "./registry"
import { useQuery } from "@tanstack/react-query"
import { apiGet } from "./api"
import { parseCheckpointKey, STORY_PHASE_STATUS, type StoryCheckpoint, type StoryPhaseStatus, type StoryWorkflowView } from "@/lib/story-workflow"
import { buildTabId, useTabsStore } from "@/stores/tabs"
import { ArrowUpRight } from "lucide-react"
import type { ScoreReviewContext } from "@/lib/score-types"

/** 设定/环节复用评分页的维度、意见卡和回放；正文继续使用原评分视图。无 refId 时为「创作评审」总览：列出全部检查点并可进入单项。 */
export function StoryReviewPanel({ novelId, refId: key = "" }: ContentPanelProps) {
  const query = useStoryWorkflow(novelId, useChatStore(s => s.isGenerating)), workflow = query.data?.workflow
  const check = workflow?.checkpoints[key], artifact = workflow?.artifacts.find(a => a.key === key)
  // plot 子键（phase:plot:worldline / phase:plot:narrative）按子键解析标题与当前指纹
  const parsed = key.startsWith("phase:") ? parseCheckpointKey(key) : null
  const phase = parsed ? workflow?.phases.find(p => p.id === parsed.phase) : undefined
  const sub = parsed?.sub ? phase?.subkeys?.find(s => s.key === key) : undefined
  const running = useChatStore(s => s.isGenerating)
  const history = useQuery({ queryKey: ["story-review-history", novelId, key], enabled: !!key, queryFn: () => apiGet<{ checks: StoryCheckpoint[]; reviewing: boolean; reviewTurnIds: string[]; reviewContext: ScoreReviewContext | null }>(`/api/novels/${novelId}/story-workflow?review=${encodeURIComponent(key)}`, "读取评审历史失败"), refetchInterval: running ? 3000 : false })
  if (!key) return <StoryReviewHub novelId={novelId} workflow={workflow} loading={query.isLoading} isError={query.isError} retry={() => query.refetch()} />
  const title = artifact?.title ?? (sub ? `${sub.label}检查点` : phase?.label) ?? "创作检查点"
  const stale = !!check && check.hash !== (artifact?.evidenceHash ?? sub?.hash ?? phase?.hash)
  const discuss = (draft: string) => useChatStore.getState().requestNewConversation({ novelId, draft })
  /** 引用序列展示段清洗：半角方括号/括号与换行是序列定界符，标题里出现会破坏芯片解析 */
  const chipTitle = title.replace(/[\]\[\(\)\n]/g, "")
  if (query.isLoading) return <div className="p-5 text-sm text-muted-foreground">正在读取评审…</div>
  if (query.isError) return <div className="p-5"><p>评审暂时读取失败</p><Button onClick={() => query.refetch()}>重试</Button></div>
  return <div className="h-full overflow-auto"><div className="scorepage-inner">
    <div className="sp-card sp-head"><div className="min-w-0"><div className="sp-title">{title}</div><div className="sp-meta">{check ? `${check.score === null ? "结构检查（无 AI 打分）" : `${check.score} / 100`} · ${stale ? "当前修订待重评" : check.passed ? "已达标" : "待改进"}` : "尚未评审"}</div></div>
      <div className="sp-actions"><Button size="sm" onClick={() => discuss(`请读取并按评审意见改进「${title}」，再检查当前版本。`)}>按意见改进</Button><Button size="sm" variant="outline" onClick={() => discuss(`请对「${title}」当前版本重新评审。检查点：@[检查点/${chipTitle}](${key})。`)}>重新评审</Button></div></div>
    {check?.coverage && <p className="px-1 text-sm text-muted-foreground">检查范围：{check.coverage.artifactCount} 项产物全文，分 {check.coverage.partCount} 段核对；分段记录保留，中断后可继续。</p>}
    <ScoreReportSections novelId={novelId} emptyHint="完成这项创作内容后，墨影会自动评审。你也可以在聊天中要求重新检查。" report={{
      targetType: "STORY_ARTIFACT", targetId: key, targetLabel: title, contentKind: "outline", supportsReaderPanel: false,
      score: check?.score ?? null, scoredAt: check?.at ?? null, stale, reviewing: history.data?.reviewing ?? false, reviewTurnIds: history.data?.reviewTurnIds ?? [], reviewContext: history.data?.reviewContext ?? null, contentEmpty: !artifact && !phase,
      dimensions: check?.dimensions ?? [], agents: check ? [{ kind: "judge", name: "AI 评审员", score: check.score, summary: check.summary, at: check.at, runId: check.runId, items: check.issues.map(i => ({ aspect: i.needsAuthor ? "需要作者决定" : i.blocking ? "必须修正" : "创作建议", issue: i.issue, suggestion: i.suggestion })) }] : [],
      history: (history.data?.checks ?? (check ? [check] : [])).map(item => ({ at: item.at, score: item.score, source: "评委", summary: `第${item.iteration}次检查 · ${item.summary}` })),
    }} />
  </div></div>
}

/** 「创作评审」总览（侧栏常驻入口，无 refId）：全部环节与产物检查点的评分/状态列表，点击进入单项评审。 */
function StoryReviewHub({ novelId, workflow, loading, isError, retry }: { novelId: string; workflow: StoryWorkflowView | null | undefined; loading: boolean; isError: boolean; retry: () => void }) {
  const openTab = useTabsStore(s => s.openTab)
  const showReview = (key: string, label: string) => openTab({ id: buildTabId("story-review", novelId, { refId: key }), type: "story-review", novelId, refId: key, title: `评审 · ${label}` })
  if (loading) return <div className="p-5 text-sm text-muted-foreground">正在读取评审…</div>
  if (isError) return <div className="p-5"><p className="text-sm">评审暂时读取失败</p><Button variant="outline" className="mt-2" onClick={retry}>重试</Button></div>
  const phaseRows = (workflow?.phases ?? []).flatMap(p => p.subkeys
    ? p.subkeys.filter(s => workflow!.checkpoints[s.key]).map(s => ({ key: s.key, label: `${p.label} · ${s.label}`, status: s.status, score: s.score }))
    : workflow!.checkpoints[`phase:${p.id}`] ? [{ key: `phase:${p.id}`, label: p.label, status: p.status, score: p.score }] : [])
  const artifactRows = (workflow?.artifacts ?? []).filter(a => workflow!.checkpoints[a.key]).map(a => {
    const check = workflow!.checkpoints[a.key]
    const needsApproval = a.phase === "settings" || (a.phase === "writing" && workflow!.writingMode === "chapter")
    const status: StoryPhaseStatus = check.hash !== a.evidenceHash ? "stale" : !check.passed ? "improve"
      : needsApproval && workflow!.approvals[a.key]?.hash !== a.evidenceHash ? "approval" : "passed"
    return { key: a.key, label: a.title, status, score: check.score }
  })
  const rows = [...phaseRows, ...artifactRows]
  return <div className="h-full overflow-auto p-5">
    <h2 className="font-serif text-2xl">创作评审</h2>
    <p className="mb-5 mt-2 text-xs text-muted-foreground">全部创作检查点的评分与意见；完成创作内容后墨影会自动评审，也可在单项里重新评审。</p>
    {!rows.length && <p className="text-sm text-muted-foreground">尚无评审记录。在聊天中完成创作内容后，这里会列出各环节与产物的评分。</p>}
    <div className="space-y-2">{rows.map(row => <button key={row.key} type="button" className="flex w-full items-center justify-between gap-3 rounded-lg border border-border p-3 text-left text-sm hover:bg-hover-wash" onClick={() => showReview(row.key, row.label)}>
      <span className="min-w-0 truncate">{row.label}</span>
      <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">{STORY_PHASE_STATUS[row.status]}{row.score !== null ? ` · ${row.score} 分` : ""}<ArrowUpRight className="size-3.5" /></span>
    </button>)}</div>
  </div>
}
