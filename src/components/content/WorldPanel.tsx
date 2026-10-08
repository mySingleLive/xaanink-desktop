"use client"
import { worldDisplayName } from "@/lib/world-schema"

import { useEffect, useMemo, useRef, useState } from "react"
import { useRegisterCommentSave } from "@/components/comments/comment-save-coordinator"
import { browserTextHash } from "@/lib/text-baseline"
import type { TextBaseline } from "@/lib/services/target-text"
import { DraftConflictTools } from "./DraftConflictTools"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ChevronRight,
  Globe,
  Loader2,
  Map as MapIcon,
  Plus,
  Sparkles,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { MarkdownEditor } from "@/components/editor/MarkdownEditor"
import { cn } from "@/lib/utils"
import type { SettingType } from "@/generated/prisma/enums"
import { getTabIcon, useTabsStore } from "@/stores/tabs"
import { useStagedChangesStore } from "@/stores/staged-changes"

import { apiGet, apiSend } from "./api"
import { SETTING_TYPE_LABELS, WORLD_SETTING_TYPE_ORDER } from "./labels"
import type { ContentPanelProps } from "./registry"
import { SettingEditor, type SettingItem } from "./SettingPanel"
import { defaultContent } from "./setting-content"
import { CreateLevelSystemDialog } from "./CreateLevelSystemDialog"
import type { WorldRecord } from "./types"
import {
  SaveStatusIndicator,
  useAutosave,
  useExternalSyncKey,
  useOwnSyncTokens,
} from "./use-autosave"

type Selection =
  | { kind: "description" }
  | { kind: "setting"; id: string; concept?: { name: string; key: number } }

/** 各设定独立保留草稿与版本令牌，AI切换焦点不会卸载正在编辑的另一项。 */
function WorldSettingSurface({ novelId, worldId, setting, focusConcept, onSaved, onDeleted }: {
  novelId: string; worldId: string; setting: SettingItem; focusConcept?: { name: string; key: number }; onSaved: () => void; onDeleted: () => void
}) {
  const ownSaves = useOwnSyncTokens<number | null>()
  const [dirty, setDirty] = useState(false)
  const syncKey = useExternalSyncKey(setting.version, ownSaves.isOwn, dirty)
  return <SettingEditor key={`${setting.id}:${syncKey}`} novelId={novelId} worldId={worldId} setting={setting} settingType={setting.type} focusConcept={focusConcept}
    onDirtyChange={setDirty} onSaved={version => { ownSaves.track(version); onSaved() }} onDeleted={onDeleted} />
}

