"use client"

/**
 * AI 综合评分详情页（score tab，2026-09；视觉权威稿 design/score-indicator-preview.html）：
 * 头部大环综合分 + 操作区（按意见改进/重新评审——评审在对话面板执行：章正文全量=评委+读者团，
 * 章/卷大纲=仅评委，过程走对话工具行/子代理行实时呈现）→ 多维度评分 →
 * Agent 评价卡（评委逐条意见含原文引用；读者团人设卡）→ 评审历史；空态给发起引导。
 * refId 为复合值 `${targetType}:${targetId}`（buildTabId 同款拼法）。
 * 头部以下的内容区块已抽出为 ScoreReportSections 共用。
 */
import { useMemo, useState } from "react"
import { BookOpen, RefreshCw, Sparkles, Square, WandSparkles } from "lucide-react"

import { Button } from "@/components/ui/button"
import { buildTabId, useTabsStore } from "@/stores/tabs"
import { useChatStore } from "@/stores/chat"

import type { ContentPanelProps } from "../content/registry"
import { ImproveContentDialog } from "./ImproveContentDialog"
import { isCommentableScoreTarget, ReviewCommentsSection } from "./ReviewCommentsSection"
import { improveMessage } from "@/lib/card-select-actions"
import { dispatchChatSendMessage } from "@/components/chat/ui-events"
import {
  candidateReviewFeedback,
  formatScoreTime,
  formatScoreTimeFull,
  improveActionLabel,
  improveDraftFor,
  improveActionFor,
  scoreBand,
  SCORE_BAND_VAR,
  useScoreReport,
  useStartCandidateReview,
  useStartScoreReview,
  useStopScoreReview,
  type ScoreAgentEntry,
  type ScoreAgentItem,
  type ScoreReport,
  type ScoreTargetType,
} from "./use-score-report"

const TARGET_TYPES: readonly string[] = [
  "CHAPTER_CONTENT",
  "CHAPTER_OUTLINE",
  "VOLUME_OUTLINE",
]

/** 单个维度行（详情页大号条） */
function DimensionRow({ dimension, score, count }: { dimension: string; score: number; count: number }) {
  const band = scoreBand(score)!
  return (
    <div className="sp-dim" style={{ ["--score-c" as string]: SCORE_BAND_VAR[band] }}>
      <span className="sd-label">{dimension}</span>
      <span className="sd-track">
        <span className="sd-fill" style={{ width: `${score}%` }} />
      </span>
      <span className="sd-num">{score}</span>
      <span className="sd-count">{count > 0 ? `${count} 条意见` : "无意见"}</span>
    </div>
  )
}

