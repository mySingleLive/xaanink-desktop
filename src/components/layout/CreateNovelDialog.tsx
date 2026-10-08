"use client"

/**
 * 创作向导（单页，替换旧两步向导）：定位条件（频道/篇幅/题材/四组标签）+ 四环节模板选卡
 * + 双击详情 + 确定拼贴。交互与视觉依据 docs/creation-wizard/02-ui-design.md 与
 * design/creation-wizard-preview.html；过滤/排序/联动/拼贴全部走 src/lib/creation-wizard 纯函数。
 *
 * 入口不创建小说——拼贴草稿与兜底书名经 requestNewConversation 挂起进会话，
 * 首条消息发送时才真正落库（ChatPanel 消费 pendingNovelTitle）；不自动发送。
 *
 * 样式令牌注意：--chat-line/--chat-surface 仅声明在 .chatpane 作用域（globals.css §3.12），
 * 本对话框是 portal 浮层，DialogContent 自带 chatpane 类补作用域，否则令牌解析失败回退 currentColor。
 */
import { useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from "react"
import {
  Check,
  Globe,
  Lightbulb,
  ListTree,
  Plus,
  Users,
  X,
  type LucideIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { POSITION_TAG_LIMIT, positionFromFilters } from "@/lib/creation-wizard/position"
import { composeWizardDraft } from "@/lib/creation-wizard/compose"
import { fallbackTitle } from "@/lib/creation-wizard/fallback-title"
import {
  DEFAULT_FILTERS,
  WIZARD_CATEGORIES,
  genresForChannel,
  isTemplateVisible,
  onChannelChange,
  onGenreChange,
  pruneInvisiblePicks,
  stylesForChannel,
  visibleTemplates,
  type WizardFilters,
  type WizardPicks,
} from "@/lib/creation-wizard/filter"
import { WIZARD_ICON_MANIFEST } from "@/lib/creation-wizard/icon-manifest"
import {
  WIZARD_BACKGROUNDS,
  WIZARD_CHANNELS,
  WIZARD_FLOWS,
  WIZARD_LENGTHS,
  WIZARD_SUBGENRES,
  type WizardCategory,
  type WizardTagGroup,
  type WizardTemplate,
} from "@/lib/creation-wizard/taxonomy"
import { useWizardTemplates } from "@/lib/desktop/use-wizard-templates"
import { cn } from "@/lib/utils"
import { useChatStore } from "@/stores/chat"

const CATEGORY_META: Record<WizardCategory, { name: string; icon: LucideIcon }> = {
  theme: { name: "主题", icon: Lightbulb },
  world: { name: "世界观", icon: Globe },
  character: { name: "角色", icon: Users },
  plot: { name: "剧情", icon: ListTree },
}


const BLANK_PICKS: WizardPicks = { theme: "blank", world: "blank", character: "blank", plot: "blank" }

/** DEFAULT_FILTERS 的 tags 是模块级 Set，状态必须持有独立副本（所有变更走新建 Set，不原地改） */
function freshFilters(): WizardFilters {
  return { ...DEFAULT_FILTERS, tags: { sub: new Set(), bg: new Set(), style: new Set(), flow: new Set() } }
}

/** 详情层元数据 chip（与预览稿同序：频道/题材/篇幅/主角类型/标签；空数组项省略） */
function detailMeta(t: WizardTemplate): string[] {
  const meta: string[] = []
  if (t.channels.length) meta.push(`频道：${t.channels.join(" / ")}`)
  if (t.genres.length) meta.push(`题材：${t.genres.join(" / ")}`)
  if (t.lengths?.length) meta.push(`篇幅：${t.lengths.join(" / ")}`)
  if (t.archetype) meta.push(`主角类型：${t.archetype}`)
  if (t.tags.length) meta.push(`标签：${t.tags.join(" / ")}`)
  return meta
}

const BLANK_DETAIL_TEXT = "空白模板：此环节不预填内容，确定后由你在输入框自由书写，或由参谋通过提问帮你理清。"

function Chip({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "shrink-0 rounded-full border border-(--chat-line) px-3 py-[3px] text-[12.5px] leading-[1.6] text-muted-foreground transition-colors hover:bg-hover-wash hover:text-foreground",
        selected && "border-primary bg-selected-surface font-medium text-primary hover:bg-selected-surface hover:text-primary"
      )}
    >
      {label}
    </button>
  )
}

function FilterRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="w-[34px] shrink-0 pt-[5px] text-xs font-medium text-muted-foreground">{label}</span>
      <div className="flex min-w-0 flex-wrap gap-1.5">{children}</div>
    </div>
  )
}

function TemplateCard({
  template,
  cat,
  selected,
  onClick,
  onDoubleClick,
}: {
  /** null = 空白模板 */
  template: WizardTemplate | null
  cat: WizardCategory
  selected: boolean
  onClick: () => void
  onDoubleClick: () => void
}) {
  const isBlank = template === null
  const FallbackIcon = isBlank ? Plus : CATEGORY_META[cat].icon
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      className={cn(
        "relative flex min-h-[76px] items-start gap-2.5 rounded-card border border-(--chat-line) bg-chat-surface p-3 text-left shadow-1 transition-colors hover:border-primary/40 hover:bg-hover-wash",
        isBlank && "border-dashed bg-transparent shadow-none",
        selected && "border-primary ring-1 ring-primary"
      )}
    >
      {selected && (
        <span className="absolute top-2 right-2 grid size-[17px] place-items-center rounded-full bg-primary text-primary-foreground">
          <Check className="size-[11px]" strokeWidth={3} />
        </span>
      )}
      <span
        className={cn(
          "grid size-10 shrink-0 place-items-center overflow-hidden rounded-lg bg-selected-surface text-primary",
          isBlank && "border border-dashed border-(--chat-line-strong) bg-transparent text-muted-foreground"
        )}
      >
        {!isBlank && WIZARD_ICON_MANIFEST.has(template.id) ? (
          // eslint-disable-next-line @next/next/no-img-element -- 出图脚本生成的本地静态 webp，固定 40px 缩略图
          <img src={`/wizard-icons/${template.id}.webp`} alt="" className="size-full object-cover" />
        ) : (
          <FallbackIcon className="size-[19px]" />
        )}
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-medium">{isBlank ? "空白模板" : template.title}</span>
        <span className="mt-0.5 line-clamp-2 block text-[11.5px] leading-snug text-muted-foreground">
          {isBlank ? "从空白开始，此环节不使用预制内容。" : template.summary}
        </span>
      </span>
    </button>
  )
}