/** 世界观介绍编辑区：世界名 + 文字介绍（markdown），自动保存 */
function WorldDescriptionEditor({
  novelId,
  world,
  onRenamed,
  onSaved,
  onDirtyChange,
}: {
  novelId: string
  world: WorldRecord
  onRenamed: (name: string) => void
  /* 保存成功回传服务端 updatedAt：父层登记为自己的回写，避免 key 重挂载重置编辑器 */
  onSaved: (updatedAt: string) => void
  onDirtyChange: (dirty: boolean) => void
}) {
  const [name, setName] = useState(world.name ?? "")
  const nameRef = useRef(world.name ?? "")
  const [description, setDescription] = useState(world.description)
  const descriptionRef = useRef(world.description)
  const savedRef = useRef({ description: world.description, updatedAt: world.updatedAt })
  const saveRequests = useRef(new Map<string, { name: string; description: string; operationId: string; baseline: TextBaseline }>())
  const [conflict, setConflict] = useState<string | null>(null)

  const save = async (value: { name: string; description: string }, attempt: { operationId: string }) => {
    try {
      if (!saveRequests.current.has(attempt.operationId)) {
        const before = savedRef.current
        saveRequests.current.set(attempt.operationId, { ...value, operationId: attempt.operationId, baseline: { version: null, updatedAt: before.updatedAt, hash: await browserTextHash(before.description) } })
      }
      const res = await apiSend<{ world: WorldRecord }>(
        `/api/novels/${novelId}/worlds/${world.id}`,
        "PATCH",
        saveRequests.current.get(attempt.operationId),
        "保存世界失败"
      )
      if (value.name !== world.name) onRenamed(value.name)
      savedRef.current = { description: res.world.description, updatedAt: res.world.updatedAt }
      saveRequests.current.delete(attempt.operationId)
      setConflict(null)
      onSaved(res.world.updatedAt)
    } catch (err) {
      setConflict(err instanceof Error ? err.message : "保存世界失败")
      toast.error(err instanceof Error ? err.message : "保存世界失败")
      throw err
    }
  }

  const { status, schedule, saveNow, flush, controller, retry } = useAutosave(save)
  useEffect(() => { onDirtyChange(status === "pending" || status === "saving" || status === "error") }, [status, onDirtyChange])
  useRegisterCommentSave(novelId, "WORLD", world.id, {
    identity: controller,
    flush, revision: () => controller.revision,
    read: () => ({ text: descriptionRef.current, version: null, updatedAt: savedRef.current.updatedAt }),
    pause: () => { controller.pause(); onDirtyChange(true) },
    conflict: message => { controller.pause(); setConflict(message); onDirtyChange(true) },
    receive: (receipt, text, localRevision) => {
      if (receipt.updatedAt < savedRef.current.updatedAt) return
      onSaved(receipt.updatedAt)
      if (!controller.confirmExternal(localRevision)) { setConflict("评论保存期间有新输入，本地草稿已保留，请比较当前稿"); return }
      savedRef.current = { description: text, updatedAt: receipt.updatedAt }; descriptionRef.current = text; setDescription(text)
      controller.resume(); setConflict(null); onDirtyChange(false)
    },
  })

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {conflict && <div role="alert" className="text-sm text-destructive">{conflict}<Button size="sm" variant="ghost" onClick={() => void retry().catch(error => toast.error(error.message))}>重试原保存</Button>
        <DraftConflictTools readLocal={() => ({ title: nameRef.current, text: descriptionRef.current, data: { updatedAt: savedRef.current.updatedAt } })}
          readCurrent={async () => { const { worlds } = await apiGet<{ worlds: WorldRecord[] }>(`/api/novels/${novelId}/worlds`); const current = worlds.find(row => row.id === world.id); if (!current) throw new Error("世界已不存在，本地草稿仍保留"); return { title: current.name, text: current.description, data: { updatedAt: current.updatedAt } } }}
          revision={() => controller.revision} pause={() => controller.pause()}
          saveLocal={async (current, local, operationId, revision) => {
            const { world: saved } = await apiSend<{ world: WorldRecord }>(`/api/novels/${novelId}/worlds/${world.id}`, "PATCH", { name: local.title, description: local.text, operationId, baseline: { version: null, updatedAt: current.data.updatedAt, hash: await browserTextHash(current.text) } })
            onSaved(saved.updatedAt)
            if (!controller.confirmExternal(revision)) throw new Error("已保存比较稿，期间的新输入已保留，请重新比较")
            savedRef.current = { description: saved.description, updatedAt: saved.updatedAt }; descriptionRef.current = saved.description; nameRef.current = saved.name; setName(saved.name); setDescription(saved.description); onRenamed(saved.name); setConflict(null); onDirtyChange(false)
          }}
          adoptCurrent={(current, revision) => {
            if (!controller.confirmExternal(revision)) throw new Error("仍有未确认保存，请稍后核对")
            savedRef.current = { description: current.text, updatedAt: current.data.updatedAt }; descriptionRef.current = current.text; nameRef.current = current.title; setName(current.title); setDescription(current.text); onRenamed(current.title); onSaved(current.data.updatedAt); setConflict(null); onDirtyChange(false)
          }}
        />
      </div>}
      <div className="flex items-center gap-3">
        <Input
          value={name}
          onChange={(e) => {
            onDirtyChange(true)
            nameRef.current = e.target.value
            setName(e.target.value)
            if (e.target.value.trim()) schedule({ name: e.target.value, description })
          }}
          onBlur={() => saveNow()}
          placeholder="世界名称"
          className="max-w-64 font-medium"
        />
        <SaveStatusIndicator status={status} />
      </div>
      <div className="min-h-0 flex-1">
        <MarkdownEditor
          value={description}
          onChange={(next) => {
            onDirtyChange(true); descriptionRef.current = next
            setDescription(next)
            schedule({ name, description: next })
          }}
          placeholder="写下这个世界的基本面貌：时代、地理、规则、基调……"
          commentsTarget={{ novelId, targetType: "WORLD", targetId: world.id }}
          className="h-full"
        />
      </div>
    </div>
  )
}

