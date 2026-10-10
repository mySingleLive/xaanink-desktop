"use client"
import { GlobalSceneTree, openAllScenes } from "@/components/content/scene/SceneWorkspace"
import { worldDisplayName } from "@/lib/world-schema"
import { worldForest } from "@/lib/world-tree"
import { useDesktopCommands } from "@/lib/desktop/use-command-target"
import { useNovelList } from "@/lib/novel-list"
import { UnavailableWorks } from "@/components/desktop/UnavailableWorks"

import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  AlertCircle,
  BookOpen,
  ChartNoAxesGantt,
  ChevronRight,
  ClipboardCheck,
  Eye,
  FileText,
  Flag,
  FlaskConical,
  Ghost,
  Globe,
  Heart,
  Lightbulb,
  ListTree,
  Loader2,
  MapPin,
  MessageSquare,
  MessageSquarePlus,
  MoreHorizontal,
  Package,
  Palette,
  PanelLeft,
  Pencil,
  Plus,
  RefreshCw,
  Settings,
  Settings2,
  SlidersHorizontal,
  Trash2,
  UserRound,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react"
import { SidebarWindowControls } from "@/components/desktop/WindowControls"
import { updateDesktopSettings } from "@/stores/desktop"

import { useTheme } from "next-themes"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import { isTentativeNovelTitle } from "@/lib/novel-title"
import { TentativeBadge } from "@/components/ui/tentative-badge"
import { manuscriptTitle } from "@/lib/manuscript-export"
import { useChatStore } from "@/stores/chat"
import {
  buildTabId,
  getTabIcon,
  useTabsStore,
  type TabType,
} from "@/stores/tabs"
import type { CharacterRoleType, SettingType } from "@/generated/prisma/enums"

import { buildCharacterChip, startChipDrag } from "../chat/chip-drag"
import type { ChipData } from "../chat/composer-editor"
import {
  CHAPTER_STATUS_LABELS,
  CHARACTER_ROLE_LABELS,
  NOVEL_SETTING_TYPE_ORDER,
  SETTING_TYPE_LABELS,
} from "../content/labels"
import { firstSentence } from "../chat/use-entity-index"
import { CHAPTER_STATUS_ICONS } from "../content/chapter-status"
import { CroppedImage } from "../content/CroppedImage"
import { CreateNovelDialog } from "./CreateNovelDialog"
import { OutlineTreeMenu } from "./OutlineTreeMenu"
import {
  CharactersHeaderHoverCard,
  HOVER_SHOW_MS,
  NovelHoverCard,
  SettingTypeHoverCard,
  SidebarHoverCard,
  SidebarHoverProvider,
  ThemeHoverCard,
  staticHoverCard,
  useSidebarHover,
} from "./SidebarHoverCard"
import { ScenarioCreateDialog, type ScenarioCreatePayload } from "./ScenarioCreateDialog"
import {
  normalizeCrop,
  type CharacterRecord,
  type NovelDetail,
  type NovelSummary,
  type WorldRecord,
} from "../content/types"

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string }
    return data.error ?? fallback
  } catch {
    return fallback
  }
}

interface TreeNodeProps {
  icon: LucideIcon
  label: string
  depth: number
  active?: boolean
  expandable?: boolean
  expanded?: boolean
  dimmed?: boolean
  onToggle?: () => void
  onClick?: () => void
  /** 名字后的小标记（如主角「主」签） */
  tag?: React.ReactNode
  /** 替换默认图标的自定义节点（如角色头像缩略图） */
  avatar?: React.ReactNode
  action?: React.ReactNode
  /**
   * 悬停简介卡（2026-09）：惰性渲染函数，悬停 ≥400ms 稳定后才挂载——
   * 需要取数的卡片（NovelHoverCard 等）借此延迟到真正悬停时才发查询。
   */
  hoverCard?: () => React.ReactNode
  /** 提供即整行可拖拽：拖入对话输入框插入对应引用芯片 */
  dragChip?: ChipData
}

function TreeNode({
  icon: Icon,
  label,
  depth,
  active,
  expandable,
  expanded,
  dimmed,
  onToggle,
  onClick,
  tag,
  avatar,
  action,
  hoverCard,
  dragChip,
}: TreeNodeProps) {
  const hover = useSidebarHover()
  const ownerRef = useRef<symbol>(Symbol())
  const rowRef = useRef<HTMLDivElement | null>(null)
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 卸载：清待定展示；若卡片正属于本行（树折叠等）一并收起
  useEffect(() => {
    const owner = ownerRef.current
    return () => {
      if (showTimer.current) clearTimeout(showTimer.current)
      hover?.hideNow(owner)
    }
  }, [hover])

  const showNow = () => {
    const rect = rowRef.current?.getBoundingClientRect()
    if (rect && hoverCard) {
      hover?.show(ownerRef.current, hoverCard, { x: rect.right + 8, y: rect.top })
    }
  }
  const onRowEnter = () => {
    if (!hoverCard || !hover) return
    if (hover.ownsCurrent(ownerRef.current)) return
    // 卡片已在别处打开：零延迟原位切换（无「先收再弹」过渡）
    if (hover.isOpen()) {
      showNow()
      return
    }
    if (showTimer.current) return
    showTimer.current = setTimeout(() => {
      showTimer.current = null
      showNow()
    }, HOVER_SHOW_MS)
  }
  const onRowLeave = () => {
    if (!hoverCard || !hover) return
    if (showTimer.current) {
      clearTimeout(showTimer.current)
      showTimer.current = null
    }
    hover.scheduleHide(ownerRef.current)
  }

  return (
    <div
      ref={rowRef}
      role="button"
      tabIndex={0}
      draggable={!!dragChip}
      onDragStart={dragChip ? (e) => startChipDrag(e, dragChip) : undefined}
      title={dragChip ? "可拖拽到对话输入框引用" : undefined}
      onClick={() => {
        hover?.hideNow(ownerRef.current)
        onClick?.()
      }}
      onMouseEnter={onRowEnter}
      onMouseLeave={onRowLeave}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onClick?.()
        }
      }}
      className={cn(
        "group relative flex h-7 cursor-pointer items-center gap-[5px] rounded-[5px] pr-1.5 text-[13px] select-none",
        active
          ? "bg-active-wash font-medium text-primary"
          : "hover:bg-hover-wash",
        dimmed && "text-muted-foreground"
      )}
      style={{ paddingLeft: `${depth * 14 + 6}px` }}
    >
      {expandable ? (
        <button
          type="button"
          aria-label={expanded ? "收起" : "展开"}
          onClick={(e) => {
            e.stopPropagation()
            onToggle?.()
          }}
          className="flex size-3.5 shrink-0 items-center justify-center text-muted-foreground"
        >
          <ChevronRight
            className={cn("size-3 transition-transform", expanded && "rotate-90")}
          />
        </button>
      ) : (
        <span className="size-3.5 shrink-0" />
      )}
      {avatar ?? (
        <Icon
          className={cn(
            "size-3.5 shrink-0",
            active ? "text-primary" : "text-muted-foreground"
          )}
        />
      )}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {tag}
      {action && <span
        className="flex shrink-0"
        onClick={event => event.stopPropagation()}
        onKeyDown={event => event.stopPropagation()}
        onMouseEnter={() => {
          if (showTimer.current) { clearTimeout(showTimer.current); showTimer.current = null }
          hover?.hideNow(ownerRef.current)
        }}
      >{action}</span>}
    </div>
  )
}

/** GET /api/novels/[id]/scenarios 列表项（附回合/情节点计数） */
interface ScenarioSummary {
  id: string
  novelId: string
  title: string
  status: string
  turnCount: number
  nodeCount: number
}

/** GET /api/novels/[id]/foreshadow-characters 列表项 */
interface ForeshadowCharacterRecord {
  id: string
  novelId: string
  name: string
  note: string
  avatarUrl: string | null
  revealedCharacterId: string | null
}

type DialogState =
  | { type: "rename"; novel: NovelSummary }
  | { type: "delete"; novel: NovelSummary }
  | { type: "world-create"; novel: NovelSummary; parentWorld?: WorldRecord }
  | { type: "world-rename"; novel: NovelSummary; world: WorldRecord }
  | { type: "world-delete"; novel: NovelSummary; world: WorldRecord }
  | { type: "scenario-create"; novel: NovelSummary }
  | { type: "scenario-rename"; novel: NovelSummary; scenario: ScenarioSummary }
  | { type: "scenario-delete"; novel: NovelSummary; scenario: ScenarioSummary }
  | null

const CHARACTER_ROLE_ORDER: CharacterRoleType[] = [
  "PROTAGONIST",
  "SUPPORTING",
  "ANTAGONIST",
]