/** 评委/读者评价卡（judge 卡按维度分块：维度名大字 + 该维分数 + 意见明细，不用气泡） */
function AgentCard({
  agent,
  dimensions,
  onOpenReplay,
}: {
  agent: ScoreAgentEntry
  /** 仅评委卡用：逐维分数（来自当次评审；旧数据无则空数组走平铺降级） */
  dimensions?: { dimension: string; score: number }[]
  onOpenReplay: (runId: string, name: string) => void
}) {
  const band = scoreBand(agent.score)

  // 逐维归集意见；aspect 不在维度名单的归入「其他意见」（旧数据兼容）
  const dimList = dimensions ?? []
  const matched = new Set<string>()
  const byDim = dimList.map((d) => {
    const items = agent.items.filter((i) => {
      const hit = i.aspect === d.dimension
      if (hit) matched.add(i.aspect)
      return hit
    })
    return { dimension: d.dimension, score: d.score, items }
  })
  const others = agent.items.filter((i) => !matched.has(i.aspect) && !dimList.some((d) => d.dimension === i.aspect))

  const renderItem = (item: ScoreAgentItem, i: number) => (
    <div key={i} className="sp-comment">
      {item.issue && <div className="sc-issue">{item.issue}</div>}
      {item.suggestion && (
        <div className="sc-sugg">
          <b>建议：</b>
          {item.suggestion}
        </div>
      )}
      {item.excerpt && <div className="sc-quote">{item.excerpt}</div>}
    </div>
  )

  return (
    <div className="sp-agent">
      <div className="sa-head">
        <span className={agent.kind === "reader" ? "sa-avatar reader" : "sa-avatar"}>
          {agent.kind === "reader" ? <BookOpen className="size-3.5" /> : <Sparkles className="size-3.5" />}
        </span>
        <span className="sa-name">{agent.name}</span>
        <span className="sa-time">{formatScoreTime(agent.at)}</span>
        {agent.runId && (
          <button
            type="button"
            className="sa-replay"
            onClick={() => onOpenReplay(agent.runId!, agent.name)}
          >
            查看回放 ›
          </button>
        )}
        {agent.score !== null && band && (
          <span className="sa-score" style={{ ["--score-c" as string]: SCORE_BAND_VAR[band] }}>
            {agent.score}
            <small> /100</small>
          </span>
        )}
      </div>
      {agent.kind === "judge" ? (
        dimList.length > 0 ? (
          <>
            {byDim.map((g) => {
              const gb = scoreBand(g.score)!
              return (
                <div key={g.dimension} className="sp-dimblock">
                  <div className="sp-dimhead" style={{ ["--score-c" as string]: SCORE_BAND_VAR[gb] }}>
                    <span className="sp-dimname">{g.dimension}</span>
                    <span className="sd-track">
                      <span className="sd-fill" style={{ width: `${g.score}%` }} />
                    </span>
                    <span className="sp-dimscore">{g.score}</span>
                  </div>
                  {g.items.length > 0 ? (
                    g.items.map(renderItem)
                  ) : (
                    <div className="sp-dimok">本维无意见</div>
                  )}
                </div>
              )
            })}
            {others.length > 0 && (
              <div className="sp-dimblock">
                <div className="sp-dimhead">
                  <span className="sp-dimname">其他意见</span>
                </div>
                {others.map(renderItem)}
              </div>
            )}
          </>
        ) : agent.items.length > 0 ? (
          // 旧评审数据无维度分：平铺意见，维度名作粗体小标题（不用气泡）
          agent.items.map((item, i) => (
            <div key={i} className="sp-comment">
              <div className="sc-dimname">{item.aspect}</div>
              {item.issue && <div className="sc-issue">{item.issue}</div>}
              {item.suggestion && (
                <div className="sc-sugg">
                  <b>建议：</b>
                  {item.suggestion}
                </div>
              )}
              {item.excerpt && <div className="sc-quote">{item.excerpt}</div>}
            </div>
          ))
        ) : (
          <div className="sa-summary">本轮评审无意见——各维度检查全部通过。</div>
        )
      ) : (
        <>
          {agent.summary && <div className="sa-summary">{agent.summary}</div>}
          {agent.items.map((item, i) => (
            <div key={i} className="sa-imp">
              <b>{item.aspect}</b>
              {item.detail ? `：${item.detail}` : ""}
            </div>
          ))}
        </>
      )}
    </div>
  )
}

/**
 * 评分内容区块（头部以下）：空态引导 / 多维度评分 / Agent 评价卡 / 行内评论 / 评审历史。
 * 章/卷评分详情页的内容区（emptyHint 覆盖空态文案）。
 */
