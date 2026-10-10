"use client"
import { useEffect, useRef, useState } from 'react'
import { AlertCircle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { UnavailableWork } from '@desktop/shared/work-list'

/** A failed directory is an indexed work, never an empty or operable novel. */
export function UnavailableWorks({ works, retrying, retry }: { works: UnavailableWork[]; retrying: boolean; retry(): void }) {
  const alive = useRef(false), flight = useRef(false)
  const [busy, setBusy] = useState<'repairing' | 'pending' | 'restarting' | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const repair = async (work: UnavailableWork) => {
    const bridge = window.desktop
    if (flight.current || busy || work.reason !== 'stale-lease' || !bridge?.repairWorkLease) return
    flight.current = true; setBusy('repairing'); setError(null)
    try {
      const result = await bridge.repairWorkLease({ type: 'start', workId: work.workId })
      if (alive.current) setBusy(result === 'cancelled' ? null : result)
    } catch {
      if (alive.current) { setBusy(null); setError('暂时无法开始锁修复，原文件已保留，请重试。') }
    } finally { flight.current = false }
  }
  if (!works.length) return null
  const canRepair = typeof window !== 'undefined' && !!window.desktop?.repairWorkLease
  return <div className="space-y-2 px-2 py-3" aria-label="暂不可用的作品">
    {works.map(work => <div key={work.workId} className="rounded-md border border-border px-3 py-2">
      <div className="flex items-center gap-2 text-sm font-medium"><AlertCircle className="size-4 shrink-0 text-destructive"/><span className="truncate" title={work.title}>{work.title}</span></div>
      <p className="mt-1 text-xs text-muted-foreground">{work.reason === 'stale-lease' ? '上次异常退出留下了写入锁，作品内容已保留。' : '作品目录暂不可用，请检查目录后重新加载。'}</p>
      {work.reason === 'stale-lease' && canRepair && <Button variant="outline" size="sm" className="mt-2" disabled={!!busy || retrying} onClick={() => void repair(work)}>{busy === 'repairing' ? '正在准备修复…' : busy === 'restarting' ? '正在重新启动…' : busy === 'pending' ? '修复交接待完成' : '修复作品锁'}</Button>}
    </div>)}
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    <Button variant="outline" size="sm" disabled={retrying || !!busy} onClick={retry}><RefreshCw className="size-3.5"/>{retrying ? '正在重新加载…' : '重新加载作品'}</Button>
  </div>
}