/** 「添加设定」下拉：列出全部世界级分类（含世界地图） */
function AddSettingMenu({
  onPick,
  disabled,
}: {
  onPick: (type: SettingType) => void
  disabled?: boolean
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" className="w-full" disabled={disabled}>
            <Plus />
            添加设定
          </Button>
        }
      />
      <DropdownMenuContent align="start" className="w-44">
        <DropdownMenuGroup>
          <DropdownMenuLabel>选择设定分类</DropdownMenuLabel>
          {WORLD_SETTING_TYPE_ORDER.map((type) => {
            const Icon = getTabIcon({ type: "setting", settingType: type })
            return (
              <DropdownMenuItem key={type} onClick={() => onPick(type)}>
                <Icon />
                {SETTING_TYPE_LABELS[type]}
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** 世界面板（type=world）：左列导航（介绍 + 各设定分类 + 地图树），右区编辑器 */
export function WorldPanel({ novelId, refId: worldId }: ContentPanelProps) {
  const queryClient = useQueryClient()
  const renameWorldTab = useTabsStore((s) => s.renameWorldTab)
  // 初始选中：若对话面板实体芯片刚请求了本面板的设定聚焦，直接以它为初始值（只读快照，不消费）
  const [selection, setSelection] = useState<Selection>(() => {
    const focus = useTabsStore.getState().panelFocus
    return worldId && focus?.tabId === `world:${worldId}` && focus.settingId
      ? {
          kind: "setting",
          id: focus.settingId,
          concept: focus.concept ? { name: focus.concept, key: Date.now() } : undefined,
        }
      : { kind: "description" }
  })
  const [mapExpanded, setMapExpanded] = useState<Record<string, boolean>>({})

  // 聚焦请求接力：挂载时消费初始读到的遗留请求；之后的新请求经订阅在回调里应用
  useEffect(() => {
    if (!worldId) return
    const tabId = `world:${worldId}`
    const { panelFocus, consumePanelFocus } = useTabsStore.getState()
    if (panelFocus?.tabId === tabId) consumePanelFocus(tabId)
    return useTabsStore.subscribe((state) => {
      if (state.panelFocus?.tabId !== tabId) return
      const focus = useTabsStore.getState().consumePanelFocus(tabId)
      if (focus) {
        setSelection(focus.settingId ? {
          kind: "setting",
          id: focus.settingId,
          concept: focus.concept ? { name: focus.concept, key: Date.now() } : undefined,
        } : { kind: "description" })
      }
    })
  }, [worldId])

  const { data: worldsData, isLoading: worldsLoading } = useQuery({
    queryKey: ["worlds", novelId],
    queryFn: () => apiGet<{ worlds: WorldRecord[] }>(`/api/novels/${novelId}/worlds`, "加载世界失败"),
    enabled: !!worldId,
  })

  const { data: settingsData, isLoading: settingsLoading } = useQuery({
    queryKey: ["settings", "world", worldId],
    queryFn: () =>
      apiGet<{ settings: SettingItem[] }>(
        `/api/novels/${novelId}/settings?worldId=${worldId}`,
        "加载设定失败"
      ),
    enabled: !!worldId,
  })

  const invalidateSettings = () => {
    queryClient.invalidateQueries({ queryKey: ["settings", "world", worldId] })
    queryClient.invalidateQueries({ queryKey: ["novels", novelId] }); queryClient.invalidateQueries({queryKey: ["scene-factions", novelId]})
  }
  const invalidateWorlds = () =>
    queryClient.invalidateQueries({ queryKey: ["worlds", novelId] })

  /* 自己的自动保存令牌登记（见 useOwnSyncTokens/useExternalSyncKey）：保存回写不再触发 key 重挂载 */
  const ownWorldSaves = useOwnSyncTokens<string | null>()
  const [worldDirty, setWorldDirty] = useState(false)
  /** 等级体系创建对话框（其余分类维持直接创建） */
  const [levelSystemDialogOpen, setLevelSystemDialogOpen] = useState(false)

  const createMutation = useMutation({
    mutationFn: async ({ type, parentId, name, content }: { type: SettingType; parentId?: string; name?: string; content?: unknown }) => {
      const siblings = (settingsData?.settings ?? []).filter((s) =>
        parentId ? s.parentId === parentId : s.type === type && !s.parentId
      )
      const names = new Set(siblings.map((s) => s.name))
      let n = 1
      while (names.has(`未命名设定 ${n}`)) n += 1
      return apiSend<{ setting: SettingItem }>(
        `/api/novels/${novelId}/settings`,
        "POST",
        {
          type,
          name: name?.trim() || `未命名设定 ${n}`,
          content: content ?? defaultContent(type),
          worldId,
          parentId,
        },
        "创建失败"
      )
    },
    onSuccess: ({ setting }) => {
      // 三阶段保存：创建被暂存拦截（合成 staged- 前缀 id，尚未落库）。把合成实体注入列表缓存，
      // 让左栏立刻出现并可选中编辑。此处不能 invalidate 设定列表（重取只回已落库数据会把它冲掉）；
      // 阶段三落库后由发送链路的失效逻辑用真实数据覆盖。侧栏角标经 novels 查询失效刷新。
      queryClient.setQueryData<{ settings: SettingItem[] }>(
        ["settings", "world", worldId],
        (old) => {
          const list = old?.settings ?? []
          if (list.some((s) => s.id === setting.id)) return { settings: list }
          return { settings: [...list, setting] }
        }
      )
      queryClient.invalidateQueries({ queryKey: ["novels", novelId] }); queryClient.invalidateQueries({queryKey: ["scene-factions", novelId]})
      setSelection({ kind: "setting", id: setting.id })
    },
    onError: (err) => toast.error(err.message),
  })

  const pickSettingType = (type: SettingType) => {
    if (type === "LEVEL_SYSTEM") setLevelSystemDialogOpen(true)
    else createMutation.mutate({ type })
  }

  /* 派生数据与重挂载令牌必须在早退之前计算（hook 顺序稳定） */
  const world = worldsData?.worlds.find((w) => w.id === worldId)
  const stagedBatches = useStagedChangesStore((s) => s.batches)
  /* 三阶段保存：列表重取只回已落库数据。把暂存仓中本世界的「新增设定」合成条目回补进列表、
     并过滤已被暂存「删除」的条目——否则任意一次列表失效重取都会冲掉未落库的新设定、
     或让已暂存删除的设定重新出现（落库后暂存仓清空，此处自然不再回补/过滤）。 */
  const settings = useMemo(() => {
    const server = settingsData?.settings ?? []
    const deletedIds = new Set<string>()
    const created: SettingItem[] = []
    for (const batch of Object.values(stagedBatches)) {
      if (batch.novelId !== novelId) continue
      for (const change of batch.changes) {
        if (change.targetKind !== "SETTING") continue
        if (change.op === "delete") { deletedIds.add(change.targetId); continue }
        if (change.op !== "create" || !change.targetId.startsWith("staged-")) continue
        const body = change.request.body as
          | { type?: SettingType; name?: string; content?: unknown; worldId?: string | null; parentId?: string | null }
          | undefined
        if (!body || (body.worldId ?? null) !== worldId) continue
        created.push({
          id: change.targetId,
          type: body.type ?? "CONCEPT",
          name: change.targetLabel || body.name || "未命名设定",
          content: body.content ?? {},
          version: 1,
          worldId: body.worldId ?? null,
          parentId: body.parentId ?? null,
        })
      }
    }
    return [
      ...server.filter((s) => !deletedIds.has(s.id) && !created.some((c) => c.id === s.id)),
      ...created.filter((c) => !deletedIds.has(c.id)),
    ]
  }, [settingsData, stagedBatches, novelId, worldId])
  const selectedSetting =
    selection.kind === "setting" ? settings.find((s) => s.id === selection.id) : undefined
  /* 外部写入才推进的重挂载令牌（自己的保存回写保持原 key） */
  const worldSyncKey = useExternalSyncKey(world?.updatedAt ?? null, ownWorldSaves.isOwn, worldDirty)

  if (!worldId) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        缺少世界参数
      </div>
    )
  }
  if (worldsLoading || settingsLoading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    )
  }

  if (!world) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        世界不存在或已被删除
      </div>
    )
  }

  const effectiveSelection: Selection =
    selection.kind === "setting" && !selectedSetting ? { kind: "description" } : selection

  // 世界地图按 parentId 组树，其余分类平铺
  const maps = settings.filter((s) => s.type === "MAP")
  const childMapsOf = (id: string | null) =>
    maps.filter((m) => m.parentId === id).sort((a, b) => a.name.localeCompare(b.name))
  const groups = WORLD_SETTING_TYPE_ORDER.filter((t) => t !== "MAP")
    .map((type) => ({ type, records: settings.filter((s) => s.type === type) }))
    .filter((g) => g.records.length > 0)
  const hasMaps = maps.length > 0

  const railItemCls = (active: boolean) =>
    cn(
      "group flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm",
      active ? "bg-primary/10 font-medium text-primary" : "hover:bg-muted"
    )

  const renderMapNode = (map: SettingItem, depth: number) => {
    const children = childMapsOf(map.id)
    const expanded = mapExpanded[map.id] ?? true
    const active = effectiveSelection.kind === "setting" && effectiveSelection.id === map.id
    return (
      <div key={map.id}>
        <div className={cn(railItemCls(active), "pr-1")} style={{ paddingLeft: `${depth * 14 + 8}px` }}>
          <button
            type="button"
            aria-label={expanded ? "收起" : "展开"}
            onClick={() => setMapExpanded((prev) => ({ ...prev, [map.id]: !expanded }))}
            className={cn(
              "flex size-3.5 shrink-0 items-center justify-center text-muted-foreground",
              children.length === 0 && "invisible"
            )}
          >
            <ChevronRight className={cn("size-3 transition-transform", expanded && "rotate-90")} />
          </button>
          <button
            type="button"
            onClick={() => setSelection({ kind: "setting", id: map.id })}
            className="flex min-w-0 flex-1 items-center gap-1.5"
          >
            <span className="truncate">{map.name}</span>
          </button>
          <button
            type="button"
            aria-label="添加子地图"
            title="添加子地图"
            disabled={createMutation.isPending}
            onClick={() => createMutation.mutate({ type: "MAP", parentId: map.id })}
            className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-muted-foreground/15"
          >
            <Plus className="size-3.5" />
          </button>
        </div>
        {expanded && children.map((c) => renderMapNode(c, depth + 1))}
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 max-[679px]:flex-col">
      <div className="flex w-60 shrink-0 flex-col border-r max-[679px]:max-h-48 max-[679px]:w-full max-[679px]:border-r-0 max-[679px]:border-b">
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <Globe className="size-4 text-muted-foreground" />
          <span className="truncate text-sm font-medium">{worldDisplayName(world.name)}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          <button
            type="button"
            onClick={() => setSelection({ kind: "description" })}
            className={railItemCls(effectiveSelection.kind === "description")}
          >
            <Sparkles className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">世界观介绍</span>
          </button>

          {groups.map(({ type, records }) => {
            const Icon = getTabIcon({ type: "setting", settingType: type })
            return (
              <div key={type} className="mt-2">
                <div className="group flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground">
                  <Icon className="size-3.5" />
                  <span className="flex-1">{SETTING_TYPE_LABELS[type]}</span>
                  <button
                    type="button"
                    aria-label={`新增${SETTING_TYPE_LABELS[type]}`}
                    disabled={createMutation.isPending}
                    onClick={() => pickSettingType(type)}
                    className="flex size-4 items-center justify-center rounded opacity-0 group-hover:opacity-100 hover:bg-muted-foreground/15"
                  >
                    <Plus className="size-3" />
                  </button>
                </div>
                {records.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setSelection({ kind: "setting", id: r.id })}
                    className={railItemCls(
                      effectiveSelection.kind === "setting" && effectiveSelection.id === r.id
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{r.name}</span>
                    <span className="text-xs text-muted-foreground">v{r.version}</span>
                  </button>
                ))}
              </div>
            )
          })}

          <div className="mt-2">
            <div className="group flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground">
              <MapIcon className="size-3.5" />
              <span className="flex-1">{SETTING_TYPE_LABELS.MAP}</span>
              <button
                type="button"
                aria-label="新增世界地图"
                disabled={createMutation.isPending}
                onClick={() => createMutation.mutate({ type: "MAP" })}
                className="flex size-4 items-center justify-center rounded opacity-0 group-hover:opacity-100 hover:bg-muted-foreground/15"
              >
                <Plus className="size-3" />
              </button>
            </div>
            {hasMaps ? (
              childMapsOf(null).map((m) => renderMapNode(m, 0))
            ) : (
              <p className="px-2 py-1 text-xs text-muted-foreground/70">暂无地图</p>
            )}
          </div>
        </div>
        <div className="border-t p-1.5">
          <AddSettingMenu
            disabled={createMutation.isPending}
            onPick={pickSettingType}
          />
        </div>
      </div>

      <div data-testid="world-content" className="min-h-0 min-w-0 flex-1 p-4">
        <div hidden={effectiveSelection.kind !== "description"} className="h-full">
          <WorldDescriptionEditor
            key={`${world.id}:${worldSyncKey}`}
            novelId={novelId}
            world={world}
            onDirtyChange={setWorldDirty}
            onRenamed={(name) => renameWorldTab(world.id, name)}
            onSaved={(updatedAt) => {
              ownWorldSaves.track(updatedAt)
              invalidateWorlds()
            }}
          />
        </div>
        {settings.map(setting => <div key={setting.id} hidden={effectiveSelection.kind !== "setting" || effectiveSelection.id !== setting.id} className="h-full">
          <WorldSettingSurface novelId={novelId} worldId={worldId} setting={setting}
            focusConcept={effectiveSelection.kind === "setting" && effectiveSelection.id === setting.id ? effectiveSelection.concept : undefined}
            onSaved={() => { if (!setting.id.startsWith("staged-")) invalidateSettings() }} onDeleted={() => { invalidateSettings(); setSelection({ kind: "description" }) }} />
        </div>)}
      </div>

      <CreateLevelSystemDialog
        open={levelSystemDialogOpen}
        onOpenChange={setLevelSystemDialogOpen}
        disabled={createMutation.isPending}
        onCreate={({ name, scope, form }) =>
          createMutation.mutate({
            type: "LEVEL_SYSTEM",
            name,
            content: { scope, form, description: "", rules: "", levels: [], pathways: [] },
          })
        }
      />
    </div>
  )
}