/** 「角色」分组展开后的真实角色子树：按角色类型分组，叶子节点打开角色 tab */
function CharacterSubtree({
  novel,
  expanded,
  toggle,
}: {
  novel: NovelSummary
  expanded: Record<string, boolean>
  toggle: (key: string) => void
}) {
  const openTab = useTabsStore((s) => s.openTab)
  const activeTabId = useTabsStore((s) => s.activeTabId)

  const { data, isLoading } = useQuery({
    queryKey: ["characters", novel.id],
    queryFn: async () => {
      const res = await fetch(`/api/novels/${novel.id}/characters`)
      if (!res.ok) throw new Error("加载角色失败")
      return (await res.json()) as { characters: CharacterRecord[] }
    },
  })

  if (isLoading) {
    return (
      <div className="flex justify-center py-2 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
      </div>
    )
  }

  const characters = data?.characters ?? []
  if (characters.length === 0) {
    return (
      <>
        <TreeNode icon={Users} label="暂无角色" depth={2} dimmed />
        <ForeshadowCharacterSection novel={novel} expanded={expanded} toggle={toggle} />
      </>
    )
  }

  return (
    <>
      {CHARACTER_ROLE_ORDER.map((roleType) => {
        const group = characters.filter((c) => c.roleType === roleType)
        if (group.length === 0) return null
        const groupKey = `${novel.id}:character:${roleType}`
        const groupExpanded = expanded[groupKey] ?? true
        return (
          <div key={roleType}>
            <TreeNode
              icon={Users}
              label={`${CHARACTER_ROLE_LABELS[roleType]}（${group.length}）`}
              depth={2}
              expandable
              expanded={groupExpanded}
              onToggle={() => toggle(groupKey)}
              onClick={() => toggle(groupKey)}
              hoverCard={() => (
                <SidebarHoverCard
                  data={{
                    title: `${CHARACTER_ROLE_LABELS[roleType]}（${group.length}）`,
                    icon: Users,
                    blurb: group.map((c) => c.name).join("、"),
                  }}
                />
              )}
            />
            {groupExpanded &&
              group.map((c) => (
                <TreeNode
                  key={c.id}
                  icon={UserRound}
                  dragChip={buildCharacterChip({ name: c.name, avatarUrl: c.avatarUrl })}
                  avatar={
                    c.avatarUrl ? (
                      <span className="relative size-5 shrink-0 overflow-hidden rounded-full">
                        <CroppedImage
                          src={c.avatarUrl}
                          crop={normalizeCrop(c.avatarCrop)}
                          alt={c.name}
                        />
                      </span>
                    ) : undefined
                  }
                  label={c.name}
                  depth={3}
                  active={
                    activeTabId === buildTabId("character", novel.id, { refId: c.id })
                  }
                  tag={
                    roleType === "PROTAGONIST" ? (
                      <span className="shrink-0 rounded-[3px] border border-primary/30 bg-active-wash px-1 text-[9.5px] leading-[1.5] text-primary">
                        主
                      </span>
                    ) : undefined
                  }
                  hoverCard={() => (
                    <SidebarHoverCard
                      data={{
                        title: c.name,
                        subtitle: `角色 · ${CHARACTER_ROLE_LABELS[c.roleType]}`,
                        imageUrl: c.avatarUrl,
                        imageCrop: c.avatarCrop,
                        roundImage: true,
                        icon: UserRound,
                        blurb: firstSentence(c.bio || c.personality || c.appearance),
                        meta: [c.occupation, c.age, c.gender].filter((x) => !!x?.trim()),
                      }}
                    />
                  )}
                  onClick={() =>
                    openTab({
                      id: buildTabId("character", novel.id, { refId: c.id }),
                      type: "character",
                      novelId: novel.id,
                      refId: c.id,
                      title: c.name,
                    })
                  }
                />
              ))}
          </div>
        )
      })}
      <ForeshadowCharacterSection novel={novel} expanded={expanded} toggle={toggle} />
    </>
  )
}

/**
 * 「角色」分组内的伏笔角色栏：身份未明的小说级实体（「老者」），可在叙事线中引用。
 * 列表为空时不渲染该栏；叶子为虚线环首字符头像 + 「伏笔」角标，
 * 悬停菜单：重命名 / 转为正式角色 / 揭示为正式角色… / 删除。
 */
