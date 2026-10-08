"use client"
import { useQuery } from "@tanstack/react-query"
import { ArrowUpRight, Loader2, Workflow } from "lucide-react"
import { STORY_PHASE_STATUS, type StoryArtifact, type StoryWorkflowView } from "@/lib/story-workflow"
import { useChatStore } from "@/stores/chat"
import { buildTabId, useTabsStore, type Tab } from "@/stores/tabs"
import { useStoryActivityStore } from "@/stores/story-activity"
import { Button } from "@/components/ui/button"
import { MarkdownEditor } from "@/components/editor/MarkdownEditor"
import { focusStoryArtifact } from "@/components/chat/story-focus"
import { apiGet } from "./api"
import type { ContentPanelProps } from "./registry"

export function useStoryWorkflow(novelId: string | null, running = false) {
  return useQuery({ queryKey: ["story-workflow", novelId], enabled: !!novelId,
    queryFn: () => apiGet<{ workflow: StoryWorkflowView | null }>(`/api/novels/${novelId}/story-workflow`, "读取创作进度失败"), refetchInterval: running ? 2500 : false })
}
function chatAbout(novelId: string, draft: string) {
  const chat = useChatStore.getState()
  if (chat.draftNovelId === novelId) { chat.setDraft(draft); chat.requestChatFocus() }
  else chat.requestNewConversation({ novelId, draft })
}
export function StoryWorkflowBar({ novelId, running }: { novelId: string | null; running: boolean }) {
  const query = useStoryWorkflow(novelId, running), workflow = query.data?.workflow
  if (!novelId) return null
  const phase = workflow?.phases.find(p => p.id === workflow.phase)
  return <button type="button" aria-label="查看创作进度" className="flex w-full items-center gap-2 border-b border-border px-4 py-2 text-left text-xs text-muted-foreground hover:bg-hover-wash" onClick={() => useTabsStore.getState().openTab({ id: buildTabId("story-workflow", novelId), type: "story-workflow", novelId, title: "创作进度" })}>
    <Workflow className="size-3.5" /><span className="min-w-0 flex-1 truncate">{phase ? `${phase.label} · ${STORY_PHASE_STATUS[phase.status]}` : "从灵感到整部小说"}</span>{workflow && <span>{workflow.writtenChapters} / {workflow.targetChapters} 章</span>}<ArrowUpRight className="size-3.5" />
  </button>
}
export function StoryWorkflowPanel({ novelId }: ContentPanelProps) {
  const running = useChatStore(s => s.isGenerating), query = useStoryWorkflow(novelId, running), data = query.data?.workflow
  const showReview = (key: string, title: string) => useTabsStore.getState().openTab({ id: buildTabId("story-review", novelId, { refId: key }), type: "story-review", novelId, refId: key, title: `评审 · ${title}` })
  if (query.isLoading) return <div className="p-6 text-sm text-muted-foreground">正在读取创作进度…</div>
  if (query.isError) return <div className="p-6"><p>创作进度暂时不可用</p><Button variant="outline" onClick={() => query.refetch()}>重新读取</Button></div>
  if (!data) return <div className="space-y-4 p-6"><h2 className="text-xl font-medium">从一个灵感开始</h2><p className="text-sm text-muted-foreground">告诉墨影一个角色、一段情节或一个世界。创作进度会随着对话保存。</p><Button onClick={() => chatAbout(novelId, "请启动聊天创作流程。先理解我已有的灵感，通过问答补齐故事骨架，每项设定完成后让我逐个审核。")}>在聊天中开始</Button></div>
  return <div className="h-full overflow-auto p-5"><h2 className="font-serif text-2xl">创作进度</h2><p className="mb-5 mt-2 text-xs text-muted-foreground">{data.writingMode === "batch" ? "批量生成" : "逐章确认"} · {data.writtenChapters}/{data.targetChapters} 章 · {data.wordCount.toLocaleString()} 字</p>
    <div className="space-y-3">{data.phases.map(phase => <section key={phase.id} className="rounded-xl border border-border bg-card p-4" aria-label={`${phase.label}进度`}><div className="flex items-center justify-between gap-3"><h3 className="text-sm font-medium">{phase.label}</h3><span className="text-xs text-muted-foreground">{STORY_PHASE_STATUS[phase.status]}{phase.score !== null ? ` · ${phase.score} 分（达标线 ${phase.threshold}）` : ""}</span></div>
      {phase.blockers.length > 0 && <details className="mt-2 text-xs text-muted-foreground"><summary className="cursor-pointer">{phase.blockers.length} 项待完善</summary><ul className="mt-2 list-disc space-y-1 pl-4">{phase.blockers.map((b, i) => <li key={i}>{b}</li>)}</ul></details>}
      {phase.subkeys ? <div className="mt-2 space-y-1">{phase.subkeys.map(sub => <div key={sub.key} className="flex items-center justify-between gap-2 text-xs"><span className="text-muted-foreground">{sub.label} · {STORY_PHASE_STATUS[sub.status]}{sub.score !== null ? ` · ${sub.score} 分` : ""}</span>{data.checkpoints[sub.key] && <Button size="sm" variant="link" onClick={() => showReview(sub.key, `${phase.label} · ${sub.label}`)}>查看评审</Button>}</div>)}</div>
        : data.checkpoints[`phase:${phase.id}`] && <Button size="sm" variant="link" onClick={() => showReview(`phase:${phase.id}`, phase.label)}>查看评审</Button>}
      <div className="mt-3 flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => chatAbout(novelId, `继续「${phase.label}」环节，请先读取当前进度，补齐缺口并完成当前版本检查点。`)}>在聊天中继续</Button><Button size="sm" variant="ghost" onClick={() => chatAbout(novelId, `我想回到「${phase.label}」重新设计。请先和我确认要改变什么，再分析所有关联产物。`)}>重新设计</Button></div></section>)}</div>
    {!!data.pendingApprovals.length && <section className="mt-6"><h3 className="text-sm font-medium">待你审核</h3>{data.pendingApprovals.map(key => { const artifact = data.artifacts.find(a => a.key === key); return artifact && <button key={key} className="mt-2 flex w-full items-center justify-between rounded-lg border border-border p-3 text-left text-sm hover:bg-hover-wash" onClick={() => focusStoryArtifact(novelId, artifact)}>{artifact.title}<ArrowUpRight className="size-4" /></button> })}</section>}
    {data.brief && <section className="mt-6"><h3 className="mb-2 text-sm font-medium">创作简报</h3><MarkdownEditor value={data.brief} onChange={() => {}} readOnly defaultMode="preview" className="min-h-48" /></section>}
    <section className="mt-6"><h3 className="text-sm font-medium">设定评审</h3><div className="mt-2 flex flex-wrap gap-2">{data.artifacts.filter(a => a.phase === "settings").map(a => { const check = data.checkpoints[a.key]; return <Button key={a.key} size="sm" variant="outline" onClick={() => showReview(a.key, a.title)}>{a.title} · {check?.hash === a.evidenceHash ? `${check.score} 分` : check ? "待重评" : "待评"}</Button> })}</div></section>
    {!!data.revisions.length && <details className="mt-6 text-xs text-muted-foreground"><summary>重新设计记录 · {data.revisions.length}</summary>{data.revisions.map(r => <p key={r.id} className="mt-2">{r.reason}</p>)}</details>}
  </div>
}
export function StorySources({ novelId, artifactKey }: { novelId: string; artifactKey: string }) {
  const running = useChatStore(s => s.isGenerating)
  const query = useQuery({ queryKey: ["story-sources", novelId, artifactKey], queryFn: () => apiGet<{ sources: StoryArtifact[]; targets: StoryArtifact[] }>(`/api/novels/${novelId}/story-workflow?key=${encodeURIComponent(artifactKey)}`, "读取故事来源失败"), refetchInterval: running ? 3000 : false })
  const items = query.data?.sources.filter(a => ["narrative-card", "world-event"].includes(a.kind)) ?? []
  return <details className="shrink-0 border-b border-border bg-card px-4 py-2 text-xs"><summary className="cursor-pointer text-muted-foreground">故事来源 · {items.length}</summary><div className="flex flex-wrap gap-2 py-2">{items.map(a => <button key={a.key} type="button" className="rounded-md border border-border px-2 py-1 hover:bg-hover-wash" onClick={() => focusStoryArtifact(novelId, a)}>{a.title} ↗</button>)}{!items.length && <span className="text-muted-foreground">{query.isError ? "来源暂时读取失败" : "在叙事线中分配卷章或在聊天中关联故事来源"}</span>}</div></details>
}
export function StoryActivityBanner({ novelId }: { novelId: string }) {
  const activity = useStoryActivityStore(s => s.activity)
  const conversationId = useChatStore(s => s.conversationId)
  if (!activity || activity.conversationId !== conversationId || activity.novelId !== novelId || activity.state !== "working") return null
  return <div role="status" className="flex shrink-0 items-center gap-2 border-b border-border bg-card px-4 py-2 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" />墨影正在{activity.title} · 内容随进度更新</div>
}
export function StoryActivityPanel({ novelId }: ContentPanelProps) {
  const activity = useStoryActivityStore(s => s.activity)
  if (!activity || activity.novelId !== novelId) return <div className="p-6 text-sm text-muted-foreground">本次预览已结束，已保存内容可从对应面板查看。</div>
  return <div className="flex h-full flex-col p-4"><p className="mb-3 text-xs text-muted-foreground">{activity.state === "working" ? "正在生成 · 预览尚未保存" : activity.state === "saved" ? "操作完成，请查看对应内容" : "本次预览未提交，当前稿保留"}</p><MarkdownEditor value={activity.text} onChange={() => {}} readOnly defaultMode="preview" placeholder="正在准备内容…" className="min-h-0 flex-1" /></div>
}

export function StoryLivePreview({ tab }: { tab: Tab }) {
  const activity = useStoryActivityStore(s => s.activity)
  const conversationId = useChatStore(s => s.conversationId)
  if (!activity || activity.conversationId !== conversationId || activity.novelId !== tab.novelId || activity.state !== "working" || !activity.text || tab.type === "story-activity") return null
  if (activity.targetTabId !== tab.id) return null
  return <div className="flex max-h-[45%] min-h-32 shrink-0 flex-col border-b border-primary/30 bg-card p-3" aria-label="AI 实时内容预览"><p className="mb-2 text-xs text-muted-foreground">正在修改 · 此预览尚未保存，完成后同步下方内容</p><MarkdownEditor value={activity.text} onChange={() => {}} readOnly defaultMode="preview" className="min-h-0 flex-1 overflow-auto" /></div>
}
