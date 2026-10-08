"use client"

/**
 * 情景试验场面板（tab type=scenario，refId=labId）。
 * 头部（面包屑/标题双击改名/状态统计 + 四视图段控 + 配置/重置按钮）
 * + 聊天/主干/分镜/样文四视图（保持挂载，display 切换保住各自状态）。
 */

import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  Clapperboard,
  FlaskConical,
  Loader2,
  MessagesSquare,
  MoveRight,
  RotateCcw,
  ScrollText,
  Settings2,
} from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"

import { apiSend } from "../api"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { ContentPanelProps } from "../registry"
import { BeatsView } from "./beats/BeatsView"
import { ChatView } from "./chat/ChatView"
import { ConfigForm } from "./ConfigForm"
import { ProseView } from "./prose/ProseView"
import { invalidateScenarioDetail, useScenarioDetail } from "./queries"
import { TrunkView } from "./trunk/TrunkView"
import type { ScenarioLabRecord } from "./types"

type ScenarioView = "chat" | "trunk" | "beats" | "prose"

const VIEW_OPTIONS: { value: ScenarioView; label: string; icon: typeof MessagesSquare }[] = [
  { value: "chat", label: "聊天", icon: MessagesSquare },
  { value: "trunk", label: "主干", icon: MoveRight },
  { value: "beats", label: "分镜", icon: Clapperboard },
  { value: "prose", label: "样文", icon: ScrollText },
]

export function ScenarioPanel({ novelId, refId: labId }: ContentPanelProps) {
  const queryClient = useQueryClient()
  const [view, setView] = useState<ScenarioView>("chat")
  const [renaming, setRenaming] = useState(false)
  const [nameDraft, setNameDraft] = useState("")
  /** undefined=跟随 lab 状态（draft 自动展开）；显式布尔=用户手动开合 */
  const [configOpen, setConfigOpen] = useState<boolean | undefined>(undefined)
  const [resetConfirm, setResetConfirm] = useState(false)

  const detailQuery = useScenarioDetail(novelId, labId)

  const renameMutation = useMutation({
    mutationFn: (title: string) =>
      apiSend<{ scenario: ScenarioLabRecord }>(
        `/api/novels/${novelId}/scenarios/${labId}`,
        "PATCH",
        { title },
        "重命名失败"
      ),
    onSuccess: () => {
      if (labId) invalidateScenarioDetail(queryClient, labId)
    },
    onError: (err) => toast.error(err.message),
  })

  const resetMutation = useMutation({
    mutationFn: () =>
      apiSend<{ scenario: ScenarioLabRecord }>(
        `/api/novels/${novelId}/scenarios/${labId}/reset`,
        "POST",
        undefined,
        "重置失败"
      ),
    onSuccess: () => {
      toast.success("已重置，推演记录已清空")
      setResetConfirm(false)
      if (labId) invalidateScenarioDetail(queryClient, labId)
    },
    onError: (err) => toast.error(err.message),
  })

  if (!labId) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        缺少试验场参数
      </div>
    )
  }
  if (detailQuery.isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    )
  }
  if (detailQuery.isError || !detailQuery.data) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {detailQuery.error instanceof Error ? detailQuery.error.message : "情景试验场加载失败"}
      </div>
    )
  }

  const detail = detailQuery.data
  const lab = detail.scenario
  const showConfig = configOpen ?? lab.status === "draft"

  const commitRename = () => {
    setRenaming(false)
    const title = nameDraft.trim()
    if (title && title !== lab.title) renameMutation.mutate(title)
  }

  return (
    <div className="scpane flex h-full min-h-0 flex-col bg-chat-bg text-foreground">
      <div className="sc-head">
        <FlaskConical className="size-4 shrink-0 text-primary" />
        <div className="min-w-0">
          <div className="crumb">情景试验场</div>
          {renaming ? (
            <input
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return
                if (e.key === "Enter") {
                  e.preventDefault()
                  commitRename()
                } else if (e.key === "Escape") {
                  setRenaming(false)
                }
              }}
              className="w-64 rounded-inner border border-input bg-chat-surface px-1.5 py-0.5 font-serif text-[16.5px] font-bold outline-none focus:border-primary"
            />
          ) : (
            <h1
              className="cursor-text truncate"
              title="双击改名"
              onDoubleClick={() => {
                setNameDraft(lab.title)
                setRenaming(true)
              }}
            >
              {lab.title}
            </h1>
          )}
        </div>
        <span className="sub">
          {lab.status === "draft" ? "配置中" : "推演中"} · {detail.turns.length} 回合 ·{" "}
          {detail.nodes.length} 情节点
        </span>

        {/* 四视图段控 */}
        <div className="sc-seg">
          {VIEW_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={cn(view === opt.value && "on")}
              onClick={() => setView(opt.value)}
            >
              <opt.icon className="size-3" />
              {opt.label}
            </button>
          ))}
        </div>

        <div className="flex-1" />
        <Button
          size="sm"
          variant="outline"
          onClick={() => setConfigOpen(!(configOpen ?? lab.status === "draft"))}
        >
          <Settings2 className="size-3.5" />
          配置
        </Button>
        {lab.status === "active" && (
          <Button size="sm" variant="outline" onClick={() => setResetConfirm(true)}>
            <RotateCcw className="size-3.5" />
            重置
          </Button>
        )}
      </div>

      <div className="relative min-h-0 flex-1">
        <section className={cn("sc-view", view === "chat" && "on")}>
          <ChatView
            novelId={novelId}
            labId={labId}
            detail={detail}
            onOpenConfig={() => setConfigOpen(true)}
          />
        </section>
        <section className={cn("sc-view", view === "trunk" && "on")}>
          <TrunkView novelId={novelId} labId={labId} detail={detail} />
        </section>
        <section className={cn("sc-view", view === "beats" && "on")}>
          <BeatsView novelId={novelId} labId={labId} detail={detail} />
        </section>
        <section className={cn("sc-view", view === "prose" && "on")}>
          <ProseView novelId={novelId} labId={labId} detail={detail} />
        </section>

        {/* 配置浮层（active 后经头部「配置」按钮打开；draft 态由聊天视图内联展示） */}
        {showConfig && lab.status === "active" && (
          <div
            className="absolute inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/20 py-8"
            onClick={() => setConfigOpen(false)}
          >
            <div className="w-[560px] max-w-[92%]" onClick={(e) => e.stopPropagation()}>
              <ConfigForm
                key={`${lab.id}:${lab.updatedAt}`}
                novelId={novelId}
                lab={lab}
                onClose={() => setConfigOpen(false)}
              />
            </div>
          </div>
        )}
      </div>

      {/* 重置确认 */}
      <Dialog open={resetConfirm} onOpenChange={setResetConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重置试验场</DialogTitle>
            <DialogDescription>
              将清空「{lab.title}」的全部推演记录（回合、情节点、分镜卡、样文），回到配置中状态；角色与场景配置保留。该操作不可撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetConfirm(false)}>
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={resetMutation.isPending}
              onClick={() => resetMutation.mutate()}
            >
              {resetMutation.isPending && <Loader2 className="animate-spin" />}
              确认重置
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
