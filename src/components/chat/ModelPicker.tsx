"use client"

/**
 * Reuse the Web conversation picker and thinking submenu with local models.
 * Model choices remain explicit: unavailable references never fall back to a
 * different model. New-task defaults are captured separately at task creation.
 */
import { useEffect, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Check } from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { CHAT_OPEN_MODEL_PICKER_EVENT } from "@/components/chat/ui-events"
import { useChatStore, type ModelChoice } from "@/stores/chat"
import { ProviderLogo } from "@/components/chat/provider-logos"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

interface SelectableModel {
  id: string
  name: string
  provider: string
  modelId: string
  tier: "NORMAL" | "ADVANCED"
  contextWindow: number
  /** 官网 0 价免费模型：名称旁展示「免费」标签 */
  free: boolean
  thinkingEfforts: { value: string; label: string; description?: string }[]
}

interface ModelsResponse {
  defaultModelId: string | null
  models: SelectableModel[]
}

/** 上下文窗口紧凑展示（128000 → 128K，1000000 → 1M） */
function formatWindow(tokens: number): string {
  if (tokens >= 1_000_000) {
    // 官网标称按 10 进制 M（如 1M=1048576 也显示 1M），去尾零
    return `${parseFloat((tokens / 1_000_000).toFixed(1))}M`
  }
  return tokens >= 1000 ? `${Math.round(tokens / 1000)}K` : String(tokens)
}

