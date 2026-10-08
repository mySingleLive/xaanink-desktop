"use client"

/**
 * 评分悬停浮窗（2026-09）：指示器上方弹出的可交互小卡——对象名 + 综合分 +
 * 多维度评分（进度条+数字，色温同分档）+ stale 徽标 + 操作行
 * （「按意见改进」主按钮（有评分才出现）+「发起/重新评审」+ 成本小字 + 详情提示）。
 * fixed 定位由 ScoreIndicator 计算传入；旧评审数据无 dimensions 时降级为维度标签列表。
 */
import { MessageSquare, RefreshCw, Square, WandSparkles } from "lucide-react"

import { useChatStore } from "@/stores/chat"
import { improveMessage } from "@/lib/card-select-actions"
import { dispatchChatSendMessage } from "@/components/chat/ui-events"

import {
  candidateReviewFeedback,
  formatScoreTime,
  improveActionLabel,
  improveDraftFor,
  improveActionFor,
  scoreBand,
  SCORE_BAND_VAR,
  useStartCandidateReview,
  useStartScoreReview,
  useOpenScoreReviewConversation,
  useStopScoreReview,
  type ScoreReport,
} from "./use-score-report"

export function ScoreHoverCard({
  novelId,
  report,
  pos,
  onMouseEnter,
  onMouseLeave,
  onOpenDetail,
}: {
  novelId: string
  report: ScoreReport
  pos: { left: number; bottom?: number; top?: number }
  onMouseEnter: () => void
  onMouseLeave: () => void
  onOpenDetail: () => void
}) {
  const requestNewConversation = useChatStore((s) => s.requestNewConversation)
  /* 「发起/重新评审」与评审视图同一套动作：章级=useStartScoreReview（乐观 reviewing→指示器联动 + 开新会话走对话全量评审）；
     候选稿=useStartCandidateReview（直连评委单跑，不经对话） */
  const { start: startScoreReview } = useStartScoreReview(novelId)
  const { start: startCandidateReview } = useStartCandidateReview(novelId)
  const { open: openReviewConversation } = useOpenScoreReviewConversation(novelId)
  const { stop, stopping } = useStopScoreReview(novelId, report.targetType, report.targetId, report.candidateId ?? undefined)

  const busy = report.reviewing
  const band = scoreBand(report.score)

  const improve = () => {
    // 候选稿「按意见改进」：以该候选为底稿再抽 3 张（与候选面板「以此为基础改进」同链路），意见摘要折进 feedback
    if (report.candidate) {
      dispatchChatSendMessage(
        improveMessage({ chapterTitle: report.candidate.chapterTitle, label: report.candidate.variantLabel, chapterId: report.candidate.chapterId, candidateId: report.candidate.candidateId }, candidateReviewFeedback(report)),
        novelId
      )
      return
    }
    // 改进=内容改写，走左侧对话执行（过程可见可插话）；守卫降级由 ChatPanel 订阅消费承担
    requestNewConversation({ novelId, draft: improveDraftFor(report), action: improveActionFor(report), autoSend: true })
  }

  return (
    <div
      role="tooltip"
      className="score-hover"
      style={{ left: pos.left, ...(pos.bottom !== undefined ? { bottom: pos.bottom } : { top: pos.top }) }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="sh-head">
        <span className="sh-obj">{report.targetLabel}</span>
        {report.score !== null && band && (
          <span className="sh-score" style={{ ["--score-c" as string]: SCORE_BAND_VAR[band] }}>
            {report.score}
            <small> /100</small>
          </span>
        )}
      </div>

      {report.score === null ? (
        <div className="sh-empty">
          {report.contentEmpty
            ? `还没有内容可评审——请先生成${report.contentKind === "prose" ? "正文/样文" : "大纲/样纲"}。`
            : "暂无评分。让 AI 评审员逐维度评一遍，并给出修改建议。"}
        </div>
      ) : (
        <>
          <div className="sh-time">
            评审于 {report.scoredAt ? formatScoreTime(report.scoredAt) : "—"}
            {report.stale && <span className="sh-badge">内容已修改，评分可能过时</span>}
          </div>
          {report.dimensions.length > 0 ? (
            report.dimensions.slice(0, 5).map((d) => {
              const db = scoreBand(d.score)!
              return (
                <div
                  key={d.dimension}
                  className="score-dim"
                  style={{ ["--score-c" as string]: SCORE_BAND_VAR[db] }}
                >
                  <span className="sd-label" title={d.dimension}>
                    {d.dimension}
                  </span>
                  <span className="sd-track">
                    <span className="sd-fill" style={{ width: `${d.score}%` }} />
                  </span>
                  <span className="sd-num">{d.score}</span>
                </div>
              )
            })
          ) : (
            // 旧评审数据无维度分：降级为意见维度标签
            <div className="sh-empty" style={{ padding: "2px 0 8px" }}>
              {report.agents[0]?.items.length
                ? `意见维度：${[...new Set(report.agents[0].items.map((i) => i.aspect))].join(" / ")}`
                : "本次评审无维度明细"}
            </div>
          )}
        </>
      )}

      <div className="sh-foot">
        <div className="sh-btns">
          {report.score !== null && !busy && (
            <button type="button" className="pbtn primary sm" disabled={busy} onClick={improve}>
              <WandSparkles className="size-3" />
              {report.candidateId ? "按意见改进" : improveActionLabel(report.targetType)}
            </button>
          )}
          <button
            type="button"
            className={report.score !== null ? "pbtn sm" : "pbtn primary sm"}
            title={busy ? (report.candidateId ? "候选评审直连执行，无对话" : "打开此评审的 AI 对话") : undefined}
            onClick={() => {
              if (busy) {
                // 候选直连评审无对话可打开：点击改 no-op（不用 disabled——禁用按钮不触发 mouse 事件，title 永远不显示）
                if (!report.candidateId) openReviewConversation(report)
                return
              }
              if (report.candidateId) startCandidateReview(report)
              else startScoreReview(report)
            }}
          >
            <RefreshCw className="size-3" />
            {busy ? "评审中…" : report.score !== null ? "重新评审" : "发起评审"}
          </button>
          {busy && (
            <button type="button" className="pbtn sm" disabled={stopping} onClick={stop}>
              <Square className="size-3" />
              {stopping ? "正在停止…" : "停止评审"}
            </button>
          )}
        </div>
        {!busy && report.reviewContext && (
          <div className="sh-btns">
            <button type="button" className="pbtn sm" onClick={() => openReviewConversation(report)}>
              <MessageSquare className="size-3" />
              查看评审对话
            </button>
          </div>
        )}
        <div className="sh-meta">
          <span className="cost-note">
            {report.supportsReaderPanel ? "评委 1 次 / 读者团 3 次调用" : "评审约 1 次调用"}
          </span>
          <button type="button" className="sh-hint" onClick={onOpenDetail}>
            点圆钮看详情 ›
          </button>
        </div>
      </div>
    </div>
  )
}