export function CreateNovelDialog({
  open,
  onOpenChange,
  novels,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  novels: { id: string; title: string }[]
}) {
  const { templates, loading: templatesLoading, error: templatesError, reload: reloadTemplates } = useWizardTemplates(open)
  const templateById = useMemo(() => new Map(templates.map(template => [template.id, template])), [templates])
  const [filters, setFilters] = useState<WizardFilters>(freshFilters)
  const [tagError, setTagError] = useState("")
  const [cat, setCat] = useState<WizardCategory>("theme")
  const [picks, setPicks] = useState<WizardPicks>(() => ({ ...BLANK_PICKS }))
  const [detail, setDetail] = useState<WizardTemplate | "blank" | null>(null)
  const [confirmReplace, setConfirmReplace] = useState(false)
  const gridRef = useRef<HTMLDivElement>(null)

  const genres = useMemo(() => genresForChannel(filters.channel), [filters.channel])
  const styles = useMemo(() => stylesForChannel(filters.channel), [filters.channel])
  const visible = useMemo(() => visibleTemplates(cat, filters, templates), [cat, filters, templates])
  /** 边栏四项计数：一次遍历同时算出（与当前环节列表同一过滤口径） */
  const counts = useMemo(() => {
    const c: Record<WizardCategory, number> = { theme: 0, world: 0, character: 0, plot: 0 }
    for (const t of templates) if (isTemplateVisible(t, filters)) c[t.cat] += 1
    return c
  }, [filters, templates])

  // 过滤条件/环节变化后卡片网格滚动回顶
  useEffect(() => {
    if (gridRef.current) gridRef.current.scrollTop = 0
  }, [filters, cat])

  // 本地模板库可在管理窗口被停用、删除或编辑；仍沿用原过滤裁剪规则。
  useEffect(() => {
    if (!open || templatesLoading || templatesError) return
    setPicks(previous => {
      const next = pruneInvisiblePicks(previous, filters, templates)
      return WIZARD_CATEGORIES.every(category => next[category] === previous[category]) ? previous : next
    })
    setDetail(previous => {
      if (previous === null || previous === "blank") return previous
      const current = templateById.get(previous.id)
      return current && current.cat === previous.cat && isTemplateVisible(current, filters) ? current : null
    })
    setConfirmReplace(false)
  }, [open, templatesLoading, templatesError, templates, templateById, filters])

  /** 条件变更统一入口：联动裁剪已选不可见模板；任何条件/选卡变化都复位覆盖确认态 */
  const updateFilters = (next: WizardFilters) => {
    if (next === filters) return
    setTagError("")
    setFilters(next)
    setPicks((p) => pruneInvisiblePicks(p, next, templates))
    setConfirmReplace(false)
  }

  const toggleTag = (group: WizardTagGroup, tag: string) => {
    const sel = new Set(filters.tags[group])
    if (sel.has(tag)) sel.delete(tag)
    else {
      if (positionFromFilters(filters).tags.length >= POSITION_TAG_LIMIT) { setTagError(`最多选择 ${POSITION_TAG_LIMIT} 个标签`); return }
      sel.add(tag)
    }
    updateFilters({ ...filters, tags: { ...filters.tags, [group]: sel } })
  }

  const pickTemplate = (id: string) => {
    setPicks((p) => (p[cat] === id ? p : { ...p, [cat]: id }))
    setConfirmReplace(false)
  }

  /** 单击选中/再点取消（回空白；空白卡本身再点无变化） */
  const handleCardClick = (id: string) => {
    pickTemplate(picks[cat] === id && id !== "blank" ? "blank" : id)
  }

  /** 双击恒为选中态并开详情：双击前两次 click 的终态可能被「再点取消」翻回空白，这里覆盖回选中 */
  const handleCardDoubleClick = (t: WizardTemplate | "blank") => {
    pickTemplate(t === "blank" ? "blank" : t.id)
    setDetail(t)
  }

  const handleUseDetail = () => {
    if (detail === null) return
    if (detail === "blank") pickTemplate("blank")
    else {
      const current = templateById.get(detail.id)
      if (current && current.cat === cat && isTemplateVisible(current, filters)) pickTemplate(current.id)
    }
    setDetail(null)
  }

  const pickedName = (c: WizardCategory) => {
    const id = picks[c]
    return id === "blank" ? "空白" : `《${templateById.get(id)?.title ?? "?"}》`
  }

  const reset = () => {
    setTagError("")
    setFilters(freshFilters())
    setCat("theme")
    setPicks({ ...BLANK_PICKS })
    setDetail(null)
    setConfirmReplace(false)
  }

  const closeWizard = () => {
    reset()
    onOpenChange(false)
  }

  // Esc 分层（技术设计 §5.3 修订 B-1）：Base UI 的 Esc 关闭走 document 监听，容器 onKeyDown 拦不住；
  // 详情层打开时用官方取消机制拦下本次关闭，只关详情层。
  const handleDialogOpenChange: NonNullable<ComponentProps<typeof Dialog>["onOpenChange"]> = (next, details) => {
    if (!next && details.reason === "escape-key" && detail) {
      details.cancel()
      setDetail(null)
      return
    }
    if (!next) reset()
    onOpenChange(next)
  }

  /** 确定：草稿非空时先经两步确认（任意 filters/picks 变化自动复位）；不自动发送 */
  const handleConfirm = () => {
    if (templatesLoading || templatesError) return
    const resolved: Record<WizardCategory, WizardTemplate | null> = { theme: null, world: null, character: null, plot: null }
    for (const c of WIZARD_CATEGORIES) {
      resolved[c] = picks[c] === "blank" ? null : (templateById.get(picks[c]) ?? null)
    }
    const draft = composeWizardDraft(filters, resolved)
    if (useChatStore.getState().draft.trim() && !confirmReplace) {
      setConfirmReplace(true)
      return
    }
    useChatStore.getState().requestNewConversation({
      novelId: null,
      draft,
      pendingNovelTitle: fallbackTitle(novels),
      pendingNovelPosition: positionFromFilters(filters),
    })
    closeWizard()
  }

  const detailTemplate = detail === "blank" ? null : detail

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent className="chatpane flex h-[min(880px,92dvh)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1280px]">
        <DialogHeader className="shrink-0 px-[22px] pt-[18px] pb-3 pr-12">
          <DialogTitle className="text-[17px] font-semibold">创作向导</DialogTitle>
          <DialogDescription className="text-[12.5px]">
            先定位作品方向，再为每个环节挑一个起手模板；确定后拼进输入框，由你修改后再发送。
          </DialogDescription>
        </DialogHeader>

        {/* 定位条件区：频道/篇幅/题材/子类(仅选中具体题材时出现)/背景/风格/情节，超高独立滚动 */}
        <div className="flex max-h-[45%] shrink-0 flex-col gap-2 overflow-y-auto border-b border-border px-[22px] pb-3">
          {tagError && <p role="alert" className="text-xs text-destructive">{tagError}</p>}
          <FilterRow label="频道">
            {["不限", ...WIZARD_CHANNELS].map((x) => (
              <Chip key={x} label={x} selected={filters.channel === x} onClick={() => updateFilters(onChannelChange(filters, x))} />
            ))}
          </FilterRow>
          <FilterRow label="篇幅">
            {["不限", ...WIZARD_LENGTHS].map((x) => (
              <Chip
                key={x}
                label={x}
                selected={filters.length === x}
                onClick={() => {
                  if (filters.length !== x) updateFilters({ ...filters, length: x })
                }}
              />
            ))}
          </FilterRow>
          <FilterRow label="题材">
            {["全部", ...genres].map((x) => (
              <Chip key={x} label={x} selected={filters.genre === x} onClick={() => updateFilters(onGenreChange(filters, x))} />
            ))}
          </FilterRow>
          {filters.genre !== "全部" && (WIZARD_SUBGENRES[filters.genre]?.length ?? 0) > 0 && (
            <FilterRow label="子类">
              {WIZARD_SUBGENRES[filters.genre].map((x) => (
                <Chip key={x} label={x} selected={filters.tags.sub.has(x)} onClick={() => toggleTag("sub", x)} />
              ))}
            </FilterRow>
          )}
          <FilterRow label="背景">
            {WIZARD_BACKGROUNDS.map((x) => (
              <Chip key={x} label={x} selected={filters.tags.bg.has(x)} onClick={() => toggleTag("bg", x)} />
            ))}
          </FilterRow>
          <FilterRow label="风格">
            {styles.map((x) => (
              <Chip key={x} label={x} selected={filters.tags.style.has(x)} onClick={() => toggleTag("style", x)} />
            ))}
          </FilterRow>
          <FilterRow label="情节">
            {WIZARD_FLOWS.map((x) => (
              <Chip key={x} label={x} selected={filters.tags.flow.has(x)} onClick={() => toggleTag("flow", x)} />
            ))}
          </FilterRow>
        </div>

        {templatesError ? <div role="alert" className="flex items-center justify-between gap-2 px-[22px] py-2 text-sm text-destructive"><span>{templatesError.message}</span><Button variant="outline" size="sm" onClick={() => void reloadTemplates()}>重新加载模板</Button></div> : templatesLoading ? <p role="status" className="px-[22px] py-2 text-sm text-muted-foreground">正在读取本地模板…</p> : null}
        {/* 主体：左环节边栏（<760px 收窄纯图标列，圆点保留、计数隐藏）+ 右模板网格（独立滚动） */}
        <div className="flex min-h-0 flex-1">
          <nav className="flex w-[138px] shrink-0 flex-col gap-1 border-r border-border px-2.5 py-3.5 max-[760px]:w-16 max-[760px]:px-2">
            {WIZARD_CATEGORIES.map((c) => {
              const meta = CATEGORY_META[c]
              const active = c === cat
              return (
                <button
                  key={c}
                  type="button"
                  aria-current={active || undefined}
                  onClick={() => setCat(c)}
                  className={cn(
                    "flex items-center gap-2 rounded-lg px-3 py-2 text-[13.5px] whitespace-nowrap text-foreground transition-colors hover:bg-hover-wash",
                    active && "bg-selected-surface font-medium text-primary"
                  )}
                >
                  <meta.icon className="size-[15px] shrink-0" />
                  <span className="max-[760px]:hidden">{meta.name}</span>
                  <span className="ml-auto text-[11px] font-normal text-muted-foreground max-[760px]:hidden">{counts[c]}</span>
                  {picks[c] !== "blank" && <span className="size-1.5 shrink-0 rounded-full bg-primary" />}
                </button>
              )
            })}
          </nav>
          <div
            ref={gridRef}
            className="grid min-w-0 flex-1 content-start grid-cols-[repeat(auto-fill,minmax(218px,1fr))] gap-2.5 overflow-y-auto px-[18px] py-4"
          >
            <TemplateCard
              template={null}
              cat={cat}
              selected={picks[cat] === "blank"}
              onClick={() => handleCardClick("blank")}
              onDoubleClick={() => handleCardDoubleClick("blank")}
            />
            {visible.length === 0 && (
              <div className="col-span-full px-0.5 py-1.5 text-[12.5px] text-muted-foreground">
                当前条件下暂无预制模板，可从空白开始或放宽条件。
              </div>
            )}
            {visible.map((t) => (
              <TemplateCard
                key={t.id}
                template={t}
                cat={cat}
                selected={picks[cat] === t.id}
                onClick={() => handleCardClick(t.id)}
                onDoubleClick={() => handleCardDoubleClick(t)}
              />
            ))}
          </div>
        </div>

        {/* 底部：已选摘要 + 取消/确定（草稿非空时确定进入覆盖确认态） */}
        <div className="flex shrink-0 items-center gap-3.5 border-t border-border px-[22px] py-3">
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            已选：
            {WIZARD_CATEGORIES.map((c, i) => (
              <span key={c}>
                {i > 0 && " · "}
                {CATEGORY_META[c].name}{" "}
                <b className="font-medium text-foreground">{pickedName(c)}</b>
              </span>
            ))}
          </span>
          <div className="flex shrink-0 items-center gap-2">
            {confirmReplace ? (
              <>
                <span className="text-xs text-muted-foreground">将替换输入框已有内容，确认？</span>
                <Button variant="outline" onClick={() => setConfirmReplace(false)}>
                  返回
                </Button>
                <Button disabled={templatesLoading || !!templatesError} onClick={handleConfirm}>仍要替换</Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={closeWizard}>
                  取消
                </Button>
                <Button disabled={templatesLoading || !!templatesError} onClick={handleConfirm}>确定</Button>
              </>
            )}
          </div>
        </div>

        {/* 详情层：对话框内第二层覆盖；点背板只关详情、不关向导（Esc 分层见 onOpenChange） */}
        {detail !== null && (
          <div
            className="absolute inset-0 z-10 grid place-items-center bg-black/45 p-10 dark:bg-black/60 max-[760px]:p-5"
            onClick={() => setDetail(null)}
          >
            <div
              className="flex max-h-full w-[min(600px,100%)] flex-col rounded-xl border border-border bg-popover shadow-2"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start gap-3 px-5 pt-[18px] pb-2.5">
                <div>
                  <h2 className="text-[15.5px] font-semibold">{detailTemplate?.title ?? "空白模板"}</h2>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {CATEGORY_META[cat].name} · {detailTemplate ? "预制模板" : "空白模板"}
                  </div>
                </div>
                <button
                  type="button"
                  aria-label="关闭详情"
                  onClick={() => setDetail(null)}
                  className="ml-auto flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-hover-wash hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-3.5">
                {detailTemplate && (
                  <div className="mb-2.5 flex flex-wrap gap-1.5">
                    {detailMeta(detailTemplate).map((m) => (
                      <span
                        key={m}
                        className="rounded-full border border-(--chat-line) px-3 py-[3px] text-[12.5px] leading-[1.6] text-muted-foreground"
                      >
                        {m}
                      </span>
                    ))}
                  </div>
                )}
                <div className="rounded-lg border border-(--chat-line) bg-chat-surface p-4 text-[13px] leading-[1.8] whitespace-pre-wrap">
                  {detailTemplate ? detailTemplate.prompt : BLANK_DETAIL_TEXT}
                </div>
              </div>
              <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
                <Button variant="outline" onClick={() => setDetail(null)}>
                  返回
                </Button>
                <Button onClick={handleUseDetail}>使用此模板</Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
