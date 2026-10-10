"use client"
import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useChatStore } from '@/stores/chat'
import { useDesktopStore } from '@/stores/desktop'
import { Button } from '@/components/ui/button'
import type { ModelRequiredNotice } from '@desktop/shared/ipc'

interface TaskState {
  conversation: { activeAttemptId: string | null; reviewModelId: string | null }
  turnState: { turn: { id: string; latestAttemptId: string; defaultsSnapshot?: { reviewModelId: string | null } | null }; attempts: { id: string; status: string; defaultsSnapshot?: { reviewModelId: string | null } | null }[] } | null
}
/** Explicit task repair: the invocation identity owns both the read and write. */
export function ReviewModelSelection({ notice, onBusyChange, onApplied }: { notice: ModelRequiredNotice; onBusyChange(busy: boolean): void; onApplied(): void }) {
  const conversationId = useChatStore(state => state.conversationId)
  const bootstrap = useDesktopStore(state => state.bootstrap)
  const model = bootstrap?.models.find(model => model.id === bootstrap.settings.agent.reviewModelId && model.enabled && model.kind === 'TEXT')
  const [submitted, setSubmitted] = useState<{ id: string; name: string } | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState(false), [applied, setApplied] = useState(false)
  const displayModel = busy || applied ? submitted : model
  const task = notice.task
  const eligible = notice.role === 'review' && notice.code === 'MODEL_NOT_SELECTED' && !!task && conversationId === task.conversationId && !!displayModel
  const queryClient = useQueryClient()
  const inFlight = useRef(false), alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const query = useQuery<TaskState>({
    queryKey: ['review-selection', task?.conversationId, task?.turnId, task?.attemptId],
    enabled: eligible,
    queryFn: async () => {
      const response = await fetch(`/api/chat/conversations/${encodeURIComponent(task!.conversationId)}`)
      if (!response.ok) throw Error('任务状态读取失败')
      return response.json()
    },
    retry: false,
    refetchInterval: query => query.state.data?.conversation.activeAttemptId ? 1000 : false,
  })
  if (!eligible) return null
  const state = query.data?.turnState, attempt = state?.attempts.find(attempt => attempt.id === task!.attemptId)
  const current = !!state && state.turn.id === task!.turnId && state.turn.latestAttemptId === task!.attemptId
  const reviewId = (attempt?.defaultsSnapshot ?? state?.turn.defaultsSnapshot)?.reviewModelId ?? null
  const available = current && !!attempt && !query.data?.conversation.activeAttemptId && !['queued', 'running'].includes(attempt.status) && reviewId === null && !query.data?.conversation.reviewModelId
  const apply = async () => {
    if (!available || inFlight.current || applied) return
    inFlight.current = true; setSubmitted({ id: model!.id, name: model!.name }); setBusy(true); onBusyChange(true); setError(false)
    const owns = () => alive.current && useChatStore.getState().conversationId === task!.conversationId
    try {
      const response = await fetch(`/api/chat/conversations/${encodeURIComponent(task!.conversationId)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'review-selection', modelId: model!.id, turnId: task!.turnId, attemptId: task!.attemptId }) })
      if (!response.ok) throw Error('审核选择保存失败')
      if (!owns()) return
      setApplied(true)
      onApplied()
      void queryClient.invalidateQueries({ queryKey: ['sop-plan', task!.conversationId] })
    } catch { if (owns()) setError(true) }
    finally { inFlight.current = false; if (alive.current) { setBusy(false); onBusyChange(false) } }
  }
  return <div className="space-y-2 rounded-card border p-3 text-sm">
    <p>{busy || applied ? '本次审核模型' : '默认审核模型'}：<span className="font-medium text-foreground">{displayModel!.name}</span></p>
    {applied ? <p role="status">审核模型已应用，请手动重新执行任务。</p> : <>
      <p className="text-muted-foreground">将此模型用于当前任务及此对话后续尚未选择审核模型的任务。</p>
      {query.isError && <p role="alert">任务状态暂时无法读取。<Button variant="ghost" size="sm" onClick={() => void query.refetch()}>重新读取</Button></p>}
      {query.data && !current && <p role="status">任务已变化，请返回当前任务重新执行。</p>}
      {error && <p role="alert" className="text-destructive">未能应用审核模型，请检查配置后重试。</p>}
      <Button onClick={() => void apply()} disabled={!available || busy}>{busy ? '正在应用…' : '应用到当前任务'}</Button>
    </>}
  </div>
}
