"use client"

import { useQuery } from "@tanstack/react-query"

import type { ReviewTargetType } from "@/generated/prisma/enums"

import { apiGet } from "./api"
import { ReviewCard } from "./ReviewCard"
import type { ReviewRecord } from "./types"

/**
 * 某个评审目标（卷/章）的历史评审列表，最新在前。
 * 无记录时不渲染。
 */
export function ReviewHistory({
  novelId,
  targetType,
  targetId,
  onResolved,
}: {
  novelId: string
  targetType: ReviewTargetType
  targetId: string
  onResolved?: () => void
}) {
  const { data } = useQuery({
    queryKey: ["reviews", novelId, targetType, targetId],
    queryFn: () =>
      apiGet<{ reviews: ReviewRecord[] }>(
        `/api/novels/${novelId}/review?targetType=${targetType}&targetId=${targetId}`,
        "加载评审记录失败"
      ),
  })

  const reviews = data?.reviews ?? []
  if (reviews.length === 0) return null

  return (
    <div className="flex flex-col gap-3">
      {reviews.map((review) => (
        <ReviewCard key={review.id} novelId={novelId} review={review} onResolved={onResolved} />
      ))}
    </div>
  )
}