export function ScoreReportSections({
  novelId,
  report,
  emptyHint,
}: {
  novelId: string
  report: Omit<ScoreReport, "targetType"> & { targetType: ScoreReport["targetType"] | "STORY_ARTIFACT" }
  /** 空态提示覆盖；缺省按 contentKind 拼「请先生成…」 */
  emptyHint?: string
}) {
  const openTab = useTabsStore((s) => s.openTab)
  const judge = report.agents.find((a) => a.kind === "judge")
  const readers = report.agents.filter((a) => a.kind === "reader")
  const openReplay = (runId: string, name: string) =>
    openTab({
      id: buildTabId("subagent", novelId, { refId: runId }),
      type: "subagent",
      novelId,
      refId: runId,
      title: `评审回放 · ${name}`,
    })

  // 每个维度的意见条数（评委卡条目按 aspect 归集）
  const dimCommentCount = useMemo(() => {
    const map = new Map<string, number>()
    for (const item of judge?.items ?? []) {
      map.set(item.aspect, (map.get(item.aspect) ?? 0) + 1)
    }
    return map
  }, [judge])

  return (
    <>
    {report.score === null && report.agents.length === 0 ? (
      /* 空态引导（有读者团卡时不再拦——先跑试读再评审也即时可见） */
      <div className="sp-card">
        <div className="sp-empty">
          <Sparkles className="ic-big size-7" />
          <div>还没有评分</div>
          <div className="tip">
            {emptyHint ??
              (report.contentEmpty
                ? `请先生成${report.contentKind === "prose" ? "正文" : "大纲"}内容，再让 AI 评审员逐维度打分并给出修改建议。`
                // 候选稿/大纲类不支持读者团，空态引导不提试读
                : `点上方「发起评审」，AI 评审员会逐维度打分并给出修改建议${report.supportsReaderPanel ? "；章正文还会同时让三位读者试读" : ""}。`)}
          </div>
        </div>
      </div>
    ) : (
      <>
        {/* 多维度评分 */}
        {report.dimensions.length > 0 && (
          <div className="sp-card">
            <div className="sp-sec-title">
              多维度评分 <span className="n">评委 · {report.dimensions.length} 维</span>
            </div>
            {report.dimensions.map((d) => (
              <DimensionRow
                key={d.dimension}
                dimension={d.dimension}
                score={d.score}
                count={dimCommentCount.get(d.dimension) ?? 0}
              />
            ))}
          </div>
        )}

        {/* Agent 评价（评委+读者；角色卡独立成区不计入） */}
        {(judge || readers.length > 0) && (
        <div>
          <div className="sp-sec-title" style={{ padding: "0 2px" }}>
            Agent 评价 <span className="n">{(judge ? 1 : 0) + readers.length} 位</span>
          </div>
          {judge && (
            <AgentCard agent={judge} dimensions={report.dimensions} onOpenReplay={openReplay} />
          )}
          {readers.length > 0 && (
            <div className="sp-readers" style={{ marginTop: 10 }}>
              {readers.map((r) => (
                <AgentCard key={r.runId ?? r.name} agent={r} onOpenReplay={openReplay} />
              ))}
            </div>
          )}
        </div>
        )}

      </>
    )}
        {/* 评审历史 */}
        {report.history.length > 0 && (
          <div className="sp-card sp-history">
            <div className="sp-sec-title">
              评审历史 <span className="n">{report.history.length} 次</span>
            </div>
            {report.history.map((h, i) => {
              const hb = scoreBand(h.score)
              return (
                <div key={i} className="sh-row">
                  <span className="sh-date">{formatScoreTime(h.at)}</span>
                  <span className="sh-src">{h.source}</span>
                  <span className="sh-sum">{h.summary}</span>
                  <span
                    className="sh-score"
                    style={hb ? { ["--score-c" as string]: SCORE_BAND_VAR[hb] } : undefined}
                  >
                    {h.score ?? "—"}
                  </span>
                </div>
              )
            })}
          </div>
        )}
        {!!report.candidateReports?.length && !report.candidateId && <div className="sp-card"><div className="sp-sec-title">候选评分</div><p className="text-sm text-muted-foreground">以下评分对应候选稿；请在正文面板的「候选稿」中比较并决定是否采用。</p>{report.candidateReports.map(candidate => <p key={candidate.reviewId} className="text-sm">{formatScoreTime(candidate.at)} · {candidate.score ?? "未评"} 分</p>)}</div>}
        {/* 行内评论（章正文/章大纲/候选稿）：全部评论卡（作者+AI）+ 添加评论；卡片与正文视图同款 */}
        {report.targetType !== "STORY_ARTIFACT" && isCommentableScoreTarget(report.targetType) && (
          <ReviewCommentsSection
            novelId={novelId}
            targetType={report.targetType}
            targetId={report.targetId}
            candidateId={report.candidateId ?? undefined}
            chapterId={report.candidate?.chapterId}
            readOnly={report.candidate?.status === "discarded"}
          />
        )}

    </>
  )
}

