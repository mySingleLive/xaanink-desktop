"use client"

import { useEffect, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Check, ImageIcon, Loader2, X } from "lucide-react"

import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { DraftConflictTools } from "./DraftConflictTools"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { themeTagGroups } from "@/lib/theme-tags"
import { changePosition, POSITION_CHANNELS, POSITION_TAG_LIMIT, POSITION_TAG_LENGTH, positionError } from "@/lib/creation-wizard/position"
import { genresForChannel } from "@/lib/creation-wizard/filter"
import { WIZARD_LENGTHS, WIZARD_LENGTH_META, type WizardLength } from "@/lib/creation-wizard/taxonomy"
import type { SaveAttempt } from "@/lib/autosave-controller"
import { useStagedChangesStore } from "@/stores/staged-changes"
import { buildTabId, useTabsStore } from "@/stores/tabs"

import { apiGet, apiSend } from "./api"
import type { ContentPanelProps } from "./registry"
import { SaveStatusIndicator, useAutosave, useOwnSyncTokens, useExternalSyncKey } from "./use-autosave"

interface ThemeData {
  id: string
  title: string
  synopsis: string
  referenceCases: string
  channel: string
  genre: string
  length: string
  tags: string[]
  sellingPoints: string
  targetAudience: string
  version: number
}

interface ThemeForm {
  title: string
  synopsis: string
  referenceCases: string
  channel: string
  genre: string
  length: string
  tags: string[]
  sellingPoints: string
  targetAudience: string
}

const EMPTY_FORM: ThemeForm = {
  title: "",
  synopsis: "",
  referenceCases: "",
  channel: "不限",
  genre: "全部",
  length: "",
  tags: [],
  sellingPoints: "",
  targetAudience: "",
}

function themeToForm(theme: ThemeData | null): ThemeForm {
  if (!theme) return EMPTY_FORM
  return {
    title: theme.title,
    synopsis: theme.synopsis,
    referenceCases: theme.referenceCases,
    channel: theme.channel,
    genre: theme.genre,
    length: theme.length ?? "",
    tags: theme.tags,
    sellingPoints: theme.sellingPoints,
    targetAudience: theme.targetAudience,
  }
}

/** 封面区块：封面属 Novel 而非 Theme，不进 ThemeForm 的 autosave 状态；点击打开封面面板（上传/文生图均在面板内） */
function CoverBlock({
  novelId,
  coverUrl,
}: {
  novelId: string
  coverUrl: string | null
}) {
  const openTab = useTabsStore((s) => s.openTab)

  const openCoverPanel = () =>
    openTab({
      id: buildTabId("novel-cover", novelId),
      type: "novel-cover",
      novelId,
      title: "小说封面",
    })

  return (
    <div className="grid gap-2">
      <Label>封面</Label>
      <div className="flex justify-center">
        <button
          type="button"
          onClick={openCoverPanel}
          title="点击打开封面面板"
          className={cn(
            "group relative aspect-[2/3] w-80 overflow-hidden rounded-xl border bg-muted/40 transition-colors hover:border-primary/60",
            !coverUrl && "border-dashed"
          )}
        >
          {coverUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element -- 运行时上传的本地封面，不走 next/image 优化 */
            <img
              src={coverUrl}
              alt="小说封面"
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted-foreground">
              <ImageIcon className="size-10" />
              <span className="text-sm">点击设置封面</span>
            </span>
          )}
          {coverUrl && (
            <span className="absolute inset-0 flex items-center justify-center bg-background/70 text-sm text-foreground opacity-0 transition-opacity group-hover:opacity-100">
              编辑
            </span>
          )}
        </button>
      </div>
    </div>
  )
}

