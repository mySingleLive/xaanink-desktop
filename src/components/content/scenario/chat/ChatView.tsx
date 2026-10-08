"use client"

/**
 * 情景试验场·聊天视图：按回合渲染推演流水（导演叙述 + 各角色言行气泡），
 * 底部 composer 按模式分两种——
 *   扮演模式（cast 里有 control:"user" 的角色）：「说/做」切换 + 输入，发送即推进一回合；
 *   旁观模式：可选输入导演指示，点「推进一回合」让 AI 角色们自己演下去。
 * v1 非流式：一次 POST 返回完整回合，推演中显示 shimmer 锚点行。
 */

import { useEffect, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Check,
  ChevronDown,
  ChevronRight,
  FlaskConical,
  Loader2,
  Play,
  SendHorizontal,
  ShieldAlert,
  X,
} from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { buildTabId, useTabsStore } from "@/stores/tabs"

import { apiGet, apiSend } from "../../api"
import { Button } from "@/components/ui/button"
import { invalidateScenarioDetail, useNovelCharacters } from "../queries"
import { ConfigForm } from "../ConfigForm"
import type {
  ScenarioBeat,
  ScenarioDetail,
  ScenarioFlowItem,
  ScenarioRunRecord,
  ScenarioTurnRecord,
} from "../types"

interface ChatViewProps {
  novelId: string
  labId: string
  detail: ScenarioDetail
  onOpenConfig: () => void
}