export function ModelPicker() {
  /* 菜单受控：模型行点击即选中（默认档）并关菜单；思考强度子层保留悬停展开 */
  const [menuOpen, setMenuOpen] = useState(false)
  const conversationId = useChatStore((s) => s.conversationId)
  const modelChoice = useChatStore((s) => s.modelChoice)
  const setModelChoice = useChatStore((s) => s.setModelChoice)
  const modelEffortMemory = useChatStore((s) => s.modelEffortMemory)
  const rememberModelEffort = useChatStore((s) => s.rememberModelEffort)
  const rememberModelChoice = useChatStore((s) => s.rememberModelChoice)
  const accountId = useChatStore(s => s.accountId)
  const draftId = useChatStore(s => s.draftId)
  const owner = JSON.stringify([accountId,conversationId,draftId])
  const selection = useRef({owner,epoch:0,ticket:0,confirmed:modelChoice,alive:true})
  const writes = useRef<Promise<void>>(Promise.resolve())
  if (selection.current.owner !== owner) selection.current = {owner,epoch:selection.current.epoch+1,ticket:selection.current.ticket+1,confirmed:modelChoice,alive:true}
  useEffect(() => {
    selection.current.alive=true
    return () => {selection.current.alive=false;selection.current.ticket++}
  },[])

  const { data } = useQuery({
    queryKey: ["chat-models"],
    queryFn: async () => {
      const res = await fetch("/api/models")
      if (!res.ok) throw new Error("加载模型列表失败")
      return (await res.json()) as ModelsResponse
    },
    staleTime: 5 * 60 * 1000,
  })

  const models = data?.models ?? []
  const effectiveModelId = modelChoice.modelId
  const currentModel = models.find((m) => m.id === effectiveModelId) ?? null
  const displayModel = currentModel
  const currentEffortOption =
    currentModel?.thinkingEfforts.find((o) => o.value === (modelChoice.effort ?? "default")) ?? null

  /* 错误卡「切换模型」行动按钮经 UI 事件打开本选择器 */
  useEffect(() => {
    const open = () => setMenuOpen(true)
    window.addEventListener(CHAT_OPEN_MODEL_PICKER_EVENT, open)
    return () => window.removeEventListener(CHAT_OPEN_MODEL_PICKER_EVENT, open)
  }, [])

  /** Serialize persisted choices. A late response owns only its original
   * conversation/draft and can roll back only the latest still-visible choice. */
  const applyChoice = async (choice: ModelChoice): Promise<boolean> => {
    const frame=selection.current,epoch=frame.epoch,ticket=++frame.ticket
    const ownsContext=() => {
      const current=useChatStore.getState()
      return selection.current.alive && selection.current.epoch===epoch && JSON.stringify([current.accountId,current.conversationId,current.draftId])===owner
    }
    const ownsChoice=() => ownsContext() && selection.current.ticket===ticket && useChatStore.getState().modelChoice.modelId===choice.modelId && useChatStore.getState().modelChoice.effort===choice.effort
    setModelChoice(choice)
    if (!conversationId) {
      if (!ownsChoice()) return false
      frame.confirmed=choice;rememberModelChoice(choice)
      return true
    }
    const pending=writes.current.then(async () => {
      try {
        const res = await fetch(`/api/chat/conversations/${conversationId}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ modelId: choice.modelId, thinkingEffort: choice.effort }),
        })
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as { error?: string } | null
          throw new Error(data?.error ?? "保存模型选择失败")
        }
        if (ownsContext()) selection.current.confirmed=choice
        if (!ownsChoice()) return false
        rememberModelChoice(choice)
        return true
      } catch (err) {
        if (ownsChoice()) {
          setModelChoice(selection.current.confirmed)
          toast.error(err instanceof Error ? err.message : "保存模型选择失败")
        }
        return false
      }
    })
    writes.current=pending.then(()=>undefined,()=>undefined)
    return pending
  }

  /** 档位选择成功（含新会话无 PATCH 直通）后记入思考强度记忆 */
  const rememberAfterApply = (modelId: string, effort: string | null, ok: boolean) => {
    if (ok && effort) rememberModelEffort(modelId, effort)
  }

  /** Preserve an explicit effort memory when supported; otherwise use the model default. */
  const selectModel = (m: SelectableModel) => {
    setMenuOpen(false)
    const hasOption = (value: string | null | undefined): value is string =>
      m.thinkingEfforts.some((o) => o.value === value)
    const effort =
      m.thinkingEfforts.length === 0
        ? null
        : hasOption(modelEffortMemory[m.id])
          ? modelEffortMemory[m.id]
          : null
    void applyChoice({ modelId: m.id, effort }).then((ok) => rememberAfterApply(m.id, effort, ok))
  }

  return (
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            title="选择模型与思考强度"
            aria-label="选择模型与思考强度"
            className="flex h-7 min-w-0 items-center gap-1 rounded-full px-2 text-xs whitespace-nowrap text-muted-foreground transition-colors select-none hover:bg-hover-wash hover:text-foreground"
          />
        }
      >
        <ProviderLogo provider={displayModel?.provider ?? ""} className="size-3.5 shrink-0" />
        <span className="max-w-[150px] truncate">
          {displayModel
            ? `${displayModel.name}${
                currentEffortOption && currentEffortOption.value !== "default"
                  ? ` · ${currentEffortOption.label}`
                  : ""
              }`
            : effectiveModelId ? "模型已失效" : "选择模型"}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" sideOffset={6} className="w-60">
        <DropdownMenuGroup>
          {models.map((m, i) => {
            const selected = effectiveModelId === m.id
            /* 供应商分组分隔（服务端已按供应商分组排序） */
            const providerBreak = i > 0 && models[i - 1].provider !== m.provider
            /* 无思考强度档位的模型（兼容端点）：普通可点项，不渲染空的第二层 */
            if (m.thinkingEfforts.length === 0) {
              return (
                <div key={m.id}>
                  {providerBreak && <DropdownMenuSeparator />}
                  <DropdownMenuItem onClick={() => selectModel(m)}>
                    <ProviderLogo provider={m.provider} className="size-3.5" />
                    <span className="flex min-w-0 flex-1 items-center gap-1.5">
                      <span className="min-w-0 truncate">{m.name}</span>
                      {m.free && (
                        <Badge className="h-4 shrink-0 bg-success/12 px-1 text-[10px] text-success">
                          免费
                        </Badge>
                      )}
                    </span>
                    {m.contextWindow > 0 && <span className="text-[10px] text-muted-foreground">{formatWindow(m.contextWindow)}</span>}
                    {selected && <Check className="size-3.5 text-primary" />}
                  </DropdownMenuItem>
                </div>
              )
            }
            return (
              <div key={m.id}>
                {providerBreak && <DropdownMenuSeparator />}
                <DropdownMenuSub>
                <DropdownMenuSubTrigger
                  className={cn(selected && "text-foreground")}
                  onClick={() => selectModel(m)}
                >
                  <ProviderLogo provider={m.provider} className="size-3.5" />
                  <span className="flex min-w-0 flex-1 items-center gap-1.5">
                    <span className="min-w-0 truncate">{m.name}</span>
                    {m.free && (
                      <Badge className="h-4 shrink-0 bg-success/12 px-1 text-[10px] text-success">
                        免费
                      </Badge>
                    )}
                  </span>
                  {selected && <Check className="size-3.5 text-primary" />}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-52">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>
                      思考强度{m.contextWindow > 0 ? ` · 上下文 ${formatWindow(m.contextWindow)}` : ""}
                    </DropdownMenuLabel>
                    {m.thinkingEfforts.map((opt) => {
                      const effortActive =
                        selected && (modelChoice.effort ?? "default") === opt.value
                      return (
                        <DropdownMenuItem
                          key={opt.value}
                          onClick={() => {
                            // 显式选档：落会话并写入思考强度记忆（下次点模型行恢复此档）
                            const effort = opt.value === "default" ? null : opt.value
                            void applyChoice({ modelId: m.id, effort }).then((ok) =>
                              rememberAfterApply(m.id, effort, ok)
                            )
                          }}
                        >
                          <span className="min-w-0 flex-1">
                            {opt.label}
                            {opt.description && (
                              <span className="ml-1 text-xs text-muted-foreground">{opt.description}</span>
                            )}
                          </span>
                          {effortActive && <Check className="size-3.5 text-primary" />}
                        </DropdownMenuItem>
                      )
                    })}
                  </DropdownMenuGroup>
                </DropdownMenuSubContent>
                </DropdownMenuSub>
              </div>
            )
          })}
          {models.length === 0 && (
            <DropdownMenuItem disabled>暂无可用文本模型</DropdownMenuItem>
          )}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => window.dispatchEvent(new CustomEvent("desktop:settings", { detail:"models" }))}>管理模型</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
