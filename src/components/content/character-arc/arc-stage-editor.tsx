"use client"

/**
 * 阶段编辑视图（面板内 drill-down，不开新 tab）：返回 + 面包屑（弧线 / 阶段名）、
 * 阶段名称、阶段定位（气泡输入）、起始章节（卷→章两级 Select，可清除，失效给快照兜底）、
 * 属性变化（四板块分组）、阶段描述（自适应）、标签、出场 checkbox（排他）、危险区删除。
 * 所有编辑经 onChange 回写 form.arcStages，由面板统一走防抖/立即自动保存；
 * 出场勾选为全链排他（勾选时清掉其他卡片的 isDebut）。
 */
import { useState } from "react"
import { ArrowLeft, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
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
import {
  ARC_STAGE_CHAPTER_LABEL_MAX,
  ARC_STAGE_DESCRIPTION_MAX,
  ARC_STAGE_NAME_MAX,
  ARC_STAGE_TAGS_MAX,
  ARC_STAGE_TAG_MAX,
  type ArcStage,
  type ArcStageChapterRef,
} from "@/lib/arc-stage"

import { BubbleInput } from "../BubbleInput"
import type { CharacterRecord } from "../types"
import { ArcChangeEditor } from "./arc-change-editor"
import { resolveStageChapter, useOutlineVolumes } from "./arc-chain"
import { ArcMarkerInput } from "./arc-marker-input"

/**
 * 起始章节选择器：卷 → 章两级联动（数据来自大纲缓存）。
 * 仅选卷不提交（schema 要求 chapterId 非空），章选定后才写入完整 { chapterId, volumeId, label 快照 }；
 * 已失效引用显示快照 + 失效提示，可重选或清除；无大纲禁用。
 */
function ChapterPicker({
  novelId,
  value,
  onChange,
}: {
  novelId: string
  value: ArcStageChapterRef | null
  onChange: (next: ArcStageChapterRef | null) => void
}) {
  const { data, isLoading } = useOutlineVolumes(novelId)
  const volumes = data?.volumes ?? []
  const hasOutline = volumes.length > 0
  /** 仅选卷时的暂存卷 id（章选定提交后清空，选择器回到按 value 推导） */
  const [pendingVolumeId, setPendingVolumeId] = useState<string | null>(null)

  const resolved = value && data ? resolveStageChapter(value, volumes) : null
  const broken = !!(value && resolved?.broken)

  const currentVolumeId =
    pendingVolumeId ?? (resolved && !resolved.broken ? value?.volumeId : null) ?? null
  const currentVolume = volumes.find((v) => v.id === currentVolumeId) ?? null
  const chapterValue =
    value && currentVolume && currentVolume.chapters.some((c) => c.id === value.chapterId)
      ? value.chapterId
      : null

  const pickChapter = (chapterId: string) => {
    const chapter = currentVolume?.chapters.find((c) => c.id === chapterId)
    if (!currentVolume || !chapter) return
    onChange({
      chapterId: chapter.id,
      volumeId: currentVolume.id,
      label: `第${currentVolume.index}卷 ${currentVolume.title} · 第${chapter.index}章 ${chapter.title}`.slice(
        0,
        ARC_STAGE_CHAPTER_LABEL_MAX
      ),
    })
    setPendingVolumeId(null)
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={currentVolume?.id ?? null}
          disabled={!hasOutline}
          onValueChange={(v) => {
            if (v) setPendingVolumeId(v)
          }}
        >
          <SelectTrigger className="w-44" aria-label="选择卷">
            <SelectValue placeholder="选择卷…" />
          </SelectTrigger>
          <SelectContent>
            {volumes.map((v) => (
              <SelectItem key={v.id} value={v.id}>
                第{v.index}卷 {v.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={chapterValue}
          disabled={!hasOutline || !currentVolume}
          onValueChange={(v) => {
            if (v) pickChapter(v)
          }}
        >
          <SelectTrigger className="w-56" aria-label="选择章">
            <SelectValue placeholder={currentVolume ? "选择章…" : "先选卷"} />
          </SelectTrigger>
          <SelectContent>
            {(currentVolume?.chapters ?? []).map((c) => (
              <SelectItem key={c.id} value={c.id}>
                第{c.index}章 {c.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {value && (
          <button
            type="button"
            className="text-xs text-muted-foreground underline underline-offset-4 hover:text-destructive"
            onClick={() => {
              onChange(null)
              setPendingVolumeId(null)
            }}
          >
            清除
          </button>
        )}
      </div>
      {broken && value && (
        <p className="text-xs text-destructive">
          原设定「<span className="line-through">{value.label}</span>」的章节在大纲中已失效，请重新选择或清除。
        </p>
      )}
      {!isLoading && !hasOutline && (
        <p className="text-xs text-muted-foreground">尚无大纲，生成大纲后可选择起始章节。</p>
      )}
    </div>
  )
}

export function ArcStageEditor({
  novelId,
  stage,
  stages,
  selfId,
  selfName,
  allCharacters,
  onChange,
  onBlurSave,
  onBack,
}: {
  novelId: string
  stage: ArcStage
  stages: ArcStage[]
  /** 本角色 id / 姓名：「人物关系」变化控件的候选与链接用 */
  selfId: string
  selfName: string
  allCharacters: CharacterRecord[]
  onChange: (stages: ArcStage[], immediate?: boolean) => void
  onBlurSave: () => void
  onBack: () => void
}) {
  const patchStage = (patch: Partial<ArcStage>, immediate = false) =>
    onChange(
      stages.map((s) => (s.id === stage.id ? { ...s, ...patch } : s)),
      immediate
    )

  /** 出场排他：勾选本卡时清掉其他卡片的 isDebut */
  const setDebut = (checked: boolean) =>
    onChange(
      stages.map((s) => ({ ...s, isDebut: s.id === stage.id ? checked : false })),
      true
    )

  const removeStage = () => {
    if (!window.confirm(`删除阶段「${stage.name}」？此操作不可撤销。`)) return
    onChange(
      stages.filter((s) => s.id !== stage.id),
      true
    )
    onBack()
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex min-w-0 items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onBack}>
          <ArrowLeft />
          返回
        </Button>
        <nav
          aria-label="阶段路径"
          className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground"
        >
          <button
            type="button"
            className="shrink-0 hover:text-foreground hover:underline"
            onClick={onBack}
          >
            弧线
          </button>
          <span className="opacity-50">/</span>
          <span className="truncate font-medium text-foreground">
            {stage.name || "未命名阶段"}
          </span>
        </nav>
      </div>

      <div className="grid gap-1.5">
        <Label>阶段名称</Label>
        <Input
          value={stage.name}
          maxLength={ARC_STAGE_NAME_MAX}
          onChange={(e) => patchStage({ name: e.target.value })}
          onBlur={onBlurSave}
          placeholder="如：废柴少年、面板觉醒"
          className="font-semibold"
        />
      </div>

      <div className="grid gap-1.5">
        <Label>阶段定位</Label>
        <ArcMarkerInput
          value={stage.markers}
          onChange={(markers) => patchStage({ markers }, true)}
        />
        <p className="text-xs text-muted-foreground">
          一个条件一枚气泡，可多条组合（如「16 岁 ＋ 练气一层 ＋ 父母被陷害后」），需与其他阶段有足够区分度；类别可选
          年龄 / 事件 / 自定义（自定义不显示前缀），回车/逗号添加，× 或退格删除。
        </p>
      </div>

      <div className="grid gap-1.5">
        <Label>起始章节（可选）</Label>
        <ChapterPicker
          novelId={novelId}
          value={stage.startChapter}
          onChange={(startChapter) => patchStage({ startChapter }, true)}
        />
        <p className="text-xs text-muted-foreground">
          角色从哪一卷哪一章开始进入此阶段；不选表示未指定。
        </p>
      </div>

      <div className="grid gap-1.5">
        <Label>属性变化</Label>
        <ArcChangeEditor
          novelId={novelId}
          changes={stage.changes}
          onChanges={(changes, immediate) => patchStage({ changes }, immediate)}
          selfId={selfId}
          selfName={selfName}
          allCharacters={allCharacters}
          onBlurSave={onBlurSave}
        />
        <p className="text-xs text-muted-foreground">
          按角色资料的板块分组，只记录此阶段发生变化的属性；每组只能选本板块中存在的属性，值即此阶段该属性的新状态。
        </p>
      </div>

      <div className="grid gap-1.5">
        <Label>阶段描述</Label>
        <Textarea
          value={stage.description}
          maxLength={ARC_STAGE_DESCRIPTION_MAX}
          onChange={(e) => patchStage({ description: e.target.value })}
          onBlur={onBlurSave}
          rows={3}
          className="resize-none"
          placeholder="角色在此阶段的主要特征变化……"
        />
      </div>

      <div className="grid gap-1.5">
        <Label>标签</Label>
        <BubbleInput
          value={stage.tags}
          onChange={(tags) => patchStage({ tags }, true)}
          onBlur={onBlurSave}
          max={ARC_STAGE_TAGS_MAX}
          itemMaxLength={ARC_STAGE_TAG_MAX}
          placeholder="回车添加，如：转折 / 低谷 / 高光"
          ariaLabel="标签"
        />
      </div>

      <div className="grid gap-1.5">
        <Label>出场</Label>
        <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border bg-muted/45 px-3 py-2.5 dark:bg-accent/60">
          <input
            type="checkbox"
            checked={stage.isDebut}
            onChange={(e) => setDebut(e.target.checked)}
            className="mt-0.5 grid size-[17px] shrink-0 cursor-pointer appearance-none place-content-center rounded-[5px] border-[1.5px] border-input bg-transparent checked:border-primary checked:bg-primary checked:before:text-xs checked:before:leading-none checked:before:text-primary-foreground checked:before:content-['✓']"
          />
          <span>
            <span className="block text-[13.5px] font-medium">此阶段为首次出场</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              勾选后，此阶段之前的卡片自动视为出场前经历；全链最多一张出场卡。
            </span>
          </span>
        </label>
      </div>

      <div className="flex justify-end border-t border-border pt-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="text-destructive hover:text-destructive"
          onClick={removeStage}
        >
          <Trash2 />
          删除该阶段
        </Button>
      </div>
    </div>
  )
}