export function ChatView({ novelId, labId, detail, onOpenConfig }: ChatViewProps) {
  const queryClient = useQueryClient()
  const { scenario: lab, turns } = detail
  const userMember = lab.cast.find((m) => m.control === "user") ?? null

  const [actKind, setActKind] = useState<"say" | "do">("say")
  const [draft, setDraft] = useState("")
  /** 推演过程面板：展开与否 + 本次推演的起点时间（runs 接口的 since 过滤） */
  const [progressOpen, setProgressOpen] = useState(false)
  const [runSince, setRunSince] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const charactersQuery = useNovelCharacters(novelId)
  const avatarById = new Map(
    (charactersQuery.data?.characters ?? []).map((c) => [c.id, c.avatarUrl] as const)
  )

  const invalidate = () => invalidateScenarioDetail(queryClient, labId)

  const startMutation = useMutation({
    mutationFn: () =>
      apiSend<{ turn: ScenarioTurnRecord }>(
        `/api/novels/${novelId}/scenarios/${labId}/start`,
        "POST",
        undefined,
        "开局失败"
      ),
    onSuccess: invalidate,
    onError: (err) => toast.error(err.message),
  })

  const advanceMutation = useMutation({
    mutationFn: (body: { direction?: string; act?: { kind: "say" | "do"; content: string } }) =>
      apiSend<{ turn: ScenarioTurnRecord }>(
        `/api/novels/${novelId}/scenarios/${labId}/advance`,
        "POST",
        body,
        "推演失败"
      ),
    onSuccess: () => {
      setDraft("")
      invalidate()
    },
    onError: (err) => toast.error(err.message),
  })

  const generating = startMutation.isPending || advanceMutation.isPending

  // 新回合/开始推演时滚到底部
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [turns.length, advanceMutation.isPending])

  const submit = () => {
    const content = draft.trim()
    if (generating) return
    setRunSince(new Date().toISOString())
    if (userMember) {
      if (!content) return
      advanceMutation.mutate({ act: { kind: actKind, content } })
    } else {
      advanceMutation.mutate(content ? { direction: content } : {})
    }
  }

  // ── 配置中：内联配置表单 + 开始推演 ──
  if (lab.status === "draft") {
    const canStart = lab.cast.length > 0 && lab.sceneIds.length > 0
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6">
          <div className="mx-auto flex max-w-[560px] flex-col gap-4">
            <div className="flex flex-col items-center gap-2 text-center">
              <FlaskConical className="size-8 text-primary" />
              <p className="font-serif text-[16px] font-bold">先配置这个试验场</p>
              <p className="max-w-[420px] text-[12.5px] leading-relaxed text-muted-foreground">
                选一组角色与场景（可再补一段开场剧情），AI 会为每个角色配一个独立的扮演者，
                按他们的性格、动机与这个世界观的规则推演会发生什么。你可以选择扮演其中一名角色，也可以旁观。
              </p>
            </div>
            <ConfigForm key={`${lab.id}:${lab.updatedAt}`} novelId={novelId} lab={lab} onClose={() => {}} />
            <Button
              className="self-center"
              disabled={!canStart || startMutation.isPending}
              onClick={() => startMutation.mutate()}
            >
              {startMutation.isPending ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Play className="size-4" />
              )}
              开始推演
            </Button>
            {!canStart && (
              <p className="text-center text-[11.5px] text-muted-foreground">
                开局需要至少 1 名角色与 1 个场景（记得先点「保存配置」）
              </p>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ── 已开局：回合流水 + composer ──
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-[18px]">
        <div className="mx-auto flex max-w-[960px] flex-col gap-4">
          {turns.map((turn) => (
            <TurnBlock key={turn.id} turn={turn} avatarById={avatarById} />
          ))}
          {advanceMutation.isPending && (
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => setProgressOpen((v) => !v)}
                title={progressOpen ? "收起推演过程" : "展开推演过程"}
                className="flex w-full items-center gap-2 text-left text-[13px] text-muted-foreground"
              >
                <span className="text-shimmer font-mono">
                  正在推演第 {turns.length + 1} 回合（{lab.cast.filter((m) => m.control === "ai").length} 位扮演者 + 导演 + 一致性检查）…
                </span>
                {progressOpen ? (
                  <ChevronDown className="ml-auto size-3.5 shrink-0" />
                ) : (
                  <ChevronRight className="ml-auto size-3.5 shrink-0" />
                )}
              </button>
              {progressOpen && (
                <ScenarioRunList novelId={novelId} labId={labId} since={runSince} />
              )}
            </div>
          )}
        </div>
      </div>

      <div className="shrink-0 px-4 pb-3">
        <div className="mx-auto max-w-[960px]">
          <div className="sc-composer">
            {userMember && (
              <div className="flex items-center gap-1.5 px-3 pt-2.5">
                <span className="text-[11.5px] text-muted-foreground">
                  你正在扮演 <b className="text-foreground">{userMember.name}</b>
                </span>
                <span className="flex overflow-hidden rounded-full border border-(--chat-line-strong) text-[11px]">
                  <button
                    type="button"
                    className={cn("sc-cast-ctl", actKind === "say" && "on")}
                    onClick={() => setActKind("say")}
                  >
                    说
                  </button>
                  <button
                    type="button"
                    className={cn("sc-cast-ctl", actKind === "do" && "on")}
                    onClick={() => setActKind("do")}
                  >
                    做
                  </button>
                </span>
                <button
                  type="button"
                  className="ml-auto text-[11.5px] text-muted-foreground underline-offset-2 hover:underline"
                  onClick={onOpenConfig}
                >
                  换个角色演
                </button>
              </div>
            )}
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={2}
              disabled={generating}
              placeholder={
                userMember
                  ? actKind === "say"
                    ? `以 ${userMember.name} 的身份说句话…`
                    : `以 ${userMember.name} 的身份做个动作…`
                  : "以导演身份插入一句推动指示（可留空，直接推进）…"
              }
              className="w-full resize-none bg-transparent px-3 py-2 text-[13.5px] leading-relaxed outline-none placeholder:text-muted-foreground/70"
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault()
                  submit()
                }
              }}
            />
            <div className="flex items-center gap-2 px-3 pb-2.5">
              <span className="text-[11px] text-muted-foreground/80">
                每回合 ≈ 每位 AI 扮演者 1 次 + 导演/检查 2 次调用，消耗墨滴
              </span>
              <div className="flex-1" />
              <Button
                size="sm"
                disabled={generating || (Boolean(userMember) && !draft.trim())}
                onClick={submit}
              >
                {advanceMutation.isPending ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <SendHorizontal className="size-3.5" />
                )}
                {userMember ? "发送并推进" : "推进一回合"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/** 单回合：有时序流水按发生先后穿插渲染（旁白段与角色气泡交织）；旧回合退化为叙述块 + 固定顺序言行气泡 */
function TurnBlock({
  turn,
  avatarById,
}: {
  turn: ScenarioTurnRecord
  avatarById: Map<string, string | null>
}) {
  const lastCheck = turn.checks[turn.checks.length - 1]
  return (
    <div className="flex flex-col gap-2.5">
      <div className="sc-turn-no">
        {turn.kind === "opening" ? "开场" : `第 ${turn.index} 回合`}
        {lastCheck && !lastCheck.ok && (
          <span
            className="ml-1 inline-flex items-center gap-1 text-amber-600 dark:text-amber-500"
            title={`一致性检查有遗留问题：\n${lastCheck.issues.join("\n")}`}
          >
            <ShieldAlert className="size-3" />
            {lastCheck.issues.length} 条遗留
          </span>
        )}
      </div>
      {turn.direction && <div className="sc-direction">旁白指示：{turn.direction}</div>}
      {turn.flow.length > 0 ? (
        <FlowItems turn={turn} avatarById={avatarById} />
      ) : (
        <>
          {turn.narrative.trim() && <div className="sc-narr">{turn.narrative}</div>}
          {turn.beats.map((beat, i) =>
            beat.control === "user" ? (
              <UserBeatBubble key={`${beat.characterId}-${i}`} beat={beat} />
            ) : (
              <AiBeatBubble key={`${beat.characterId}-${i}`} beat={beat} avatarById={avatarById} />
            )
          )}
        </>
      )}
    </div>
  )
}

/**
 * 时序流水渲染：flow 数组顺序 = 剧情时间顺序。
 * narrative 项渲染为旁白块；连续同一角色的言/行/内心项并入一个气泡（气泡内保持 flow 原序，
 * 不再固定 say→act→think）；情绪 chip 取 beats 快照，只挂在该角色本回合第一个气泡上。
 */
function FlowItems({
  turn,
  avatarById,
}: {
  turn: ScenarioTurnRecord
  avatarById: Map<string, string | null>
}) {
  const beatById = new Map(turn.beats.map((b) => [b.characterId, b] as const))
  const groups: (ScenarioFlowItem | ScenarioFlowItem[])[] = []
  for (const item of turn.flow) {
    if (item.kind === "narrative") {
      groups.push(item)
      continue
    }
    const last = groups[groups.length - 1]
    if (Array.isArray(last) && last[0].characterId === item.characterId) last.push(item)
    else groups.push([item])
  }
  const seenCharacters = new Set<string>()
  return groups.map((group, i) => {
    if (!Array.isArray(group)) {
      return (
        <div key={i} className="sc-narr">
          {group.content}
        </div>
      )
    }
    const characterId = group[0].characterId ?? ""
    const beat = beatById.get(characterId)
    const emotion = seenCharacters.has(characterId) ? undefined : beat?.emotion
    seenCharacters.add(characterId)
    return beat?.control === "user" ? (
      <UserFlowBubble key={i} name={group[0].name ?? beat.name} items={group} />
    ) : (
      <AiFlowBubble
        key={i}
        characterId={characterId}
        name={group[0].name ?? "？"}
        emotion={emotion}
        items={group}
        avatarById={avatarById}
      />
    )
  })
}

function FlowItemContent({ item }: { item: ScenarioFlowItem }) {
  if (item.kind === "say") return <div className="sc-beat-say">{item.content}</div>
  if (item.kind === "act") return <div className="sc-beat-act">{item.content}</div>
  return <div className="sc-beat-think">（内心：{item.content}）</div>
}

function AiFlowBubble({
  characterId,
  name,
  emotion,
  items,
  avatarById,
}: {
  characterId: string
  name: string
  emotion?: string
  items: ScenarioFlowItem[]
  avatarById: Map<string, string | null>
}) {
  return (
    <div className="flex items-start gap-2">
      <BeatAvatar characterId={characterId} name={name} avatarById={avatarById} />
      <div className="sc-beat">
        <div className="sc-beat-head">
          <span className="sc-beat-name">{name}</span>
          {emotion && <span className="sc-emo">{emotion}</span>}
        </div>
        {items.map((item, j) => (
          <FlowItemContent key={j} item={item} />
        ))}
      </div>
    </div>
  )
}

function UserFlowBubble({ name, items }: { name: string; items: ScenarioFlowItem[] }) {
  return (
    <div className="flex justify-end">
      <div className="sc-beat-user">
        <div className="sc-beat-head justify-end">
          <span className="sc-beat-name">我 · {name}</span>
        </div>
        {items.map((item, j) =>
          item.kind === "act" ? (
            <div key={j} className="sc-beat-act">{item.content}</div>
          ) : (
            <div key={j}>{item.content}</div>
          )
        )}
      </div>
    </div>
  )
}

function BeatAvatar({
  characterId,
  name,
  avatarById,
}: {
  characterId: string
  name: string
  avatarById: Map<string, string | null>
}) {
  const url = avatarById.get(characterId)
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element -- 本地角色头像
    return <img src={url} alt={name} className="sc-beat-avatar" />
  }
  return <span className="sc-beat-avatar sc-beat-avatar-fallback">{name.slice(0, 1)}</span>
}