function ForeshadowCharacterSection({
  novel,
  expanded,
  toggle,
}: {
  novel: NovelSummary
  expanded: Record<string, boolean>
  toggle: (key: string) => void
}) {
  const queryClient = useQueryClient()
  const openTab = useTabsStore((s) => s.openTab)

  const [dialog, setDialog] = useState<
    | { type: "rename"; fc: ForeshadowCharacterRecord }
    | { type: "promote"; fc: ForeshadowCharacterRecord }
    | { type: "reveal"; fc: ForeshadowCharacterRecord }
    | { type: "delete"; fc: ForeshadowCharacterRecord }
    | null
  >(null)
  const [nameInput, setNameInput] = useState("")
  const [revealTargetId, setRevealTargetId] = useState("")

  const { data, isLoading } = useQuery({
    queryKey: ["foreshadow-characters", novel.id],
    queryFn: async () => {
      const res = await fetch(`/api/novels/${novel.id}/foreshadow-characters`)
      if (!res.ok) throw new Error("加载伏笔角色失败")
      return (await res.json()) as { foreshadowCharacters: ForeshadowCharacterRecord[] }
    },
  })

  // 揭示候选正式角色：与角色子树共享 ["characters", novelId] 缓存，命中零额外请求
  const { data: charactersData } = useQuery({
    queryKey: ["characters", novel.id],
    queryFn: async () => {
      const res = await fetch(`/api/novels/${novel.id}/characters`)
      if (!res.ok) throw new Error("加载角色失败")
      return (await res.json()) as { characters: CharacterRecord[] }
    },
  })

  const invalidateForeshadows = () =>
    queryClient.invalidateQueries({ queryKey: ["foreshadow-characters", novel.id] })
  /** 转正/揭示后正式角色列表也会变化，两个 key 一起失效 */
  const invalidateCharactersAndForeshadows = () => {
    queryClient.invalidateQueries({ queryKey: ["characters", novel.id] })
    invalidateForeshadows()
  }

  const renameMutation = useMutation({
    mutationFn: async ({ fc, name }: { fc: ForeshadowCharacterRecord; name: string }) => {
      const res = await fetch(`/api/novels/${novel.id}/foreshadow-characters/${fc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      })
      if (!res.ok) throw new Error(await readError(res, "重命名失败"))
    },
    onSuccess: () => {
      toast.success("已重命名")
      invalidateForeshadows()
      setDialog(null)
    },
    onError: (err) => toast.error(err.message),
  })

  const promoteMutation = useMutation({
    mutationFn: async (fc: ForeshadowCharacterRecord) => {
      const res = await fetch(`/api/novels/${novel.id}/foreshadow-characters/${fc.id}/promote`, {
        method: "POST",
      })
      if (!res.ok) throw new Error(await readError(res, "转正失败"))
      return (await res.json()) as { character: CharacterRecord }
    },
    onSuccess: ({ character }, fc) => {
      toast.success(`「${fc.name}」已转为正式角色`)
      invalidateCharactersAndForeshadows()
      setDialog(null)
      openTab({
        id: buildTabId("character", novel.id, { refId: character.id }),
        type: "character",
        novelId: novel.id,
        refId: character.id,
        title: character.name,
      })
    },
    onError: (err) => toast.error(err.message),
  })

  const revealMutation = useMutation({
    mutationFn: async ({
      fc,
      characterId,
    }: {
      fc: ForeshadowCharacterRecord
      characterId: string
    }) => {
      const res = await fetch(`/api/novels/${novel.id}/foreshadow-characters/${fc.id}/reveal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ characterId }),
      })
      if (!res.ok) throw new Error(await readError(res, "揭示失败"))
    },
    onSuccess: (_data, { fc }) => {
      toast.success(`「${fc.name}」已揭示为正式角色`)
      invalidateCharactersAndForeshadows()
      setDialog(null)
    },
    onError: (err) => toast.error(err.message),
  })

  const deleteMutation = useMutation({
    mutationFn: async (fc: ForeshadowCharacterRecord) => {
      const res = await fetch(`/api/novels/${novel.id}/foreshadow-characters/${fc.id}`, {
        method: "DELETE",
      })
      if (!res.ok) throw new Error(await readError(res, "删除失败"))
    },
    onSuccess: (_data, fc) => {
      toast.success(`伏笔角色「${fc.name}」已删除`)
      invalidateForeshadows()
      setDialog(null)
    },
    onError: (err) => toast.error(err.message),
  })

  const foreshadows = data?.foreshadowCharacters ?? []
  if (isLoading || foreshadows.length === 0) return null

  const groupKey = `${novel.id}:character:foreshadow`
  const groupExpanded = expanded[groupKey] ?? true
  const characters = charactersData?.characters ?? []
  const confirmPending =
    promoteMutation.isPending || revealMutation.isPending || deleteMutation.isPending

  return (
    <>
      <TreeNode
        icon={Ghost}
        label={`伏笔角色（${foreshadows.length}）`}
        depth={2}
        expandable
        expanded={groupExpanded}
        onToggle={() => toggle(groupKey)}
        onClick={() => toggle(groupKey)}
        hoverCard={() => (
          <SidebarHoverCard
            data={{
              title: `伏笔角色（${foreshadows.length}）`,
              icon: Ghost,
              blurb: "身份未明、先行登记的角色；揭示或转正后进入正式角色列表。",
              meta: [foreshadows.map((f) => f.name).join("、")],
            }}
          />
        )}
      />
      {groupExpanded &&
        foreshadows.map((fc) => (
          <TreeNode
            key={fc.id}
            icon={UserRound}
            avatar={
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-dashed border-gold/70 text-[10px] leading-none text-gold select-none">
                {fc.name.slice(0, 1)}
              </span>
            }
            label={fc.name}
            depth={3}
            hoverCard={() => (
              <SidebarHoverCard
                data={{
                  title: fc.name,
                  subtitle: "伏笔角色",
                  icon: Ghost,
                  blurb: firstSentence(fc.note),
                  meta: [fc.revealedCharacterId ? "已揭示" : "未揭示"],
                }}
              />
            )}
            tag={
              <span className="shrink-0 rounded-[3px] border border-gold/40 bg-gold/10 px-1 text-[9.5px] leading-[1.5] text-gold">
                伏笔
              </span>
            }
            action={
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <button
                      type="button"
                      aria-label="伏笔角色操作"
                      onClick={(e) => e.stopPropagation()}
                      className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-muted-foreground/15 data-popup-open:opacity-100"
                    />
                  }
                >
                  <MoreHorizontal className="size-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-auto min-w-36">
                  <DropdownMenuItem
                    onClick={() => {
                      setNameInput(fc.name)
                      setDialog({ type: "rename", fc })
                    }}
                  >
                    <Pencil />
                    重命名
                  </DropdownMenuItem>
                  {!fc.revealedCharacterId && (
                    <DropdownMenuItem onClick={() => setDialog({ type: "promote", fc })}>
                      <UserRound />
                      转为正式角色
                    </DropdownMenuItem>
                  )}
                  {!fc.revealedCharacterId && (
                    <DropdownMenuItem
                      onClick={() => {
                        setRevealTargetId("")
                        setDialog({ type: "reveal", fc })
                      }}
                    >
                      <Eye />
                      揭示为正式角色…
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => setDialog({ type: "delete", fc })}
                  >
                    <Trash2 />
                    删除
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            }
          />
        ))}

      {/* 重命名伏笔角色 */}
      <Dialog
        open={dialog?.type === "rename"}
        onOpenChange={(open) => {
          if (!open) setDialog(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重命名伏笔角色</DialogTitle>
            <DialogDescription>
              给这个伏笔角色起个新名字，各处的引用展示同步更新。
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              const name = nameInput.trim()
              if (dialog?.type === "rename" && name) {
                renameMutation.mutate({ fc: dialog.fc, name })
              }
            }}
            className="flex flex-col gap-4"
          >
            <Input
              autoFocus
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder="如：老者、神秘人"
              maxLength={100}
            />
            <DialogFooter>
              <Button type="submit" disabled={!nameInput.trim() || renameMutation.isPending}>
                {renameMutation.isPending && <Loader2 className="animate-spin" />}
                保存
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 转为正式角色 / 揭示为正式角色 / 删除 的确认对话框 */}
      <Dialog
        open={
          dialog?.type === "promote" || dialog?.type === "reveal" || dialog?.type === "delete"
        }
        onOpenChange={(open) => {
          if (!open) setDialog(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialog?.type === "promote"
                ? "转为正式角色"
                : dialog?.type === "reveal"
                  ? "揭示为正式角色"
                  : "删除伏笔角色"}
            </DialogTitle>
            <DialogDescription>
              {dialog?.type === "promote"
                ? `将以「${dialog.fc.name}」新建一名正式角色（配角），各处伏笔引用同步归属该角色。`
                : dialog?.type === "reveal"
                  ? `选择「${dialog.fc.name}」的真实身份；揭示后各处伏笔引用将归属该角色。`
                  : dialog?.type === "delete"
                    ? `确定要删除伏笔角色「${dialog.fc.name}」吗？该操作不可撤销。`
                    : ""}
            </DialogDescription>
          </DialogHeader>
          {dialog?.type === "reveal" && (
            <Select
              value={revealTargetId || null}
              onValueChange={(v) => setRevealTargetId((v as string) ?? "")}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="选择正式角色" />
              </SelectTrigger>
              <SelectContent>
                {characters.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>
              取消
            </Button>
            <Button
              variant={dialog?.type === "delete" ? "destructive" : "default"}
              disabled={confirmPending || (dialog?.type === "reveal" && !revealTargetId)}
              onClick={() => {
                if (dialog?.type === "promote") promoteMutation.mutate(dialog.fc)
                if (dialog?.type === "reveal" && revealTargetId) {
                  revealMutation.mutate({ fc: dialog.fc, characterId: revealTargetId })
                }
                if (dialog?.type === "delete") deleteMutation.mutate(dialog.fc)
              }}
            >
              {confirmPending && <Loader2 className="animate-spin" />}
              {dialog?.type === "promote"
                ? "确认转正"
                : dialog?.type === "reveal"
                  ? "确认揭示"
                  : "确认删除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/**
 * 「情景试验场」分组下的试验场子树：叶子点击打开 scenario 面板 tab；
 * 悬停菜单支持重命名/删除（模式同其他子树）。
 */
function ScenarioSubtree({
  novel,
  onRename,
  onDelete,
}: {
  novel: NovelSummary
  onRename: (scenario: ScenarioSummary) => void
  onDelete: (scenario: ScenarioSummary) => void
}) {
  const openTab = useTabsStore((s) => s.openTab)
  const activeTabId = useTabsStore((s) => s.activeTabId)

  const { data, isLoading } = useQuery({
    queryKey: ["scenarios", novel.id],
    queryFn: async () => {
      const res = await fetch(`/api/novels/${novel.id}/scenarios`)
      if (!res.ok) throw new Error("加载情景试验场失败")
      return (await res.json()) as { scenarios: ScenarioSummary[] }
    },
  })

  if (isLoading) {
    return (
      <div className="flex justify-center py-2 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
      </div>
    )
  }

  const scenarios = data?.scenarios ?? []
  if (scenarios.length === 0) {
    return <TreeNode icon={FlaskConical} label="暂无试验场，点上方 + 新建" depth={2} dimmed />
  }

  return (
    <>
      {scenarios.map((scenario) => (
        <TreeNode
          key={scenario.id}
          icon={FlaskConical}
          label={scenario.title}
          hoverCard={() => (
            <SidebarHoverCard
              data={{
                title: scenario.title,
                subtitle: "情景试验场",
                icon: FlaskConical,
                meta: [`${scenario.turnCount} 回合`, `${scenario.nodeCount} 个情节点`],
              }}
            />
          )}
          depth={2}
          active={activeTabId === buildTabId("scenario", novel.id, { refId: scenario.id })}
          onClick={() =>
            openTab({
              id: buildTabId("scenario", novel.id, { refId: scenario.id }),
              type: "scenario",
              novelId: novel.id,
              refId: scenario.id,
              title: scenario.title,
            })
          }
          action={
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <button
                    type="button"
                    aria-label="试验场操作"
                    onClick={(e) => e.stopPropagation()}
                    className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-muted-foreground/15 data-popup-open:opacity-100"
                  />
                }
              >
                <MoreHorizontal className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-auto min-w-28">
                <DropdownMenuItem onClick={() => onRename(scenario)}>
                  <Pencil />
                  重命名
                </DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onClick={() => onDelete(scenario)}>
                  <Trash2 />
                  删除
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          }
        />
      ))}
    </>
  )
}

/**
 * 「世界观」分组下的世界子树：多世界树形嵌套（大千世界 → 小千世界），
 * 点击世界节点打开 world tab；悬停菜单支持添加子世界/重命名/删除。
 */
function WorldSubtree({
  novel,
  expanded,
  toggle,
  onCreateChild,
  onRename,
  onDelete,
}: {
  novel: NovelSummary
  expanded: Record<string, boolean>
  toggle: (key: string) => void
  onCreateChild: (parent: WorldRecord) => void
  onRename: (world: WorldRecord) => void
  onDelete: (world: WorldRecord) => void
}) {
  const openTab = useTabsStore((s) => s.openTab)
  const activeTabId = useTabsStore((s) => s.activeTabId)

  const { data, isLoading } = useQuery({
    queryKey: ["worlds", novel.id],
    queryFn: async () => {
      const res = await fetch(`/api/novels/${novel.id}/worlds`)
      if (!res.ok) throw new Error("加载世界失败")
      return (await res.json()) as { worlds: WorldRecord[] }
    },
  })

  if (isLoading) {
    return (
      <div className="flex justify-center py-2 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
      </div>
    )
  }

  const worlds = data?.worlds ?? []
  if (worlds.length === 0) {
    return <TreeNode icon={Globe} label="还没有世界，点上方 + 创建" depth={3} dimmed />
  }

  const forest = worldForest(worlds)
  const childrenOf = (parentId: string | null) => forest.children.get(parentId) ?? []

  const renderWorld = (world: WorldRecord, depth: number): React.ReactNode => {
    const children = childrenOf(world.id)
    const key = `world:${world.id}`
    const worldExpanded = expanded[key] ?? true
    const tabId = buildTabId("world", novel.id, { refId: world.id })
    return (
      <div key={world.id} data-world-id={world.id}>
        <TreeNode
          icon={Globe}
          label={worldDisplayName(world.name)}
          depth={depth}
          hoverCard={() => (
            <SidebarHoverCard
              data={{
                title: worldDisplayName(world.name),
                subtitle: world.parentId ? "子世界" : "主世界",
                icon: Globe,
                blurb: firstSentence(world.description),
                meta: [...(children.length > 0 ? [`${children.length} 个子世界`] : []), ...(forest.anomalies.has(world.id) ? ["名称或层级待核对，原记录已保留"] : [])],
              }}
            />
          )}
          expandable={children.length > 0}
          expanded={worldExpanded}
          active={activeTabId === tabId}
          onToggle={() => toggle(key)}
          onClick={() =>
            openTab({
              id: tabId,
              type: "world",
              novelId: novel.id,
              refId: world.id,
              title: worldDisplayName(world.name),
            })
          }
          action={
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <button
                    type="button"
                    aria-label="世界操作"
                    onClick={(e) => e.stopPropagation()}
                    className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-muted-foreground/15 data-popup-open:opacity-100"
                  />
                }
              >
                <MoreHorizontal className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-auto min-w-28">
                <DropdownMenuItem onClick={() => onCreateChild(world)}>
                  <Plus />
                  添加子世界
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onRename(world)}>
                  <Pencil />
                  重命名
                </DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onClick={() => onDelete(world)}>
                  <Trash2 />
                  删除
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          }
        />
        {worldExpanded && children.map((c) => renderWorld(c, depth + 1))}
      </div>
    )
  }

  return <>{forest.roots.map((w) => renderWorld(w, 3))}</>
}

/**
 * 「大纲」/「正文」分组的卷→章子树（复用小说详情查询，含卷章结构）。
 * kind=outline 时章节点打开 chapter-outline tab；kind=content 时打开 chapter-content tab。
 */
function OutlineSubtree({
  novel,
  kind,
  expanded,
  toggle,
}: {
  novel: NovelSummary
  kind: "outline" | "content"
  expanded: Record<string, boolean>
  toggle: (key: string) => void
}) {
  const openTab = useTabsStore((s) => s.openTab)
  const activeTabId = useTabsStore((s) => s.activeTabId)

  const { data, isLoading } = useQuery<{ novel: NovelDetail }>({
    queryKey: ["novels", novel.id],
    queryFn: async () => {
      const res = await fetch(`/api/novels/${novel.id}`)
      if (!res.ok) throw new Error("加载小说详情失败")
      return res.json()
    },
  })

  if (isLoading) {
    return (
      <div className="flex justify-center py-2 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
      </div>
    )
  }

  const volumes = data?.novel.volumes ?? []
  if (volumes.length === 0) {
    return (
      <TreeNode
        icon={ListTree}
        label="暂无大纲，去生成"
        depth={2}
        dimmed
        onClick={() =>
          openTab({
            id: buildTabId("outline", novel.id),
            type: "outline",
            novelId: novel.id,
            title: "大纲",
          })
        }
      />
    )
  }

  const tabType = kind === "outline" ? "chapter-outline" : "chapter-content"
  const volumeIcon = kind === "outline" ? ListTree : FileText
  return (
    <>
      {volumes.map((volume) => {
        const volumeKey = `${novel.id}:${kind}:volume:${volume.id}`
        const volumeExpanded = expanded[volumeKey] ?? true
        return (
          <div key={volume.id}>
            <TreeNode
              icon={volumeIcon}
              label={manuscriptTitle(volume.index, volume.title, "卷")}
              depth={2}
              expandable
              expanded={volumeExpanded}
              onToggle={() => toggle(volumeKey)}
              onClick={() => toggle(volumeKey)}
              action={<OutlineTreeMenu novel={novel} volume={volume} kind={kind} />}
              hoverCard={() => {
                const words = volume.chapters.reduce((m, c) => m + c.wordCount, 0)
                return (
                  <SidebarHoverCard
                    data={{
                      title: manuscriptTitle(volume.index, volume.title, "卷"),
                      subtitle: kind === "outline" ? "卷大纲" : "卷正文",
                      icon: volumeIcon,
                      meta: [
                        `${volume.chapters.length} 章`,
                        ...(words > 0 ? [`共 ${words.toLocaleString()} 字`] : []),
                      ],
                    }}
                  />
                )
              }}
            />
            {volumeExpanded &&
              volume.chapters.map((chapter) => (
                <TreeNode
                  key={chapter.id}
                  icon={CHAPTER_STATUS_ICONS[chapter.status]}
                  label={manuscriptTitle(chapter.index, chapter.title)}
                  depth={3}
                  hoverCard={() => (
                    <SidebarHoverCard
                      data={{
                        title: manuscriptTitle(chapter.index, chapter.title),
                        subtitle: kind === "outline" ? "章大纲" : "章正文",
                        icon: CHAPTER_STATUS_ICONS[chapter.status],
                        meta: [
                          CHAPTER_STATUS_LABELS[chapter.status],
                          ...(chapter.wordCount > 0
                            ? [`${chapter.wordCount.toLocaleString()} 字`]
                            : []),
                        ],
                      }}
                    />
                  )}
                  active={
                    activeTabId === buildTabId(tabType, novel.id, { refId: chapter.id })
                  }
                  onClick={() =>
                    openTab({
                      id: buildTabId(tabType, novel.id, { refId: chapter.id }),
                      type: tabType,
                      novelId: novel.id,
                      refId: chapter.id,
                      title: chapter.title,
                    })
                  }
                />
              ))}
          </div>
        )
      })}
    </>
  )
}

/**
 * 「级联修订」节点：有待处理 CascadeJob（RUNNING / WAITING_CONFIRM）时显示红色角标计数。
 * 点击打开 cascade tab。独立组件以便每本小说各发一条 ["cascade", novelId] 查询。
 */
function CascadeNode({ novel }: { novel: NovelSummary }) {
  const openTab = useTabsStore((s) => s.openTab)
  const activeTabId = useTabsStore((s) => s.activeTabId)

  const { data } = useQuery({
    queryKey: ["cascade", novel.id],
    queryFn: async () => {
      const res = await fetch(`/api/novels/${novel.id}/cascade`)
      if (!res.ok) throw new Error("加载级联任务失败")
      return (await res.json()) as { pendingCount: number }
    },
  })

  const pendingCount = data?.pendingCount ?? 0
  const tabId = buildTabId("cascade", novel.id)
  return (
    <TreeNode
      icon={RefreshCw}
      label="级联修订"
      hoverCard={() => (
        <SidebarHoverCard
          data={{
            title: "级联修订",
            icon: RefreshCw,
            blurb: "上游设定/大纲变更向下游章节传播的修订任务。",
            meta: [pendingCount > 0 ? `${pendingCount} 项待处理` : "无待处理"],
          }}
        />
      )}
      depth={1}
      active={activeTabId === tabId}
      onClick={() =>
        openTab({ id: tabId, type: "cascade", novelId: novel.id, title: "级联修订" })
      }
      action={
        pendingCount > 0 ? (
          <span className="mr-1 flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-medium text-white">
            {pendingCount}
          </span>
        ) : undefined
      }
    />
  )
}

interface ConversationSummary {
  id: string
  title: string
  novelId: string | null
  updatedAt: string
}

async function fetchConversationSummaries(): Promise<ConversationSummary[]> {
  const res = await fetch("/api/chat/conversations")
  if (!res.ok) throw new Error("加载会话列表失败")
  const json = (await res.json()) as { conversations: ConversationSummary[] }
  return json.conversations
}

/**
 * 未绑定作品的脑洞会话（W8 延迟建档）：归入虚拟作品「小说创作指引」，
 * 作为作品阁顶部的可折叠分组展示，点击子会话回到共创；没有时不占位置。
 * 与小说内「对话」节点共享 ["chat-conversations"] 缓存。
 */
function UnboundConversations() {
  const conversationId = useChatStore((s) => s.conversationId)
  const [groupExpanded, setGroupExpanded] = useState(true)
  const { data } = useQuery({ queryKey: ["chat-conversations"], queryFn: fetchConversationSummaries })
  const unbound = (data ?? []).filter((c) => c.novelId === null)
  if (!unbound.length) return null
  return (
    <div>
      <TreeNode
        icon={Lightbulb}
        label={`小说创作指引（${unbound.length}）`}
        depth={0}
        expandable
        expanded={groupExpanded}
        onToggle={() => setGroupExpanded((v) => !v)}
        onClick={() => setGroupExpanded((v) => !v)}
        hoverCard={() => (
          <SidebarHoverCard
            data={{
              title: "小说创作指引",
              subtitle: "虚拟作品",
              icon: Lightbulb,
              blurb: "未建档的脑洞会话归档于此；在会话中确立作品后，会话自动移入对应作品之下。",
            }}
          />
        )}
      />
      {groupExpanded &&
        unbound.map((c) => (
          <TreeNode
            key={c.id}
            icon={MessageSquare}
            label={c.title || "未命名会话"}
            depth={1}
            hoverCard={() => (
              <SidebarHoverCard
                data={{
                  title: c.title || "未命名会话",
                  wrapTitle: true,
                  subtitle: "脑洞会话（未建档）",
                  icon: MessageSquare,
                  meta: [`更新于 ${c.updatedAt.slice(5, 10)}`],
                }}
              />
            )}
            active={c.id === conversationId}
            onClick={() => useChatStore.getState().requestConversation(c.id)}
          />
        ))}
    </div>
  )
}

/**
 * 「对话」节点：列出当前小说的历史 AI 会话（与 ChatPanel 共享 ["chat-conversations"] 缓存）。
 * 点击子节点通过 chat store 请求切换会话，ChatPanel 监听后加载。
 */
function ConversationsNode({
  novel,
  expanded,
  toggle,
}: {
  novel: NovelSummary
  expanded: Record<string, boolean>
  toggle: (key: string) => void
}) {
  const conversationId = useChatStore((s) => s.conversationId)
  const convKey = `${novel.id}:conversations`
  const convExpanded = expanded[convKey] ?? true

  const { data, isLoading } = useQuery({
    queryKey: ["chat-conversations"],
    queryFn: fetchConversationSummaries,
  })

  const conversations = (data ?? []).filter(
    (c) => c.novelId === novel.id
  )

  return (
    <>
      <TreeNode
        icon={MessageSquare}
        label="对话"
        depth={1}
        hoverCard={staticHoverCard("对话", MessageSquare, "与创作参谋的历史会话，点击切换接着聊。")}
        expandable
        expanded={convExpanded}
        onToggle={() => toggle(convKey)}
        onClick={() => toggle(convKey)}
      />
      {convExpanded &&
        (isLoading ? (
          <div className="flex justify-center py-1.5 text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
          </div>
        ) : conversations.length === 0 ? (
          <TreeNode icon={MessageSquare} label="暂无会话" depth={2} dimmed />
        ) : (
          conversations.map((c) => (
            <TreeNode
              key={c.id}
              icon={MessageSquare}
              label={c.title || "未命名会话"}
              depth={2}
              hoverCard={() => (
                <SidebarHoverCard
                  data={{
                    title: c.title || "未命名会话",
                    wrapTitle: true,
                    subtitle: "AI 会话",
                    icon: MessageSquare,
                    meta: [`更新于 ${c.updatedAt.slice(5, 10)}`],
                  }}
                />
              )}
              active={c.id === conversationId}
              onClick={() => useChatStore.getState().requestConversation(c.id)}
            />
          ))
        ))}
    </>
  )
}

interface SidebarTreeProps {
  user: { id: string; name: string; email: string; avatarUrl?: string }
  /** 隐藏左侧导航栏（顶栏右侧的折叠按钮） */
  onToggleSidebar?: () => void
}

export function SidebarTree({ user, onToggleSidebar }: SidebarTreeProps) {
  const queryClient = useQueryClient()
  const openTab = useTabsStore((s) => s.openTab)
  const activeTabId = useTabsStore((s) => s.activeTabId)
  const closeAllTabsOfNovel = useTabsStore((s) => s.closeAllTabsOfNovel)
  const closeWorldTab = useTabsStore((s) => s.closeWorldTab)
  const renameNovelTab = useTabsStore((s) => s.renameNovelTab)
  const renameWorldTab = useTabsStore((s) => s.renameWorldTab)
  const closeTab = useTabsStore((s) => s.closeTab)
  const renameScenarioTab = useTabsStore((s) => s.renameScenarioTab)
  const conversationId = useChatStore((s) => s.conversationId)
  /** 当前处于未落库的新对话（点「创建对话」后 / 首条消息发出前）时按钮呈选中态 */
  const isNewConversation = conversationId === null

  const { theme } = useTheme()
  // SSR false、客户端 true，避免 hydration 不一致（与 ThemeSwitcher 同款守卫）
  const themeMounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  )

  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [dialog, setDialog] = useState<DialogState>(null)
  const [titleInput, setTitleInput] = useState("")
  /** 创建作品两步向导（书名 + 创作切入方式） */
  const [createOpen, setCreateOpen] = useState(false)
  useDesktopCommands({"file.new":()=>setCreateOpen(true)})

  const { data: novelList, isPending, isError, isFetching, refetch } = useNovelList()
  const novels = novelList?.novels
  const unavailableWorks = novelList?.unavailableWorks ?? []

  const invalidateNovels = () =>
    queryClient.invalidateQueries({ queryKey: ["novels"] })

  const renameMutation = useMutation({
    mutationFn: async ({ id, title }: { id: string; title: string }) => {
      const res = await fetch(`/api/novels/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      })
      if (!res.ok) throw new Error(await readError(res, "重命名失败"))
      return (await res.json()) as { novel: NovelSummary }
    },
    onSuccess: ({ novel }) => {
      toast.success("已重命名")
      renameNovelTab(novel.id, novel.title)
      invalidateNovels()
      setDialog(null)
    },
    onError: (err) => toast.error(err.message),
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/novels/${id}`, { method: "DELETE" })
      if (!res.ok) throw new Error(await readError(res, "删除失败"))
    },
    onSuccess: (_data, id) => {
      toast.success("小说已删除")
      closeAllTabsOfNovel(id)
      invalidateNovels()
      setDialog(null)
    },
    onError: (err) => toast.error(err.message),
  })

  const invalidateWorlds = (novelId: string) =>
    queryClient.invalidateQueries({ queryKey: ["worlds", novelId] })

  const createWorldMutation = useMutation({
    mutationFn: async ({
      novel,
      parentWorld,
      name,
    }: {
      novel: NovelSummary
      parentWorld?: WorldRecord
      name: string
    }) => {
      const res = await fetch(`/api/novels/${novel.id}/worlds`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, parentId: parentWorld?.id ?? null }),
      })
      if (!res.ok) throw new Error(await readError(res, "创建失败"))
      return (await res.json()) as { world: WorldRecord }
    },
    onSuccess: ({ world }, { novel, parentWorld }) => {
      toast.success(`世界「${world.name}」已创建`)
      invalidateWorlds(novel.id)
      setDialog(null)
      openTab({
        id: buildTabId("world", novel.id, { refId: world.id }),
        type: "world",
        novelId: novel.id,
        refId: world.id,
        title: world.name,
      })
      // 展开世界观分组与父世界节点，让新世界立即可见
      setExpanded((prev) => ({
        ...prev,
        [`${novel.id}:worlds`]: true,
        ...(parentWorld ? { [`world:${parentWorld.id}`]: true } : {}),
      }))
    },
    onError: (err) => toast.error(err.message),
  })

  const renameWorldMutation = useMutation({
    mutationFn: async ({
      novel,
      world,
      name,
    }: {
      novel: NovelSummary
      world: WorldRecord
      name: string
    }) => {
      const res = await fetch(`/api/novels/${novel.id}/worlds/${world.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      })
      if (!res.ok) throw new Error(await readError(res, "重命名失败"))
      return (await res.json()) as { world: WorldRecord }
    },
    onSuccess: ({ world }, { novel }) => {
      toast.success("已重命名")
      renameWorldTab(world.id, world.name)
      invalidateWorlds(novel.id)
      setDialog(null)
    },
    onError: (err) => toast.error(err.message),
  })

  const deleteWorldMutation = useMutation({
    mutationFn: async ({ novel, world }: { novel: NovelSummary; world: WorldRecord }) => {
      const res = await fetch(`/api/novels/${novel.id}/worlds/${world.id}`, {
        method: "DELETE",
      })
      if (!res.ok) throw new Error(await readError(res, "删除失败"))
    },
    onSuccess: (_data, { novel, world }) => {
      toast.success(`世界「${world.name}」已删除`)
      // 关闭被删世界及其所有子孙世界的 tab（此时缓存仍是删除前的世界列表）
      const cached =
        queryClient.getQueryData<{ worlds: WorldRecord[] }>(["worlds", novel.id])?.worlds ??
        []
      const doomed = new Set([world.id])
      let grew = true
      while (grew) {
        grew = false
        for (const w of cached) {
          if (w.parentId && doomed.has(w.parentId) && !doomed.has(w.id)) {
            doomed.add(w.id)
            grew = true
          }
        }
      }
      doomed.forEach((id) => closeWorldTab(id))
      invalidateWorlds(novel.id)
      setDialog(null)
    },
    onError: (err) => toast.error(err.message),
  })

  const invalidateScenarios = (novelId: string) =>
    queryClient.invalidateQueries({ queryKey: ["scenarios", novelId] })

  const createScenarioMutation = useMutation({
    mutationFn: async ({
      novel,
      title,
      cast,
    }: {
      novel: NovelSummary
      title: string
      cast: ScenarioCreatePayload["cast"]
    }) => {
      const res = await fetch(`/api/novels/${novel.id}/scenarios`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, ...(cast.length > 0 ? { cast } : {}) }),
      })
      if (!res.ok) throw new Error(await readError(res, "创建失败"))
      return (await res.json()) as { scenario: ScenarioSummary }
    },
    onSuccess: ({ scenario }, { novel }) => {
      toast.success(`情景试验场「${scenario.title}」已创建`)
      invalidateScenarios(novel.id)
      setDialog(null)
      openTab({
        id: buildTabId("scenario", novel.id, { refId: scenario.id }),
        type: "scenario",
        novelId: novel.id,
        refId: scenario.id,
        title: scenario.title,
      })
      // 展开试验场分组，让新试验场立即可见
      setExpanded((prev) => ({ ...prev, [`${novel.id}:scenario`]: true }))
    },
    onError: (err) => toast.error(err.message),
  })

  const renameScenarioMutation = useMutation({
    mutationFn: async ({
      scenario,
      title,
    }: {
      novel: NovelSummary
      scenario: ScenarioSummary
      title: string
    }) => {
      const res = await fetch(`/api/novels/${scenario.novelId}/scenarios/${scenario.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      })
      if (!res.ok) throw new Error(await readError(res, "重命名失败"))
      return (await res.json()) as { scenario: ScenarioSummary }
    },
    onSuccess: ({ scenario }) => {
      toast.success("已重命名")
      renameScenarioTab(scenario.id, scenario.title)
      invalidateScenarios(scenario.novelId)
      setDialog(null)
    },
    onError: (err) => toast.error(err.message),
  })

  const deleteScenarioMutation = useMutation({
    mutationFn: async ({ scenario }: { novel: NovelSummary; scenario: ScenarioSummary }) => {
      const res = await fetch(`/api/novels/${scenario.novelId}/scenarios/${scenario.id}`, {
        method: "DELETE",
      })
      if (!res.ok) throw new Error(await readError(res, "删除失败"))
    },
    onSuccess: (_data, { novel, scenario }) => {
      toast.success(`情景试验场「${scenario.title}」已删除`)
      // 被删试验场的 tab（若开着）一并关闭；未开时 closeTab 为空操作
      closeTab(buildTabId("scenario", novel.id, { refId: scenario.id }))
      invalidateScenarios(novel.id)
      setDialog(null)
    },
    onError: (err) => toast.error(err.message),
  })

  const toggle = (key: string) =>
    setExpanded((prev) => ({ ...prev, [key]: !(prev[key] ?? true) }))

  const openNovelTab = (novel: NovelSummary) =>
    openTab({
      id: buildTabId("novel", novel.id),
      type: "novel",
      novelId: novel.id,
      title: novel.title,
    })

  const openSimpleTab = (type: TabType, novel: NovelSummary, title: string) =>
    openTab({ id: buildTabId(type, novel.id), type, novelId: novel.id, title })

  const openSettingTab = (novel: NovelSummary, settingType: SettingType) =>
    openTab({
      id: buildTabId("setting", novel.id, { settingType }),
      type: "setting",
      novelId: novel.id,
      settingType,
      title: SETTING_TYPE_LABELS[settingType],
    })

  const openTitleDialog = (
    state: DialogState & { type: "rename" | "world-create" | "world-rename" }
  ) => {
    setTitleInput(
      state.type === "rename"
        ? state.novel.title
        : state.type === "world-rename"
          ? state.world.name ?? ""
          : ""
    )
    setDialog(state)
  }

  const submitTitleDialog = () => {
    const title = titleInput.trim()
    if (!title) return
    if (dialog?.type === "rename") renameMutation.mutate({ id: dialog.novel.id, title })
    if (dialog?.type === "world-create") {
      createWorldMutation.mutate({ novel: dialog.novel, parentWorld: dialog.parentWorld, name: title })
    }
    if (dialog?.type === "world-rename") {
      renameWorldMutation.mutate({ novel: dialog.novel, world: dialog.world, name: title })
    }
  }

  const submitting =
    renameMutation.isPending ||
    createWorldMutation.isPending ||
    renameWorldMutation.isPending

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <SidebarWindowControls onToggleSidebar={onToggleSidebar} />
      <div className="flex shrink-0 items-start gap-1 px-1.5 pt-1.5">
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="flex h-7 w-full items-center gap-[7px] rounded-[5px] px-1.5 text-[13px] transition-colors hover:bg-hover-wash"
          >
            <Plus className="size-3.5 text-muted-foreground" />
            创建作品
          </button>
          <button
            type="button"
            onClick={() => useChatStore.getState().requestNewConversation()}
            className={cn(
              "relative flex h-7 w-full items-center gap-[7px] rounded-[5px] px-1.5 text-[13px] transition-colors",
              isNewConversation
                ? "bg-active-wash font-medium text-primary"
                : "hover:bg-hover-wash"
            )}
          >
            <MessageSquarePlus
              className={cn(
                "size-3.5",
                isNewConversation ? "text-primary" : "text-muted-foreground"
              )}
            />
            创建对话
          </button>
        </div>
      </div>
      <div className="shrink-0 px-3 pt-2.5 pb-1.5">
        <span className="font-serif text-[13px] font-semibold tracking-[0.1em]">
          作品阁
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pt-0.5 pb-3">
        <SidebarHoverProvider>
        <UnboundConversations />
        {!isError && <UnavailableWorks works={unavailableWorks} retrying={isFetching} retry={() => void refetch()}/>}
        {isError && (
          <div role="alert" className="flex flex-col items-center gap-2 px-4 py-6 text-center">
            <AlertCircle className="size-6 text-destructive" />
            <p className="text-sm font-medium">作品加载失败</p>
            <p className="text-xs text-muted-foreground">
              暂时无法获取作品列表，请稍后重试。
            </p>
            <Button
              variant="outline"
              size="sm"
              disabled={isFetching}
              onClick={() => void refetch()}
            >
              <RefreshCw className={cn("size-3.5", isFetching && "animate-spin")} />
              {isFetching ? "正在重新加载…" : "重新加载作品"}
            </Button>
          </div>
        )}
        {isPending ? (
          <div className="flex justify-center py-8 text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : !isError && novels?.length === 0 && unavailableWorks.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <BookOpen className="size-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              还没有小说
              <br />
              点击上方「创建作品」开始你的第一部作品吧
            </p>
          </div>
        ) : (
          novels?.map((novel) => {
            const novelExpanded = expanded[novel.id] ?? true
            const novelTabId = buildTabId("novel", novel.id)
            const settingKey = `${novel.id}:setting`
            const characterKey = `${novel.id}:character`
            const scenarioKey = `${novel.id}:scenario`
            const sceneKey = `${novel.id}:scene`
            const contentKey = `${novel.id}:content`
            return (
              <div key={novel.id}>
                <TreeNode
                  icon={BookOpen}
                  avatar={
                    novel.coverUrl ? (
                      <span className="relative aspect-[2/3] h-5 shrink-0 overflow-hidden rounded-[3px]">
                        {/* eslint-disable-next-line @next/next/no-img-element -- 本地封面缩略图 */}
                        <img
                          src={novel.coverUrl}
                          alt={novel.title}
                          className="h-full w-full object-cover"
                        />
                      </span>
                    ) : undefined
                  }
                  label={novel.title}
                  tag={isTentativeNovelTitle(novel.title) ? <TentativeBadge /> : undefined}
                  hoverCard={() => <NovelHoverCard novel={novel} />}
                  depth={0}
                  expandable
                  expanded={novelExpanded}
                  active={activeTabId === novelTabId}
                  onToggle={() => toggle(novel.id)}
                  onClick={() => {
                    openNovelTab(novel)
                    if (!novelExpanded) toggle(novel.id)
                  }}
                  action={
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <button
                            type="button"
                            aria-label="小说操作"
                            onClick={(e) => e.stopPropagation()}
                            className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-muted-foreground/15 data-popup-open:opacity-100"
                          />
                        }
                      >
                        <MoreHorizontal className="size-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-auto min-w-28">
                        <DropdownMenuItem
                          onClick={() => openTitleDialog({ type: "rename", novel })}
                        >
                          <Pencil />
                          重命名
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => setDialog({ type: "delete", novel })}
                        >
                          <Trash2 />
                          删除
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  }
                />

                {novelExpanded && (
                  <>
                    <TreeNode
                      icon={Settings2}
                      label="设定"
                      depth={1}
                      hoverCard={staticHoverCard("设定", Settings2, "主题、世界观与金手指/文风等作品级设定的档案区。")}
                      expandable
                      expanded={expanded[settingKey] ?? true}
                      onToggle={() => toggle(settingKey)}
                      onClick={() => toggle(settingKey)}
                    />
                    {(expanded[settingKey] ?? true) && (
                      <>
                        <TreeNode
                          icon={Lightbulb}
                          label="主题"
                          depth={2}
                          hoverCard={() => <ThemeHoverCard novel={novel} />}
                          active={activeTabId === buildTabId("theme", novel.id)}
                          onClick={() => openSimpleTab("theme", novel, "主题")}
                        />
                        {/* 文风是整书唯一的写作基调，紧跟主题展示；侧栏简称「文风」 */}
                        <TreeNode
                          icon={getTabIcon({ type: "setting", settingType: "STYLE" })}
                          label="文风"
                          depth={2}
                          hoverCard={() => (
                            <SettingTypeHoverCard novel={novel} settingType="STYLE" />
                          )}
                          active={
                            activeTabId === buildTabId("setting", novel.id, { settingType: "STYLE" })
                          }
                          onClick={() => openSettingTab(novel, "STYLE")}
                        />
                        <TreeNode
                          icon={Globe}
                          label="世界观"
                          depth={2}
                          hoverCard={staticHoverCard("世界观", Globe, "世界与子世界的树状容器，设定条目挂在具体世界之下。")}
                          expandable
                          expanded={expanded[`${novel.id}:worlds`] ?? true}
                          onToggle={() => toggle(`${novel.id}:worlds`)}
                          onClick={() => toggle(`${novel.id}:worlds`)}
                          action={
                            <button
                              type="button"
                              aria-label="创建世界"
                              title="创建世界"
                              onClick={(e) => {
                                e.stopPropagation()
                                openTitleDialog({ type: "world-create", novel })
                              }}
                              className="mr-1 flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-muted-foreground/15"
                            >
                              <Plus className="size-3.5" />
                            </button>
                          }
                        />
                        {(expanded[`${novel.id}:worlds`] ?? true) && (
                          <WorldSubtree
                            novel={novel}
                            expanded={expanded}
                            toggle={toggle}
                            onCreateChild={(parent) =>
                              openTitleDialog({ type: "world-create", novel, parentWorld: parent })
                            }
                            onRename={(world) =>
                              openTitleDialog({ type: "world-rename", novel, world })
                            }
                            onDelete={(world) => setDialog({ type: "world-delete", novel, world })}
                          />
                        )}
                        {NOVEL_SETTING_TYPE_ORDER.filter((t) => t !== "STYLE").map((settingType) => (
                          <TreeNode
                            key={settingType}
                            icon={getTabIcon({ type: "setting", settingType })}
                            label={SETTING_TYPE_LABELS[settingType]}
                            depth={2}
                            hoverCard={() => (
                              <SettingTypeHoverCard novel={novel} settingType={settingType} />
                            )}
                            active={
                              activeTabId ===
                              buildTabId("setting", novel.id, { settingType })
                            }
                            onClick={() => openSettingTab(novel, settingType)}
                          />
                        ))}
                        {/* 伏笔：情节线索档案（金手指下方，埋入/提及/回收追踪） */}
                        <TreeNode
                          icon={Flag}
                          label="伏笔"
                          depth={2}
                          hoverCard={staticHoverCard("伏笔", Flag, "情节线索档案：追踪每条伏笔的埋入、提及与回收位置，生成与评审时自动带入上下文。")}
                          active={activeTabId === buildTabId("foreshadow", novel.id)}
                          onClick={() => openSimpleTab("foreshadow", novel, "伏笔")}
                        />
                        <TreeNode
                          icon={Heart}
                          label="爽点/泪点"
                          depth={2}
                          hoverCard={staticHoverCard("爽点/泪点", Heart, "选中的爽点与泪点条目，生成大纲与正文时的情绪坐标。")}
                          active={activeTabId === buildTabId("trope", novel.id)}
                          onClick={() => openSimpleTab("trope", novel, "爽点/泪点")}
                        />
                        <TreeNode
                          icon={SlidersHorizontal}
                          label="属性"
                          depth={2}
                          hoverCard={staticHoverCard("属性", SlidersHorizontal, "角色/物品/场景的自定义属性定义，各面板按定义填值。")}
                          active={activeTabId === buildTabId("attributes", novel.id)}
                          onClick={() => openSimpleTab("attributes", novel, "属性")}
                        />
                      </>
                    )}
                    <TreeNode
                      icon={Users}
                      label="角色"
                      depth={1}
                      hoverCard={() => <CharactersHeaderHoverCard novel={novel} />}
                      expandable
                      expanded={expanded[characterKey] ?? true}
                      active={activeTabId === buildTabId("characters", novel.id)}
                      onToggle={() => toggle(characterKey)}
                      onClick={() => {
                        openSimpleTab("characters", novel, "角色")
                        if (!(expanded[characterKey] ?? true)) toggle(characterKey)
                      }}
                    />
                    {(expanded[characterKey] ?? true) && (
                      <CharacterSubtree novel={novel} expanded={expanded} toggle={toggle} />
                    )}
                    {/* 物品：纯入口（不再平铺物品子节点），点击打开管理面板；详情 tab 从面板卡片/芯片/悬停卡进入 */}
                    <TreeNode
                      icon={Package}
                      label="物品"
                      depth={1}
                      hoverCard={staticHoverCard("物品", Package, "道具、法宝、信物等物件档案，可在正文中按名引用。")}
                      active={activeTabId === buildTabId("items", novel.id)}
                      onClick={() => openSimpleTab("items", novel, "物品")}
                    />
                    <TreeNode
                      icon={FlaskConical}
                      label="情景试验场"
                      depth={1}
                      hoverCard={staticHoverCard("情景试验场", FlaskConical, "多代理跑一段假设剧情，验证设定与角色反应的试验台。")}
                      expandable
                      expanded={expanded[scenarioKey] ?? true}
                      onToggle={() => toggle(scenarioKey)}
                      onClick={() => toggle(scenarioKey)}
                      action={
                        <button
                          type="button"
                          aria-label="新建情景试验场"
                          title="新建情景试验场"
                          onClick={(e) => {
                            e.stopPropagation()
                            setDialog({ type: "scenario-create", novel })
                          }}
                          className="mr-1 flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-muted-foreground/15"
                        >
                          <Plus className="size-3.5" />
                        </button>
                      }
                    />
                    {(expanded[scenarioKey] ?? true) && (
                      <ScenarioSubtree
                        novel={novel}
                        onRename={(scenario) => {
                          setTitleInput(scenario.title)
                          setDialog({ type: "scenario-rename", novel, scenario })
                        }}
                        onDelete={(scenario) =>
                          setDialog({ type: "scenario-delete", novel, scenario })
                        }
                      />
                    )}
                    <TreeNode
                      icon={MapPin}
                      label="场景"
                      depth={1}
                      hoverCard={staticHoverCard("场景", MapPin, "反复出现的地点场景档案，供正文与对话引用。")}
                      expandable
                      expanded={expanded[sceneKey] ?? true}
                      active={activeTabId === buildTabId("scenes", novel.id)}
                      onToggle={() => toggle(sceneKey)}
                      onClick={() => {
                        openAllScenes(novel.id)
                        if (!(expanded[sceneKey] ?? true)) toggle(sceneKey)
                      }}
                    />
                    {(expanded[sceneKey] ?? true) && (
                      <GlobalSceneTree novelId={novel.id}/>
                    )}
                    <TreeNode icon={ChartNoAxesGantt} label="世界线" depth={1} active={activeTabId === buildTabId("worldline", novel.id)} onClick={() => openSimpleTab("worldline", novel, "世界线")} />
                    <TreeNode icon={ListTree} label="叙事线" depth={1} active={activeTabId === buildTabId("narrative", novel.id)} onClick={() => openSimpleTab("narrative", novel, "叙事线")} />
                    <TreeNode
                      icon={ListTree}
                      label="大纲"
                      depth={1}
                      hoverCard={staticHoverCard("大纲", ListTree, "叙事线分卷定章后的只读投影，前往叙事线修改。")}
                      active={activeTabId === buildTabId("outline", novel.id)}
                      onClick={() => openSimpleTab("outline", novel, "大纲")}
                    />
                    <TreeNode
                      icon={FileText}
                      label="正文"
                      depth={1}
                      hoverCard={staticHoverCard("正文", FileText, "章节正文写作区，含字数与写作/定稿状态。")}
                      expandable
                      expanded={expanded[contentKey] ?? true}
                      action={<OutlineTreeMenu novel={novel} kind="content" />}
                      onToggle={() => toggle(contentKey)}
                      onClick={() => toggle(contentKey)}
                    />
                    {(expanded[contentKey] ?? true) && (
                      <OutlineSubtree
                        novel={novel}
                        kind="content"
                        expanded={expanded}
                        toggle={toggle}
                      />
                    )}
                    <TreeNode
                      icon={Workflow}
                      label="创作进度"
                      depth={1}
                      hoverCard={staticHoverCard("创作进度", Workflow, "六环节进度、待审核产物与设定评审入口。")}
                      active={activeTabId === buildTabId("story-workflow", novel.id)}
                      onClick={() => openSimpleTab("story-workflow", novel, "创作进度")}
                    />
                    <TreeNode
                      icon={ClipboardCheck}
                      label="创作评审"
                      depth={1}
                      hoverCard={staticHoverCard("创作评审", ClipboardCheck, "全部创作检查点的评分与评审意见总览。")}
                      active={activeTabId === buildTabId("story-review", novel.id)}
                      onClick={() => openSimpleTab("story-review", novel, "创作评审")}
                    />
                    <CascadeNode novel={novel} />
                    <ConversationsNode novel={novel} expanded={expanded} toggle={toggle} />
                  </>
                )}
              </div>
            )
          })
        )}
        </SidebarHoverProvider>
      </div>

      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-sidebar-border px-2.5 py-2">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                aria-label="账号菜单"
                className="flex min-w-0 flex-1 items-center gap-2 rounded-[7px] px-1.5 py-1 text-left transition-colors hover:bg-hover-wash"
              />
            }
          >
            <span className="relative flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-active-wash text-[11px] font-semibold text-primary">
              {user.name.slice(0, 1).toUpperCase()}
              {user.avatarUrl && <img key={user.avatarUrl} src={user.avatarUrl} alt="" className="absolute inset-0 size-full object-cover" onError={event => { event.currentTarget.hidden = true }} />}
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-[12.5px] leading-[1.3] font-medium">
                {user.name}
              </span>
              <span className="truncate font-mono text-[10.5px] leading-[1.3] text-muted-foreground">
                {user.email}
              </span>
            </span>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start">
            {/* 用户信息（Label 不可点击）：头像 + 用户名（大字）+ 邮箱（小字 muted） */}
            <DropdownMenuGroup>
              <DropdownMenuLabel className="flex items-center gap-2.5 px-2 py-2">
                <span className="relative flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-active-wash text-[13px] font-semibold text-primary">
                  {user.name.slice(0, 1).toUpperCase()}
                  {user.avatarUrl && <img key={user.avatarUrl} src={user.avatarUrl} alt="" className="absolute inset-0 size-full object-cover" onError={event => { event.currentTarget.hidden = true }} />}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-[15px] leading-[1.35] font-semibold text-foreground">
                    {user.name}
                  </span>
                  <span className="truncate font-mono text-[11px] leading-[1.4] text-muted-foreground">
                    {user.email}
                  </span>
                </span>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            {/* 外观主题选择（宣纸 ⇄ 玄墨，switch 控件）：替代原顶栏主题按钮的入口 */}
            <div className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-sm select-none">
              <Palette className="size-4 text-muted-foreground" />
              <span>外观</span>
              <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
                宣纸
                <Switch
                  size="sm"
                  aria-label="外观主题（宣纸 / 玄墨）"
                  checked={themeMounted ? theme === "ink" : false}
                  onCheckedChange={(checked) => { void updateDesktopSettings(settings => ({ ...settings, appearance: { ...settings.appearance, theme: checked ? "ink" : "paper" } })).catch(error => toast.error(error.message)) }}
                />
                玄墨
              </span>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => { void window.desktop?.command("app.settings") }}>
              <Settings />
              设置
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

      </div>

      <Dialog
        open={
          dialog?.type === "rename" ||
          dialog?.type === "world-create" ||
          dialog?.type === "world-rename"
        }
        onOpenChange={(open) => {
          if (!open) setDialog(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialog?.type === "rename"
                ? "重命名小说"
                : dialog?.type === "world-rename"
                  ? "重命名世界"
                  : dialog?.type === "world-create" && dialog.parentWorld
                    ? `新建子世界 · ${dialog.parentWorld.name}`
                    : "新建世界"}
            </DialogTitle>
            <DialogDescription>
              {dialog?.type === "rename"
                ? "为你的小说起一个新名字。"
                : "为世界起一个名字；创建后先只有世界观介绍，可按需添加等级、力量体系、地图等设定。"}
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              submitTitleDialog()
            }}
            className="flex flex-col gap-4"
          >
            <Input
              autoFocus
              value={titleInput}
              onChange={(e) => setTitleInput(e.target.value)}
              placeholder={
                dialog?.type === "world-create" || dialog?.type === "world-rename"
                  ? "如：修真世界、现实世界、大千世界"
                  : "请输入书名"
              }
              maxLength={100}
            />
            <DialogFooter>
              <Button type="submit" disabled={!titleInput.trim() || submitting}>
                {submitting && <Loader2 className="animate-spin" />}
                {dialog?.type === "rename" || dialog?.type === "world-rename"
                  ? "保存"
                  : "创建"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={dialog?.type === "delete" || dialog?.type === "world-delete"}
        onOpenChange={(open) => {
          if (!open) setDialog(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialog?.type === "world-delete" ? "删除世界" : "删除小说"}
            </DialogTitle>
            <DialogDescription>
              {dialog?.type === "world-delete"
                ? `确定要删除世界「${dialog.world.name}」吗？其下的子世界与全部设定将一并删除，该操作不可撤销。`
                : `确定要删除《${dialog?.type === "delete" ? dialog.novel.title : ""}》吗？删除后将不再显示在列表中。`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending || deleteWorldMutation.isPending}
              onClick={() => {
                if (dialog?.type === "delete") deleteMutation.mutate(dialog.novel.id)
                if (dialog?.type === "world-delete") {
                  deleteWorldMutation.mutate({ novel: dialog.novel, world: dialog.world })
                }
              }}
            >
              {(deleteMutation.isPending || deleteWorldMutation.isPending) && (
                <Loader2 className="animate-spin" />
              )}
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <CreateNovelDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        novels={novels ?? []}
      />

      {/* 新建情景试验场：标题 + 参演角色多选（AI 演/我来演）；场景与开场剧情在面板内配置 */}
      {dialog?.type === "scenario-create" && (
        <ScenarioCreateDialog
          novel={dialog.novel}
          open
          pending={createScenarioMutation.isPending}
          onOpenChange={(open) => {
            if (!open) setDialog(null)
          }}
          onSubmit={(payload) => {
            if (dialog?.type !== "scenario-create") return
            createScenarioMutation.mutate({
              novel: dialog.novel,
              title: payload.title,
              cast: payload.cast,
            })
          }}
        />
      )}

      {/* 重命名情景试验场 */}
      <Dialog
        open={dialog?.type === "scenario-rename"}
        onOpenChange={(open) => {
          if (!open) setDialog(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重命名情景试验场</DialogTitle>
            <DialogDescription>为这个试验场起一个新名字。</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              const title = titleInput.trim()
              if (dialog?.type === "scenario-rename" && title) {
                renameScenarioMutation.mutate({
                  novel: dialog.novel,
                  scenario: dialog.scenario,
                  title,
                })
              }
            }}
            className="flex flex-col gap-4"
          >
            <Input
              autoFocus
              value={titleInput}
              onChange={(e) => setTitleInput(e.target.value)}
              placeholder="如：雨夜客栈的相遇"
              maxLength={100}
            />
            <DialogFooter>
              <Button
                type="submit"
                disabled={!titleInput.trim() || renameScenarioMutation.isPending}
              >
                {renameScenarioMutation.isPending && <Loader2 className="animate-spin" />}
                保存
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 删除情景试验场确认 */}
      <Dialog
        open={dialog?.type === "scenario-delete"}
        onOpenChange={(open) => {
          if (!open) setDialog(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除情景试验场</DialogTitle>
            <DialogDescription>
              {dialog?.type === "scenario-delete"
                ? `确定要删除试验场「${dialog.scenario.title}」吗？推演记录、情节点、分镜卡与样文将一并删除，该操作不可撤销。`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={deleteScenarioMutation.isPending}
              onClick={() => {
                if (dialog?.type === "scenario-delete") {
                  deleteScenarioMutation.mutate({ novel: dialog.novel, scenario: dialog.scenario })
                }
              }}
            >
              {deleteScenarioMutation.isPending && <Loader2 className="animate-spin" />}
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
