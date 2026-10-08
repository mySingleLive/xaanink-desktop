"use client"

/**
 * 悬浮评分指示器（2026-09；视觉权威稿 design/score-indicator-preview.html）：
 * 圆形徽标锚定界面右下角——有分=conic 进度环+mono 数字（色温分档 绿≥80/橘60~79/红<60）、
 * 占位=虚线圆环+星芒、评审中=旋转环+星芒脉动、stale=右下角金点。
 * 悬停 400ms 出 ScoreHoverCard（fixed 定位在上方，可交互）；点击由 onOpenReview 接管（编辑器切评审视图），未提供时弹评分详情对话框。
 * 样式类在 globals.css 尾节（全局令牌，不依赖 pane 作用域）。
 */
import { useRef, useState } from "react"
import { Sparkles } from "lucide-react"

import { cn } from "@/lib/utils"
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog"

import { ScoreHoverCard } from "./ScoreHoverCard"
import { ScoreReportPanel } from "./ScoreReportPanel"
import { scoreBand, SCORE_BAND_VAR, useScoreReport, type ScoreTargetType } from "./use-score-report"

/** hover 意图延迟（防划过误触）与移出隐藏延迟（给移动到浮窗上的余量）——照 EntityHoverCard 时序 */
const SHOW_DELAY_MS = 400
const HIDE_DELAY_MS = 200

interface HoverPos {
  left: number
  /** 上方弹出：卡底边距指示器顶部 8px */
  bottom?: number
  /** 近顶翻转：卡顶边在指示器下方 8px */
  top?: number
}

export function ScoreIndicator({
  novelId,
  targetType,
  targetId,
  candidateId,
  size = "md",
  className,
  onOpenReview,
}: {
  novelId: string
  targetType: ScoreTargetType
  targetId: string
  /** 候选稿维度：报告/评审/评论全部按 candidateId 隔离（缺省=章级现状） */
  candidateId?: string
  /** md 46px（面板右下角）/ sm 34px（整本大纲卷卡片） */
  size?: "md" | "sm"
  /** 覆盖定位容器类名（默认 absolute bottom-24 right-4——抬高避开编辑器状态栏/评审条等底边文字） */
  className?: string
  /** 点击接管：编辑器所在面板传入后切换其评审视图；未提供时弹评分详情对话框 */
  onOpenReview?: () => void
}) {
  const { data: report } = useScoreReport(novelId, targetType, targetId, true, candidateId)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [hover, setHover] = useState<HoverPos | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const reviewing = report?.reviewing ?? false
  const score = report?.score ?? null
  const band = scoreBand(score)

  /* 点击详情：面板接管则切评审视图；否则开评分详情对话框（独立的 score tab 已移除） */
  const openDetail = () => {
    if (onOpenReview) {
      onOpenReview()
    } else {
      setDialogOpen(true)
    }
  }

  const scheduleShow = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current)
    if (showTimer.current) clearTimeout(showTimer.current)
    showTimer.current = setTimeout(() => {
      const rect = btnRef.current?.getBoundingClientRect()
      if (!rect) return
      const CARD_W = 268
      const left = Math.max(8, Math.min(rect.right - CARD_W, window.innerWidth - CARD_W - 8))
      // 上方空间不足 320px 时翻转到下方
      if (rect.top > 320) {
        setHover({ left, bottom: window.innerHeight - rect.top + 8 })
      } else {
        setHover({ left, top: rect.bottom + 8 })
      }
    }, SHOW_DELAY_MS)
  }
  const scheduleHide = () => {
    if (showTimer.current) clearTimeout(showTimer.current)
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setHover(null), HIDE_DELAY_MS)
  }
  const cancelHide = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current)
  }

  return (
    <div className={className ?? "absolute bottom-24 right-4 z-30"}>
      <button
        ref={btnRef}
        type="button"
        aria-label={
          reviewing
            ? "评审进行中"
            : score !== null
              ? `AI 综合评分 ${score} 分，点击查看详情`
              : "暂无评分，点击查看"
        }
        className={cn(
          "score-float",
          size === "sm" && "sm",
          reviewing && "reviewing",
          !reviewing && score === null && "empty"
        )}
        style={
          !reviewing && score !== null && band
            ? { ["--pct" as string]: score, ["--score-c" as string]: SCORE_BAND_VAR[band] }
            : undefined
        }
        onClick={openDetail}
        onMouseEnter={scheduleShow}
        onMouseLeave={scheduleHide}
      >
        {reviewing ? (
          <span className="score-ic">
            <Sparkles className={size === "sm" ? "size-3" : "size-[15px]"} />
          </span>
        ) : score !== null ? (
          <span className="score-num">{score}</span>
        ) : (
          <>
            <svg className="dash-ring" viewBox="0 0 46 46" aria-hidden>
              <circle
                cx="23"
                cy="23"
                r="20.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeDasharray="4 3.5"
              />
            </svg>
            <span className="score-ic">
              <Sparkles className={size === "sm" ? "size-3" : "size-[15px]"} />
            </span>
          </>
        )}
        {report?.stale && !reviewing && <span className="stale-dot" title="内容已修改，评分可能过时" />}
      </button>

      {hover && report && (
        <ScoreHoverCard
          novelId={novelId}
          report={report}
          pos={hover}
          onMouseEnter={cancelHide}
          onMouseLeave={scheduleHide}
          onOpenDetail={openDetail}
        />
      )}

      {/* 无接管面板时的评分详情出口：对话框内容与评审视图一致（ScoreReportPanel 复用） */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="flex h-[85vh] max-w-3xl flex-col overflow-hidden p-0">
          <DialogTitle className="sr-only">AI 评分 · {report?.targetLabel ?? "详情"}</DialogTitle>
          <div className="min-h-0 flex-1">
            <ScoreReportPanel novelId={novelId} refId={`${targetType}:${targetId}`} candidateId={candidateId} />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