function AiBeatBubble({
  beat,
  avatarById,
}: {
  beat: ScenarioBeat
  avatarById: Map<string, string | null>
}) {
  return (
    <div className="flex items-start gap-2">
      <BeatAvatar characterId={beat.characterId} name={beat.name} avatarById={avatarById} />
      <div className="sc-beat">
        <div className="sc-beat-head">
          <span className="sc-beat-name">{beat.name}</span>
          {beat.emotion && <span className="sc-emo">{beat.emotion}</span>}
        </div>
        {beat.say && <div className="sc-beat-say">{beat.say}</div>}
        {beat.act && <div className="sc-beat-act">{beat.act}</div>}
        {beat.think && <div className="sc-beat-think">（内心：{beat.think}）</div>}
      </div>
    </div>
  )
}

function UserBeatBubble({ beat }: { beat: ScenarioBeat }) {
  return (
    <div className="flex justify-end">
      <div className="sc-beat-user">
        <div className="sc-beat-head justify-end">
          <span className="sc-beat-name">
            我 · {beat.name}
          </span>
        </div>
        {beat.say && <div>{beat.say}</div>}
        {beat.act && <div className="sc-beat-act">{beat.act}</div>}
      </div>
    </div>
  )
}

/** 推演过程展开面板：2s 轮询本次推演的子代理运行（扮演者/导演/一致性检查），完成的可点开回放 */
function ScenarioRunList({
  novelId,
  labId,
  since,
}: {
  novelId: string
  labId: string
  since: string | null
}) {
  const runsQuery = useQuery({
    queryKey: ["scenario-runs", labId, since],
    queryFn: () =>
      apiGet<{ runs: ScenarioRunRecord[] }>(
        `/api/novels/${novelId}/scenarios/${labId}/runs${since ? `?since=${encodeURIComponent(since)}` : ""}`,
        "加载推演过程失败"
      ),
    refetchInterval: 2000,
  })
  const runs = runsQuery.data?.runs ?? []
  return (
    <div className="flex flex-col gap-0.5 rounded-card border border-(--chat-line) bg-(--chat-surface) px-3 py-2">
      {runs.length === 0 && (
        <span className="text-[12px] text-muted-foreground">子代理启动中…</span>
      )}
      {runs.map((run) => (
        <ScenarioRunRow key={run.id} run={run} novelId={novelId} />
      ))}
    </div>
  )
}