/** 主题表单（key=novelId，数据就绪后以初始值初始化本地状态） */
function ThemeFormEditor({
  novelId,
  initial,
  coverUrl,
  onOwnSave,
  onDirty,
}: {
  novelId: string
  onOwnSave: (version: number) => void
  onDirty: (dirty: boolean) => void
  initial: ThemeData | null
  coverUrl: string | null
}) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<ThemeForm>(() => themeToForm(initial))
  const formRef = useRef(form)
  const [version, setVersion] = useState<number | null>(initial?.version ?? null)
  const versionRef = useRef(initial?.version ?? 0)
  const [selectionNotice, setSelectionNotice] = useState("")
  const [tagError, setTagError] = useState("")
  const [saveError, setSaveError] = useState("")
  const [tagInput, setTagInput] = useState("")
  const [tagSuggestOpen, setTagSuggestOpen] = useState(false)
  const [tagActive, setTagActive] = useState(0)

  const save = async (value: ThemeForm, attempt: SaveAttempt<ThemeForm>) => {
    try {
      const { theme } = await apiSend<{ theme: ThemeData }>(
        `/api/novels/${novelId}/theme`, "PATCH",
        { ...value, expectedVersion: versionRef.current, operationId: attempt.operationId }, "保存主题失败"
      )
      versionRef.current = theme.version
      setVersion(theme.version)
      const staged = Object.values(useStagedChangesStore.getState().batches).some(b => b.changes.some(c => c.novelId === novelId && c.targetKind === "THEME"))
      if (!staged) onOwnSave(theme.version)
      setSaveError("")
      queryClient.invalidateQueries({ queryKey: ["theme", novelId] })
      queryClient.invalidateQueries({ queryKey: ["novels"] })
      queryClient.invalidateQueries({ queryKey: ["novels", novelId] })
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "保存失败，草稿已保留")
      throw error
    }
  }

  const { status, schedule, saveNow, retry, controller } = useAutosave<ThemeForm>(save)
  useEffect(() => { onDirty(controller.dirty); return () => onDirty(false) }, [status, controller, onDirty])

  const update = (patch: Partial<ThemeForm>) => {
    const next = { ...form, ...patch }
    formRef.current = next
    setForm(next)
    if (next.title.trim()) schedule(next)
  }

  const pickTag = (tag: string) => {
    const tags = form.tags.includes(tag) ? form.tags.filter(t => t !== tag) : [...form.tags, tag]
    const error = positionError({ ...form, tags }, form)
    if (error) { setTagError(error); return }
    setTagError("")
    update({ tags })
    setTagInput("")
    setTagActive(0)
  }
  const addTag = () => {
    const tag = tagInput.trim()
    if (!tag) return
    if (form.tags.includes(tag)) { setTagInput(""); return }
    pickTag(tag)
  }
  const changeSelection = (field: "channel" | "genre", value: string | null) => {
    if (!value) return
    const next = changePosition(form, field, value)
    if (next === form) return
    const removed = form.tags.filter(t => !next.tags.includes(t))
    setSelectionNotice(removed.length ? `已移除不适用的标签：${removed.join("、")}` : "")
    setTagError("")
    setTagActive(0)
    update(next)
  }
  const tagQuery = tagInput.trim()
  const tagGroups = themeTagGroups(form.channel, form.genre).filter(g => g.key !== "sub" || (!!form.genre && form.genre !== "全部")).map(g => ({ ...g, tags: g.tags.filter(t => !tagQuery || t.includes(tagQuery)) }))
  const tagFlat = tagGroups.flatMap(g => g.tags)
  const genres = ["全部", ...genresForChannel(form.channel)]
  const legacyChannel = !!form.channel && !(POSITION_CHANNELS as readonly string[]).includes(form.channel)
  const legacyGenre = !!form.genre && !genres.includes(form.genre)

  return (
    <div className="h-full overflow-y-auto p-6 @container" data-testid="theme-panel">
      <div className="mx-auto flex max-w-3xl flex-col gap-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">主题设定</h2>
          <div className="flex items-center gap-3">
            <SaveStatusIndicator status={status} />
            {version !== null && (
              <Badge variant="secondary">v{version}</Badge>
            )}
          </div>
        </div>

        {saveError && <div role="alert" className="text-sm text-destructive">{saveError}
          <Button size="sm" variant="ghost" onClick={() => { controller.resume(); void retry().catch(error => toast.error(error.message)) }}>重试原保存</Button>
          <DraftConflictTools
            readLocal={() => ({ title: formRef.current.title, text: JSON.stringify(formRef.current, null, 2), data: { ...formRef.current, version: versionRef.current } })}
            readCurrent={async () => {
              const { theme } = await apiGet<{ theme: ThemeData | null }>(`/api/novels/${novelId}/theme`)
              if (!theme) throw new Error("主题已不存在，本地草稿仍保留")
              return { title: theme.title, text: JSON.stringify(themeToForm(theme), null, 2), data: { ...themeToForm(theme), version: theme.version } }
            }}
            revision={() => controller.revision} pause={() => controller.pause()}
            saveLocal={async (current, local, operationId, revision) => {
              const localForm = themeToForm({ ...local.data, id: initial?.id ?? "" })
              const { theme } = await apiSend<{ theme: ThemeData }>(`/api/novels/${novelId}/theme`, "PATCH", { ...localForm, expectedVersion: current.data.version, operationId })
              if (!controller.confirmExternal(revision)) throw new Error("期间的新输入已保留，请重新比较")
              const next = themeToForm(theme)
              formRef.current = next; setForm(next); versionRef.current = theme.version; setVersion(theme.version); onOwnSave(theme.version); setSaveError(""); onDirty(false)
              queryClient.invalidateQueries({ queryKey: ["theme", novelId] })
              queryClient.invalidateQueries({ queryKey: ["novels"] })
            }}
            adoptCurrent={(current, revision) => {
              if (!controller.confirmExternal(revision)) throw new Error("仍有未确认的保存，请稍后核对")
              const { version: currentVersion, ...next } = current.data
              formRef.current = next; setForm(next); versionRef.current = currentVersion; setVersion(currentVersion); onOwnSave(currentVersion); setSaveError(""); onDirty(false)
            }}
          />
        </div>}

        <CoverBlock novelId={novelId} coverUrl={coverUrl} />

        <div className="grid gap-2">
          <Label htmlFor="theme-title">书名</Label>
          <Input
            id="theme-title"
            value={form.title}
            onChange={(e) => update({ title: e.target.value })}
            onBlur={() => form.title.trim() && saveNow()}
            placeholder="小说书名（必填，填写后自动保存）"
            maxLength={100}
          />
        </div>

        <div className="grid gap-2">
          <Label>简介</Label>
          <Textarea
            value={form.synopsis}
            onChange={(e) => update({ synopsis: e.target.value })}
            onBlur={() => saveNow()}
            placeholder="一句话讲清楚这本书写什么、爽在哪里"
            rows={4}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 @[400px]:grid-cols-2">
          <div className="grid gap-2 @[400px]:col-start-1 @[400px]:row-start-1">
            <Label id="theme-channel-label">频道</Label>
            <Select value={form.channel || "不限"} onValueChange={v => changeSelection("channel", v as string | null)}>
              <SelectTrigger className="w-full" aria-labelledby="theme-channel-label"><SelectValue placeholder="选择频道">{legacyChannel ? form.channel : undefined}</SelectValue></SelectTrigger>
              <SelectContent>{POSITION_CHANNELS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
            {legacyChannel && <p className="text-xs text-muted-foreground">历史值：{form.channel}，保留至你重新选择</p>}
          </div>
          <div className="grid gap-2 @[400px]:col-start-1 @[400px]:row-start-2">
            <Label id="theme-length-label">篇幅</Label>
            <Select value={form.length || null} onValueChange={v => v && update({ length: v as string })}>
              <SelectTrigger className="w-full" aria-labelledby="theme-length-label"><SelectValue placeholder="选择篇幅" /></SelectTrigger>
              <SelectContent>{WIZARD_LENGTHS.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid gap-2 @[400px]:col-start-2 @[400px]:row-start-1">
            <Label id="theme-genre-label">题材</Label>
            <Select value={form.genre || "全部"} onValueChange={v => changeSelection("genre", v as string | null)}>
              <SelectTrigger className="w-full" aria-labelledby="theme-genre-label"><SelectValue placeholder="选择题材">{legacyGenre ? form.genre : undefined}</SelectValue></SelectTrigger>
              <SelectContent>{genres.map(g => <SelectItem key={g} value={g}>{g}</SelectItem>)}</SelectContent>
            </Select>
            {legacyGenre && <p className="text-xs text-muted-foreground">历史值：{form.genre}，保留至你重新选择</p>}
          </div>
          <p className="self-center text-xs text-muted-foreground @[400px]:col-start-2 @[400px]:row-start-2">{form.length ? `参考字数：${WIZARD_LENGTH_META[form.length as WizardLength] ?? form.length}` : "篇幅未指定，选择后显示参考字数"}</p>
        </div>

        <div className="grid gap-2">
          <div className="flex items-center justify-between"><Label htmlFor="theme-tags">标签</Label><span className="text-xs text-muted-foreground">{form.tags.length}/{POSITION_TAG_LIMIT}</span></div>
          <div className="relative flex flex-wrap items-center gap-1.5 rounded-lg border border-input px-2 py-1.5">
            {form.tags.map((tag) => (
              <Badge key={tag} variant="secondary" className="gap-1">
                {tag}
                <button
                  type="button"
                  aria-label={`移除标签 ${tag}`}
                  onClick={() => pickTag(tag)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3" />
                </button>
              </Badge>
            ))}
            <input
              id="theme-tags"
              role="combobox"
              aria-expanded={tagSuggestOpen}
              aria-controls="theme-tag-options"
              aria-autocomplete="list"
              aria-activedescendant={tagSuggestOpen && tagFlat[tagActive] ? `theme-tag-${tagActive}` : undefined}
              aria-describedby={tagError ? "theme-tag-error" : undefined}
              value={tagInput}
              onChange={(e) => {
                setTagInput(e.target.value)
                setTagActive(0)
                setTagSuggestOpen(true)
              }}
              onFocus={() => setTagSuggestOpen(true)}
              onBlur={() => {
                setTagSuggestOpen(false)
                addTag()
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  if (tagSuggestOpen && tagFlat[tagActive]) {
                    pickTag(tagFlat[tagActive])
                  } else {
                    addTag()
                  }
                } else if (e.key === "ArrowDown") {
                  e.preventDefault()
                  setTagSuggestOpen(true)
                  setTagActive((i) => Math.min(i + 1, Math.max(0, tagFlat.length - 1)))
                } else if (e.key === "ArrowUp") {
                  e.preventDefault()
                  setTagActive((i) => Math.max(i - 1, 0))
                } else if (e.key === "Escape") {
                  setTagSuggestOpen(false)
                }
              }}
              placeholder="搜索标签，或输入自定义标签后回车"
              maxLength={POSITION_TAG_LENGTH + 1}
              className="min-w-32 flex-1 bg-transparent text-sm outline-none"
            />
            {tagSuggestOpen && (
              <div
                id="theme-tag-options"
                role="listbox"
                aria-multiselectable="true"
                aria-label="可选标签"
                className="absolute top-full right-0 left-0 z-50 mt-1 max-h-[360px] overflow-y-auto rounded-xl border border-border bg-popover p-1.5 shadow-[0_8px_24px_-8px_var(--shadow-color)]"
              >
                {(() => {
                  let flat = -1
                  return tagGroups.map((g) => (
                    <div key={g.key}>
                      <div className="px-2.5 pt-1.5 pb-0.5 text-[11px] font-medium text-muted-foreground">
                        {g.label}
                      </div>
                      <div className="flex flex-wrap gap-1 px-1.5 pb-1">
                        {g.tags.length === 0 && <span className="px-1 py-1 text-xs text-muted-foreground">{g.key === "sub" && (!form.genre || form.genre === "全部") ? "选择题材后显示子类" : "无匹配标签"}</span>}
                        {g.tags.map((tag) => {
                          flat += 1
                          const idx = flat
                          return (
                            <button
                              key={tag}
                              type="button"
                              id={`theme-tag-${idx}`}
                              role="option"
                              aria-selected={form.tags.includes(tag)}
                              /* mousedown + preventDefault：选中发生在 input blur 之前，提示框不因失焦提前关闭 */
                              onMouseDown={(e) => {
                                e.preventDefault()
                              }}
                              onClick={() => pickTag(tag)}
                              onMouseEnter={() => setTagActive(idx)}
                              className={cn(
                                "rounded-md px-2 py-1 text-[12.5px] transition-colors",
                                idx === tagActive && "ring-1 ring-primary/40",
                                form.tags.includes(tag) ? "bg-selected-surface text-primary" : "text-foreground/90 hover:bg-hover-wash"
                              )}
                            >
                              {form.tags.includes(tag) && <Check className="mr-1 inline size-3" />}{tag}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ))
                })()}
              </div>
            )}
          </div>
          {selectionNotice && <p role="status" className="text-xs text-muted-foreground">{selectionNotice}</p>}
          {tagError && <p id="theme-tag-error" role="alert" className="text-xs text-destructive">{tagError}</p>}
        </div>

        <div className="grid gap-2">
          <Label>核心卖点</Label>
          <Textarea
            value={form.sellingPoints}
            onChange={(e) => update({ sellingPoints: e.target.value })}
            onBlur={() => saveNow()}
            placeholder="这本书最吸引读者的点是什么"
            rows={3}
          />
        </div>

        <div className="grid gap-2">
          <Label>目标受众</Label>
          <Textarea
            value={form.targetAudience}
            onChange={(e) => update({ targetAudience: e.target.value })}
            onBlur={() => saveNow()}
            placeholder="写给谁看：年龄段、阅读偏好等"
            rows={2}
          />
        </div>

        <div className="grid gap-2">
          <Label>参考案例</Label>
          <Textarea
            value={form.referenceCases}
            onChange={(e) => update({ referenceCases: e.target.value })}
            onBlur={() => saveNow()}
            placeholder="对标作品或参考桥段，AI 生成时会参考"
            rows={3}
          />
        </div>
      </div>
    </div>
  )
}

/** 主题编辑（type=theme）：结构化表单 + 800ms 防抖自动保存 */
export function ThemePanel({ novelId }: ContentPanelProps) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["theme", novelId],
    queryFn: () =>
      apiGet<{ theme: ThemeData | null }>(`/api/novels/${novelId}/theme`, "加载主题失败"),
  })
  const { data: novelData } = useQuery({
    queryKey: ["novels", novelId],
    queryFn: () =>
      apiGet<{ novel: { title: string; coverUrl: string | null } }>(
        `/api/novels/${novelId}`,
        "加载小说失败"
      ),
  })

  const ownSaves = useOwnSyncTokens<number>()
  const [dirty, setDirty] = useState(false)
  const staged = useStagedChangesStore(s => Object.values(s.batches).some(b => b.changes.some(c => c.novelId === novelId && c.targetKind === "THEME")))
  const syncKey = useExternalSyncKey(data?.theme?.version ?? 0, ownSaves.isOwn, dirty || staged)

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    )
  }
  if (isError) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        主题加载失败，请稍后重试
      </div>
    )
  }

  return (
    <ThemeFormEditor
      key={`${novelId}:${syncKey}`}
      onOwnSave={ownSaves.track}
      onDirty={setDirty}
      novelId={novelId}
      initial={data?.theme ?? null}
      coverUrl={novelData?.novel.coverUrl ?? null}
    />
  )
}