function PanelBody({ novelId, report }: { novelId: string; report: ScoreReport }) {
  const requestNewConversation = useChatStore((s) => s.requestNewConversation)
  const { start: startScoreReview } = useStartScoreReview(novelId)
  const { start: startCandidateReview } = useStartCandidateReview(novelId)
  const { stop, stopping } = useStopScoreReview(novelId, report.targetType, report.targetId, report.candidateId ?? undefined)
  const busy = report.reviewing
  const band = scoreBand(report.score)
  const [improveDialogOpen, setImproveDialogOpen] = useState(false)

  const improve = () => {
    // 候选稿「按意见改进」：以该候选为底稿再抽 3 张（与候选面板「以此为基础改进」同链路），评审意见摘要折进 feedback
    if (report.candidate) {
      dispatchChatSendMessage(
        improveMessage({ chapterTitle: report.candidate.chapterTitle, label: report.candidate.variantLabel, chapterId: report.candidate.chapterId, candidateId: report.candidate.candidateId }, candidateReviewFeedback(report)),
        novelId
      )
      return
    }
    // 章正文走「正文改进对话框」（抽卡配置 + 改进项勾选）；大纲维持原直发流程
    if (report.targetType === "CHAPTER_CONTENT") setImproveDialogOpen(true)
    else requestNewConversation({ novelId, draft: improveDraftFor(report), action: improveActionFor(report), autoSend: true })
  }
  // 候选稿直连评审（评委单跑，不经对话）；章/卷维持对话全量评审
  const review = () => (report.candidateId ? startCandidateReview(report) : startScoreReview(report))

  return (
    <div className="scorepage-inner">
      {/* 头部：大环 + 对象 + 操作区 */}
      <div className="sp-card sp-head">
        {report.score !== null && band ? (
          <div className="sp-ring" style={{ ["--pct" as string]: report.score, ["--score-c" as string]: SCORE_BAND_VAR[band] }}>
            <span className="sp-num">
              {report.score}
              <small>/100</small>
            </span>
          </div>
        ) : (
          <div className="sp-ring empty">
            <span className="sp-ic">
              <Sparkles className="size-6" />
            </span>
          </div>
        )}
        <div className="min-w-0">
          <div className="sp-title">{report.targetLabel}</div>
          <div className="sp-meta">
            <span>{report.scoredAt ? `评审于 ${formatScoreTimeFull(report.scoredAt)}` : "尚未评审"}</span>
            {report.stale && <span className="sh-badge">当前修订尚无已核验评分，历史评分保留</span>}
          </div>
        </div>
        <div className="sp-actions">
          {report.score !== null && (
            <Button size="sm" disabled={busy} onClick={improve}>
              <WandSparkles />
              {report.candidateId ? "按意见改进" : improveActionLabel(report.targetType)}
            </Button>
          )}
          <Button
            size="sm"
            variant={report.score !== null ? "outline" : "default"}
            disabled={busy}
            onClick={review}
          >
            <RefreshCw className={busy ? "animate-spin" : undefined} />
            {busy ? "评审中" : report.score !== null ? "重新评审" : "发起评审"}
          </Button>
          {busy && (
            <Button size="sm" variant="outline" disabled={stopping} onClick={stop}>
              <Square />
              {stopping ? "正在停止…" : "停止评审"}
            </Button>
          )}
          <span className="cost-note">
            {report.supportsReaderPanel ? "评委 1 次 / 读者团 3 次调用" : "评审约 1 次调用"}
          </span>
        </div>
      </div>

      <ScoreReportSections novelId={novelId} report={report} />

      {improveDialogOpen && report.targetType === "CHAPTER_CONTENT" && (
        <ImproveContentDialog novelId={novelId} report={report} onClose={() => setImproveDialogOpen(false)} />
      )}
    </div>
  )
}

/** 评分详情 tab（type=score，refId=`${targetType}:${targetId}` 复合值）；candidateId 为候选稿维度（候选面板评审视图传入） */
export function ScoreReportPanel({ novelId, refId, candidateId }: ContentPanelProps & { candidateId?: string }) {
  const parsed = useMemo(() => {
    const [targetType, targetId] = (refId ?? "").split(":")
    if (!targetType || !targetId || !TARGET_TYPES.includes(targetType)) return null
    return { targetType: targetType as ScoreTargetType, targetId }
  }, [refId])

  const { data, isLoading, isError } = useScoreReport(
    novelId,
    parsed?.targetType ?? "CHAPTER_CONTENT",
    parsed?.targetId ?? "",
    !!parsed,
    candidateId
  )

  if (!parsed) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        评分目标参数不合法
      </div>
    )
  }
  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">加载中…</div>
    )
  }
  if (isError || !data) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        加载评分失败（目标可能已删除）
      </div>
    )
  }

  return (
    <div className="scorepage no-scrollbar h-full overflow-y-auto">
      <PanelBody novelId={novelId} report={data} />
    </div>
  )
}
