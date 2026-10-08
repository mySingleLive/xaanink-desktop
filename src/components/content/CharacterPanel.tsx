"use client"

import { useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ImageIcon, Loader2, Sparkles, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import type { CharacterRoleType } from "@/generated/prisma/enums"
import { ALIAS_MAX, ALIASES_MAX } from "@/lib/aliases"
import { ARC_STAGE_NAME_MAX, normalizeArcStages, type ArcStage } from "@/lib/arc-stage"
import { PERSONALITY_TAGS_MAX, PERSONALITY_TAG_MAX } from "@/lib/personality-tags"
import { buildTabId, useTabsStore, type CharacterImageKind } from "@/stores/tabs"

import { apiGet, apiSend } from "./api"
import { BubbleInput } from "./BubbleInput"
import {
  BeliefsFields,
  BigFiveSlider,
  FieldCard,
  MotivationsEditor,
  RelationshipsEditor,
} from "./character-fields"
import { ArcTab } from "./character-arc/arc-tab"
import { CroppedImage } from "./CroppedImage"
import { EntityAttributesEditor } from "./EntityAttributesEditor"
import { CHARACTER_ROLE_LABELS } from "./labels"
import type { ContentPanelProps } from "./registry"
import {
  BELIEF_KEYS,
  normalizeAliases,
  normalizeBeliefs,
  normalizeBigFive,
  normalizeCrop,
  normalizeEntityAttributes,
  normalizeMotivations,
  normalizePersonalityTags,
  normalizeRelationships,
  type BeliefKey,
  type Beliefs,
  type BigFive,
  type CharacterRecord,
  type EntityAttributeItem,
  type MotivationLayer,
  type RelationshipItem,
} from "./types"
import { SaveStatusIndicator, useAutosave, useExternalSyncKey, useOwnSyncTokens } from "./use-autosave"

/** 面板内子 Tab：身份·外在 / 心理 / 能力 / 弧线 / 关系（切换是纯 UI 操作，不触发保存） */
type CharacterPanelTab = "identity" | "psyche" | "ability" | "arc" | "relation"
const CHARACTER_PANEL_TABS: CharacterPanelTab[] = ["identity", "psyche", "ability", "arc", "relation"]

interface CharacterForm {
  name: string
  roleType: CharacterRoleType
  aliases: string[]
  age: string
  gender: string
  occupation: string
  bio: string
  personality: string
  personalityTags: string[]
  height: string
  weight: string
  build: string
  faceShape: string
  appearance: string
  clothing: string
  tastes: string
  habits: string
  catchphrase: string
  dialogueStyle: string
  sampleDialogue: string
  motivations: MotivationLayer[]
  desires: string
  fears: string
  beliefs: Beliefs
  bigFive: BigFive | null
  abilities: string
  backstory: string
  growthArc: string
  arcStages: ArcStage[]
  relationships: RelationshipItem[]
  attributes: EntityAttributeItem[]
}

function toForm(c: CharacterRecord): CharacterForm {
  return {
    name: c.name,
    roleType: c.roleType,
    aliases: normalizeAliases(c.aliases),
    age: c.age,
    gender: c.gender,
    occupation: c.occupation,
    bio: c.bio,
    personality: c.personality,
    personalityTags: normalizePersonalityTags(c.personalityTags),
    height: c.height,
    weight: c.weight,
    build: c.build,
    faceShape: c.faceShape,
    appearance: c.appearance,
    clothing: c.clothing,
    tastes: c.tastes,
    habits: c.habits,
    catchphrase: c.catchphrase,
    dialogueStyle: c.dialogueStyle,
    sampleDialogue: c.sampleDialogue,
    motivations: normalizeMotivations(c.motivations),
    desires: c.desires,
    fears: c.fears,
    beliefs: normalizeBeliefs(c.beliefs),
    bigFive: normalizeBigFive(c.bigFive),
    abilities: c.abilities,
    backstory: c.backstory,
    growthArc: c.growthArc,
    arcStages: normalizeArcStages(c.arcStages),
    relationships: normalizeRelationships(c.relationships),
    attributes: normalizeEntityAttributes(c.attributes),
  }
}

/** 保存前清理核心动机：去掉空文本条与空层（schema 要求每层至少一条非空文本） */
function cleanMotivations(layers: MotivationLayer[]): MotivationLayer[] {
  return layers
    .map((layer) => ({
      items: layer.items
        .filter((m) => m.text.trim())
        .map((m) => ({ ...m, text: m.text.trim() })),
    }))
    .filter((layer) => layer.items.length > 0)
}

/** 保存前清理观念：去掉空白条目并 trim（schema 全可选，空键不落库） */
function cleanBeliefs(beliefs: Beliefs): Beliefs {
  const out: Beliefs = {}
  for (const { key } of BELIEF_KEYS) {
    const t = (beliefs[key] ?? "").trim()
    if (t) out[key] = t
  }
  return out
}

/** 从 AI 输出中 tolerant parse 角色草稿 JSON，失败返回 null（兼容旧 key signatureAction → habits） */
function parseCharacterDraft(raw: string): Partial<CharacterForm> | null {
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  for (const candidate of [fence?.[1], raw]) {
    if (!candidate) continue
    try {
      const obj = JSON.parse(candidate.trim()) as Record<string, unknown>
      if (!obj || typeof obj !== "object") continue
      const str = (v: unknown) => (typeof v === "string" ? v : undefined)
      return {
        name: str(obj.name),
        aliases: obj.aliases !== undefined ? normalizeAliases(obj.aliases) : undefined,
        age: str(obj.age),
        gender: str(obj.gender),
        occupation: str(obj.occupation),
        bio: str(obj.bio),
        personality: str(obj.personality),
        personalityTags:
          obj.personalityTags !== undefined
            ? normalizePersonalityTags(obj.personalityTags)
            : undefined,
        height: str(obj.height),
        weight: str(obj.weight),
        build: str(obj.build),
        faceShape: str(obj.faceShape),
        appearance: str(obj.appearance),
        clothing: str(obj.clothing),
        tastes: str(obj.tastes),
        habits: str(obj.habits) ?? str(obj.signatureAction),
        catchphrase: str(obj.catchphrase),
        dialogueStyle: str(obj.dialogueStyle),
        sampleDialogue: str(obj.sampleDialogue),
        motivations:
          obj.motivations !== undefined
            ? normalizeMotivations(obj.motivations)
            : undefined,
        desires: str(obj.desires),
        fears: str(obj.fears),
        beliefs: obj.beliefs !== undefined ? normalizeBeliefs(obj.beliefs) : undefined,
        // 草稿不含有效五维时按「未提供」处理，采用草稿不清空已有评估
        bigFive: obj.bigFive !== undefined ? (normalizeBigFive(obj.bigFive) ?? undefined) : undefined,
        abilities: str(obj.abilities),
        backstory: str(obj.backstory),
        relationships:
          obj.relationships !== undefined
            ? normalizeRelationships(obj.relationships)
            : undefined,
        growthArc: str(obj.growthArc),
        arcStages: obj.arcStages !== undefined ? normalizeArcStages(obj.arcStages) : undefined,
      }
    } catch {
      // 尝试下一个候选
    }
  }
  return null
}

/**
 * 保存前清理阶段卡片链：normalizeArcStages 规整（剔非法项/截断/出场排他），
 * 空名兜底为「未命名阶段」（路由 schema 要求阶段名非空；
 * 表单里暂存的「未选属性」变化行（field 为空）在规整时被丢弃，不落库）
 */
function cleanArcStages(stages: ArcStage[]): ArcStage[] {
  return normalizeArcStages(stages).map((s) => ({
    ...s,
    name: s.name.slice(0, ARC_STAGE_NAME_MAX) || "未命名阶段",
    // schema 要求章节快照 label 非空；乱数据给空 label 时丢掉引用（避免整单 400）
    startChapter: s.startChapter && s.startChapter.label ? s.startChapter : null,
  }))
}

function CharacterFormEditor({
  novelId,
  character,
  allCharacters,
  tab,
  onTabChange,
  onSaved,
  onDeleted,
  onDirtyChange,
}: {
  novelId: string
  character: CharacterRecord
  allCharacters: CharacterRecord[]
  /** 子 Tab 受控：状态在上层 CharacterPanel（本组件按 id:version 重挂载，局部 state 会被重置） */
  tab: CharacterPanelTab
  onTabChange: (tab: CharacterPanelTab) => void
  onSaved: (version?: number) => void
  onDeleted: () => void
  onDirtyChange: (dirty: boolean) => void
}) {
  const closeTab = useTabsStore((s) => s.closeTab)
  const openTab = useTabsStore((s) => s.openTab)
  const queryClient = useQueryClient()
  const [form, renderForm] = useState<CharacterForm>(() => toForm(character))
  const formRef = useRef(form)
  const setForm = (next: CharacterForm) => {
    formRef.current = next
    onDirtyChange(true)
    renderForm(next)
  }
  const versionRef = useRef(character.version)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [assistOpen, setAssistOpen] = useState(false)
  const [instruction, setInstruction] = useState("")
  const [draft, setDraft] = useState<string | null>(null)

  /** 打开头像/立绘生成面板 tab */
  const openImagePanel = (kind: CharacterImageKind) =>
    openTab({
      id: buildTabId("character-image", novelId, { refId: character.id, imageKind: kind }),
      type: "character-image",
      novelId,
      refId: character.id,
      imageKind: kind,
      title: `${kind === "avatar" ? "头像" : "立绘"} · ${character.name}`,
    })

  const save = async (value: CharacterForm) => {
    const res = await apiSend<{
      character: CharacterRecord
      cascadeJobId: string | null
      cascadeAffectedCount: number
    }>(
      `/api/novels/${novelId}/characters/${character.id}`,
      "PATCH",
      {
        ...value,
        expectedVersion: versionRef.current,
        motivations: cleanMotivations(value.motivations),
        beliefs: cleanBeliefs(value.beliefs),
        arcStages: cleanArcStages(value.arcStages),
      },
      "保存角色失败"
    )
    versionRef.current = res.character.version
    onSaved(res.character.version)
    if (value === formRef.current) onDirtyChange(false)
    // 触发了级联修订：刷新侧边栏角标并提示跳转查看
    if (res.cascadeJobId) {
      queryClient.invalidateQueries({ queryKey: ["cascade", novelId] })
      toast.info(`内容已更新，检测到 ${res.cascadeAffectedCount} 处受影响内容待修订`, {
        duration: 10000,
        action: {
          label: "查看修订",
          onClick: () =>
            openTab({
              id: buildTabId("cascade", novelId),
              type: "cascade",
              novelId,
              title: "级联修订",
            }),
        },
      })
    }
  }

  const { status, schedule, saveNow } = useAutosave<CharacterForm>(save)

  const update = (patch: Partial<CharacterForm>) => {
    const next = { ...form, ...patch }
    setForm(next)
    if (next.name.trim()) schedule(next)
  }

  const deleteMutation = useMutation({
    mutationFn: () =>
      apiSend(
        `/api/novels/${novelId}/characters/${character.id}`,
        "DELETE",
        undefined,
        "删除失败"
      ),
    onSuccess: () => {
      closeTab(buildTabId("character", novelId, { refId: character.id }))
      toast.success("角色已删除")
      onDeleted()
    },
    onError: (err) => toast.error(err.message),
  })

  const assistMutation = useMutation({
    mutationFn: () =>
      apiSend<{ text: string }>(
        `/api/novels/${novelId}/characters/assist`,
        "POST",
        { roleType: form.roleType, instruction },
        "AI 生成失败"
      ),
    onSuccess: (data) => setDraft(data.text),
    onError: (err) => toast.error(err.message),
  })

  const adoptDraft = () => {
    if (!draft) return
    const parsed = parseCharacterDraft(draft)
    if (!parsed) {
      toast.error("AI 结果不是合法 JSON，请重试或手动整理")
      return
    }
    const cleaned = Object.fromEntries(
      Object.entries(parsed).filter(([, v]) => v !== undefined)
    ) as Partial<CharacterForm>
    const next = { ...form, ...cleaned }
    setForm(next)
    saveNow(next)
    setAssistOpen(false)
    setDraft(null)
    setInstruction("")
    toast.success("已填入 AI 生成的角色草稿")
  }

  /** 性格标签增删：离散操作，立即保存（与 roleType 下拉同款）；添加交互在 BubbleInput 内 */
  const changePersonalityTags = (tags: string[]) => {
    const next = { ...form, personalityTags: tags }
    setForm(next)
    if (next.name.trim()) saveNow(next)
  }

  /** 别名增删：离散操作，立即保存（与性格标签同款交互） */
  const changeAliases = (aliases: string[]) => {
    const next = { ...form, aliases }
    setForm(next)
    if (next.name.trim()) saveNow(next)
  }

  /** 五维拨动中：连续变更走防抖（每次 PATCH 都会 bump version 触发重挂载，拖动中不能立即保存） */
  const changeBigFive = (bigFive: BigFive) => {
    const next = { ...form, bigFive }
    setForm(next)
    if (next.name.trim()) schedule(next)
  }

  /** 五维松手/失焦：离散操作的落点，立即保存 */
  const commitBigFive = () => {
    if (form.name.trim()) saveNow()
  }

  const setBelief = (key: BeliefKey, text: string) =>
    update({ beliefs: { ...form.beliefs, [key]: text } })

  /** 核心动机编辑：immediate=true 的离散操作（下拉/删除/增层）立即保存，文本输入走防抖 */
  const changeMotivations = (layers: MotivationLayer[], immediate = false) => {
    const next = { ...form, motivations: layers }
    setForm(next)
    if (!next.name.trim()) return
    if (immediate) saveNow(next)
    else schedule(next)
  }

  /** 阶段卡片链编辑：文本输入走防抖；离散操作（增删/排序/出场/下拉选择）立即保存 */
  const changeArcStages = (arcStages: ArcStage[], immediate = false) => {
    const next = { ...form, arcStages }
    setForm(next)
    if (!next.name.trim()) return
    if (immediate) saveNow(next)
    else schedule(next)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-3 border-b px-6 py-3">
        <span className="text-sm font-medium text-muted-foreground">角色资料</span>
        <Badge variant="outline">v{character.version}</Badge>
        <SaveStatusIndicator status={status} />
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setDraft(null)
              setAssistOpen(true)
            }}
          >
            <Sparkles />
            AI 生成草稿
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="删除角色"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 className="text-muted-foreground" />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
        {/* @container：面板宽度由分栏拖拽决定，内部响应式断点跟随面板而非视口 */}
        <div className="@container mx-auto flex w-full max-w-6xl flex-col gap-6">
          {/* 板块子 Tab：吸顶，切换不触发保存 */}
          <div className="sticky top-0 z-10 border-b bg-background pt-4 pb-3">
            <Tabs value={tab} onValueChange={(v) => onTabChange(v as CharacterPanelTab)}>
              <TabsList>
                <TabsTrigger value="identity">身份 · 外在</TabsTrigger>
                <TabsTrigger value="psyche">心理</TabsTrigger>
                <TabsTrigger value="ability">能力</TabsTrigger>
                <TabsTrigger value="arc">弧线</TabsTrigger>
                <TabsTrigger value="relation">关系</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {tab === "identity" && (
            <>
              {/* 身份：资料卡（头像 + 姓名/类型 + 基本信息 + 别名 + 简介 + 人物描述）+ 独立大立绘 */}
              <div className="flex flex-col items-center gap-6 @3xl:flex-row @3xl:items-stretch">
                {/* 资料卡：大头像 + 身份信息（含人物描述） */}
                <div className="flex w-full min-w-0 flex-1 flex-col rounded-xl border bg-card/60 p-6">
                  <div className="flex flex-1 flex-col gap-6 @md:flex-row">
                    {/* 头像 */}
                    <div className="flex shrink-0 flex-col items-center justify-center gap-2">
                      <button
                        type="button"
                        onClick={() => openImagePanel("avatar")}
                        title="点击打开头像生成面板"
                        className="group relative size-40 overflow-hidden rounded-full border border-dashed bg-muted/40 transition-colors hover:border-primary/60"
                      >
                        {character.avatarUrl ? (
                          <CroppedImage
                            src={character.avatarUrl}
                            crop={normalizeCrop(character.avatarCrop)}
                            alt={`${character.name}头像`}
                          />
                        ) : (
                          <span className="flex h-full w-full flex-col items-center justify-center gap-1 text-muted-foreground">
                            <ImageIcon className="size-7" />
                            <span className="text-xs">点击生成</span>
                          </span>
                        )}
                        {character.avatarUrl && (
                          <span className="absolute inset-0 flex items-center justify-center bg-background/70 text-xs text-foreground opacity-0 transition-opacity group-hover:opacity-100">
                            编辑头像
                          </span>
                        )}
                      </button>
                      <span className="text-xs text-muted-foreground">头像</span>
                    </div>

                    {/* 身份信息 */}
                    <div className="flex min-w-0 flex-1 flex-col justify-center @md:pt-1">
                      <div className="flex flex-wrap items-center gap-3">
                        <Input
                          value={form.name}
                          onChange={(e) => update({ name: e.target.value })}
                          onBlur={() => form.name.trim() && saveNow()}
                          maxLength={50}
                          aria-label="姓名"
                          className="h-11 min-w-48 flex-1 text-2xl font-semibold"
                        />
                        <Select
                          value={form.roleType}
                          onValueChange={(v) => {
                            const next = { ...form, roleType: v as CharacterRoleType }
                            setForm(next)
                            saveNow(next)
                          }}
                        >
                          <SelectTrigger className="w-32 shrink-0" aria-label="角色类型">
                            <SelectValue>{CHARACTER_ROLE_LABELS[form.roleType]}</SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(CHARACTER_ROLE_LABELS).map(([value, label]) => (
                              <SelectItem key={value} value={value}>
                                {label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="mt-4 flex flex-wrap gap-4">
                        <div className="grid gap-1.5">
                          <Label className="text-xs text-muted-foreground">年龄</Label>
                          <Input
                            value={form.age}
                            onChange={(e) => update({ age: e.target.value })}
                            onBlur={() => saveNow()}
                            placeholder="如：十七岁"
                            className="w-28"
                          />
                        </div>
                        <div className="grid gap-1.5">
                          <Label className="text-xs text-muted-foreground">性别</Label>
                          <Input
                            value={form.gender}
                            onChange={(e) => update({ gender: e.target.value })}
                            onBlur={() => saveNow()}
                            placeholder="如：女"
                            className="w-28"
                          />
                        </div>
                        <div className="grid min-w-0 gap-1.5">
                          <Label className="text-xs text-muted-foreground">职业 / 身份</Label>
                          <Input
                            value={form.occupation}
                            onChange={(e) => update({ occupation: e.target.value })}
                            onBlur={() => saveNow()}
                            placeholder="如：外门弟子"
                            className="w-64 max-w-full"
                          />
                        </div>
                      </div>
                      {/* 别名/外号：与性格标签同款 chips 编辑（回车/blur 添加、× 删除、去重、限额） */}
                      <div className="mt-4 grid gap-1.5">
                        <Label className="text-xs text-muted-foreground">别名 / 外号</Label>
                        <BubbleInput
                          value={form.aliases}
                          onChange={changeAliases}
                          max={ALIASES_MAX}
                          itemMaxLength={ALIAS_MAX}
                          placeholder="输入后回车，如：老陈、沉默的大多数"
                          ariaLabel="别名"
                        />
                      </div>
                      {/* 角色简介：一句话故事线，卡片摘要与 hover 卡优先展示 */}
                      <div className="mt-4 grid gap-1.5">
                        <Label className="text-xs text-muted-foreground">角色简介</Label>
                        <Textarea
                          value={form.bio}
                          onChange={(e) => update({ bio: e.target.value })}
                          onBlur={() => saveNow()}
                          rows={2}
                          maxLength={300}
                          className="resize-none"
                          placeholder="一句话概括他的个人故事线：从哪来、正经历什么、要到哪去"
                        />
                      </div>
                      {/* 人物描述：归入身份信息区，与姓名/年龄/职业同组（纯性格短词见「心理」页的性格标签） */}
                      <div className="mt-4 grid gap-1.5">
                        <Label className="text-xs text-muted-foreground">人物描述</Label>
                        <Textarea
                          value={form.personality}
                          onChange={(e) => update({ personality: e.target.value })}
                          onBlur={() => saveNow()}
                          rows={3}
                          className="resize-none"
                          placeholder="这个角色总体上是怎样一个人：性格底色、行事风格、内在矛盾……"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* 立绘：独立大画框 */}
                <div className="flex shrink-0 flex-col items-center gap-2">
                  <button
                    type="button"
                    onClick={() => openImagePanel("portrait")}
                    title="点击打开立绘生成面板"
                    className="group relative h-96 w-64 overflow-hidden rounded-xl border border-dashed bg-muted/40 transition-colors hover:border-primary/60"
                  >
                    {character.portraitUrl ? (
                      <CroppedImage
                        src={character.portraitUrl}
                        crop={normalizeCrop(character.portraitCrop)}
                        alt={`${character.name}立绘`}
                      />
                    ) : (
                      <span className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted-foreground">
                        <ImageIcon className="size-8" />
                        <span className="text-sm">点击生成立绘</span>
                      </span>
                    )}
                    {character.portraitUrl && (
                      <span className="absolute inset-0 flex items-center justify-center bg-background/70 text-sm text-foreground opacity-0 transition-opacity group-hover:opacity-100">
                        编辑立绘
                      </span>
                    )}
                  </button>
                  <span className="text-xs text-muted-foreground">立绘</span>
                </div>
              </div>

              {/* 外在辨识度：基础生理四字段 + 外貌/穿着/品味/习惯/谈吐 */}
              <p className="text-xs text-muted-foreground">外在辨识度</p>
              <div className="grid grid-cols-1 gap-3 @sm:grid-cols-2">
                <FieldCard label="身高">
                  <Input
                    value={form.height}
                    onChange={(e) => update({ height: e.target.value })}
                    onBlur={() => saveNow()}
                    maxLength={50}
                    placeholder="如 183cm"
                  />
                </FieldCard>
                <FieldCard label="体重">
                  <Input
                    value={form.weight}
                    onChange={(e) => update({ weight: e.target.value })}
                    onBlur={() => saveNow()}
                    maxLength={50}
                    placeholder="如 74kg"
                  />
                </FieldCard>
                <FieldCard label="身材">
                  <Input
                    value={form.build}
                    onChange={(e) => update({ build: e.target.value })}
                    onBlur={() => saveNow()}
                    maxLength={50}
                    placeholder="如 瘦削结实"
                  />
                </FieldCard>
                <FieldCard label="脸型">
                  <Input
                    value={form.faceShape}
                    onChange={(e) => update({ faceShape: e.target.value })}
                    onBlur={() => saveNow()}
                    maxLength={50}
                    placeholder="如 瘦长有棱角"
                  />
                </FieldCard>
              </div>
              <div className="grid grid-cols-1 gap-3">
                <FieldCard label="外貌身形">
                  <Textarea
                    value={form.appearance}
                    onChange={(e) => update({ appearance: e.target.value })}
                    onBlur={() => saveNow()}
                    rows={3}
                    className="resize-none"
                    placeholder="身高/体重/脸型/身材/标志性特征……"
                  />
                </FieldCard>
                <FieldCard label="穿衣风格">
                  <Textarea
                    value={form.clothing}
                    onChange={(e) => update({ clothing: e.target.value })}
                    onBlur={() => saveNow()}
                    rows={3}
                    className="resize-none"
                    placeholder="具体穿着饰品 + 抽象风格，衣服会换但风格一致"
                  />
                </FieldCard>
                <FieldCard label="品味偏好">
                  <Textarea
                    value={form.tastes}
                    onChange={(e) => update({ tastes: e.target.value })}
                    onBlur={() => saveNow()}
                    rows={2}
                    className="resize-none"
                    placeholder="饮食/器物/审美等偏好，如：爱喝苦茶、收集旧怀表"
                  />
                </FieldCard>
                <FieldCard label="行为习惯">
                  <Textarea
                    value={form.habits}
                    onChange={(e) => update({ habits: e.target.value })}
                    onBlur={() => saveNow()}
                    rows={2}
                    className="resize-none"
                    placeholder="体态与应激小动作，如思考时捏头发、紧张时抬镜框、走路外八"
                  />
                </FieldCard>
                <FieldCard label="口头禅">
                  <Textarea
                    value={form.catchphrase}
                    onChange={(e) => update({ catchphrase: e.target.value })}
                    onBlur={() => saveNow()}
                    rows={1}
                    className="min-h-9 resize-none"
                  />
                </FieldCard>
                <FieldCard label="对话风格">
                  <Textarea
                    value={form.dialogueStyle}
                    onChange={(e) => update({ dialogueStyle: e.target.value })}
                    onBlur={() => saveNow()}
                    rows={2}
                    className="resize-none"
                    placeholder="语速/句式/用词倾向，如短句冷峻、爱反问"
                  />
                </FieldCard>
                <FieldCard label="示例对话">
                  <Textarea
                    value={form.sampleDialogue}
                    onChange={(e) => update({ sampleDialogue: e.target.value })}
                    onBlur={() => saveNow()}
                    rows={3}
                    className="resize-none"
                    placeholder="2~4 句代表台词"
                  />
                </FieldCard>
              </div>
            </>
          )}

          {tab === "psyche" && (
            /* 心理：核心动机 / 核心欲望 / 核心恐惧 / 观念 / 性格五维 / 性格标签 */
            <div className="grid grid-cols-1 gap-3">
              <FieldCard label="核心动机">
                <MotivationsEditor
                  value={form.motivations}
                  onChange={changeMotivations}
                  onBlurSave={() => saveNow()}
                />
              </FieldCard>
              <FieldCard label="核心欲望">
                <Textarea
                  value={form.desires}
                  onChange={(e) => update({ desires: e.target.value })}
                  onBlur={() => saveNow()}
                  rows={2}
                  className="resize-none"
                  placeholder="无原因、发自内心/本能的长期想要；他容易被什么吸引"
                />
              </FieldCard>
              <FieldCard label="核心恐惧">
                <Textarea
                  value={form.fears}
                  onChange={(e) => update({ fears: e.target.value })}
                  onBlur={() => saveNow()}
                  rows={2}
                  className="resize-none"
                  placeholder="最害怕失去/面对什么……"
                />
              </FieldCard>
              <FieldCard label="观念">
                <BeliefsFields
                  value={form.beliefs}
                  onChange={setBelief}
                  onBlurSave={() => saveNow()}
                />
              </FieldCard>
              <FieldCard label="性格五维">
                <BigFiveSlider
                  value={form.bigFive}
                  onChange={changeBigFive}
                  onCommit={commitBigFive}
                />
              </FieldCard>
              <FieldCard label="性格标签">
                <BubbleInput
                  value={form.personalityTags}
                  onChange={changePersonalityTags}
                  max={PERSONALITY_TAGS_MAX}
                  itemMaxLength={PERSONALITY_TAG_MAX}
                  placeholder="输入后回车，如：内向、腼腆、INTP"
                  ariaLabel="性格标签"
                  variant="bare"
                />
              </FieldCard>
            </div>
          )}

          {tab === "ability" && (
            /* 能力：能力总述 + 数值化自定义属性 */
            <>
              <div className="grid grid-cols-1 gap-3">
                <FieldCard label="能力总述">
                  <Textarea
                    value={form.abilities}
                    onChange={(e) => update({ abilities: e.target.value })}
                    onBlur={() => saveNow()}
                    rows={3}
                    className="resize-none"
                    placeholder="角色自身的本事：基本能力与这个世界里的特殊能力；力量体系规则本身在设定里维护"
                  />
                </FieldCard>
              </div>
              <p className="text-xs text-muted-foreground">
                数值化属性（如力量 8、智力 9）用自定义属性维护
              </p>
              <EntityAttributesEditor
                novelId={novelId}
                target="CHARACTER"
                variant="grid"
                value={form.attributes}
                onChange={(attributes) => update({ attributes })}
                onBlurSave={() => saveNow()}
              />
            </>
          )}

          {tab === "arc" && (
            /* 弧线：阶段卡片链（arcStages 非空）/ 空态 + 建卡入口（为空时），drill-down 在 ArcTab 内 */
            <ArcTab
              novelId={novelId}
              arcStages={form.arcStages}
              backstory={form.backstory}
              growthArc={form.growthArc}
              selfId={character.id}
              selfName={character.name}
              allCharacters={allCharacters}
              onArcStagesChange={changeArcStages}
              onBlurSave={() => saveNow()}
            />
          )}

          {tab === "relation" && (
            /* 关系：可输入可下拉的关系对象 + 反查「TA 们与我的关系」 */
            <RelationshipsEditor
              value={form.relationships}
              onChange={(relationships) => update({ relationships })}
              onBlurSave={() => saveNow()}
              selfId={character.id}
              selfName={character.name}
              allCharacters={allCharacters}
            />
          )}
        </div>
      </div>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除角色</DialogTitle>
            <DialogDescription>
              确定要删除角色「{character.name}」吗？该操作不可撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate()}
            >
              {deleteMutation.isPending && <Loader2 className="animate-spin" />}
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={assistOpen}
        onOpenChange={(open) => {
          setAssistOpen(open)
          if (!open) {
            setDraft(null)
            assistMutation.reset()
          }
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>AI 生成角色草稿</DialogTitle>
            <DialogDescription>
              基于主题与已有角色生成「{CHARACTER_ROLE_LABELS[form.roleType]}」草稿，预览确认后填入表单。
            </DialogDescription>
          </DialogHeader>
          {draft === null ? (
            <div className="flex flex-col gap-3">
              <Textarea
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                placeholder="补充你的想法（可选），如：想要一个外冷内热的师姐"
                rows={3}
              />
              <DialogFooter>
                <Button
                  disabled={assistMutation.isPending}
                  onClick={() => assistMutation.mutate()}
                >
                  {assistMutation.isPending && <Loader2 className="animate-spin" />}
                  生成
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="flex min-h-0 flex-col gap-3">
              <div className="max-h-80 overflow-y-auto rounded-lg bg-muted/60 p-3 text-sm whitespace-pre-wrap">
                {draft}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDraft(null)}>
                  返回修改
                </Button>
                <Button onClick={adoptDraft}>采用</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** 角色详情编辑（type=character，refId=角色 id）：完整表单 + 自动保存 */
export function CharacterPanel({ novelId, refId }: ContentPanelProps) {
  const queryClient = useQueryClient()
  const ownSaves = useOwnSyncTokens<number>()
  const [dirty, setDirty] = useState(false)
  // 子 Tab 状态按内容 tab id 记入 tabs store 而不是留在组件内：
  // 编辑器按 `id:version` 重挂载（保存后 version+1），三阶段撤销/落库还会经
  // StagedSaveSurface 的 revertNonce 重挂载整个面板——存组件 state 都会跳回默认 tab。
  const tabId = buildTabId("character", novelId, { refId })
  const storedTab = useTabsStore((s) => s.subTabs[tabId])
  const setSubTab = useTabsStore((s) => s.setSubTab)
  const tab: CharacterPanelTab = CHARACTER_PANEL_TABS.includes(storedTab as CharacterPanelTab)
    ? (storedTab as CharacterPanelTab)
    : "identity"

  const { data, isLoading, isError } = useQuery({
    queryKey: ["characters", novelId],
    queryFn: () =>
      apiGet<{ characters: CharacterRecord[] }>(
        `/api/novels/${novelId}/characters`,
        "加载角色失败"
      ),
  })

  const version = data?.characters.find(c => c.id === refId)?.version ?? 0
  const syncKey = useExternalSyncKey(version, ownSaves.isOwn, dirty)
  const invalidate = (savedVersion?: number) => {
    if (savedVersion !== undefined) ownSaves.track(savedVersion)
    queryClient.invalidateQueries({ queryKey: ["characters", novelId] })
    queryClient.invalidateQueries({ queryKey: ["novels"] })
    queryClient.invalidateQueries({ queryKey: ["novels", novelId] })
  }

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
        角色加载失败，请稍后重试
      </div>
    )
  }

  const characters = data?.characters ?? []
  const character = characters.find((c) => c.id === refId)
  if (!character) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        角色不存在或已被删除
      </div>
    )
  }

  return (
    <CharacterFormEditor
      key={`${character.id}:${syncKey}`}
      novelId={novelId}
      character={character}
      allCharacters={characters}
      tab={tab}
      onTabChange={(t) => setSubTab(tabId, t)}
      onSaved={invalidate}
      onDeleted={invalidate}
      onDirtyChange={setDirty}
    />
  )
}