function ScenarioRunRow({ run, novelId }: { run: ScenarioRunRecord; novelId: string }) {
  const openTab = useTabsStore((s) => s.openTab)
  const running = run.status === "running"
  const failed = run.status === "error"
  const durationSec = running
    ? null
    : Math.max(0, Math.round((Date.parse(run.updatedAt) - Date.parse(run.createdAt)) / 1000))
  const usage = run.tokenUsage ? run.tokenUsage.input + run.tokenUsage.output : null
  const meta = failed
    ? (run.errorMessage ?? "中断")
    : [
        durationSec != null && durationSec >= 1 ? `${durationSec} 秒` : null,
        usage != null ? `约 ${usage.toLocaleString()} 墨滴` : null,
      ]
        .filter(Boolean)
        .join(" · ")

  return (
    <button
      type="button"
      disabled={running}
      title={running ? undefined : "查看子代理运行回放"}
      onClick={() =>
        openTab({
          id: buildTabId("subagent", novelId, { refId: run.id }),
          type: "subagent",
          novelId,
          refId: run.id,
          title: run.label,
        })
      }
      className={cn(
        "flex w-full items-center gap-2 py-[3px] text-left font-mono text-[12.5px] select-none",
        running
          ? "cursor-default text-muted-foreground"
          : "text-muted-foreground transition-colors hover:text-foreground"
      )}
    >
      {running ? (
        <Loader2 className="size-3.5 shrink-0 animate-spin" />
      ) : failed ? (
        <X className="size-3.5 shrink-0 text-destructive" />
      ) : (
        <Check className="size-3.5 shrink-0 text-success" />
      )}
      <span className={cn("shrink-0", running && "text-shimmer")}>{run.label}</span>
      <span className="ml-auto min-w-0 truncate text-[11px] text-muted-foreground/80 tabular-nums">
        {meta}
      </span>
    </button>
  )
}
