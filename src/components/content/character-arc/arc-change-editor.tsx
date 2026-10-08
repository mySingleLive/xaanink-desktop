"use client"

/**
 * 阶段「属性变化」编辑器：按角色资料板块分组（身份·外在 / 心理 / 能力 / 关系，
 * 词表 PROFILE_FIELD_SECTIONS），每组「＋ 添加属性变化」的属性下拉仅含本板块字段；
 * 录入控件按字段 kind 分发到与角色资料面板一致的共享控件（text→Input、textarea→自适应
 * Textarea、tags→BubbleInput、bigfive→BigFiveSlider、beliefs→BeliefsFields、
 * motivations→MotivationsEditor、relationships→RelationshipsEditor、attributes→
 * EntityAttributesEditor）；非 text 控件整行换行（flex-wrap + basis-full），× 移除。
 * 变更经 onChanges 上抛（immediate=false 防抖 / true 立即保存），未选属性的暂存行
 * （field 为空）在保存前清理时被丢弃，不落库。
 */
import { Plus, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import {
  ARC_STAGE_CHANGES_MAX,
  PROFILE_FIELD_SECTIONS,
  profileFieldDef,
  type ArcStageChange,
  type ArcStageSection,
  type ProfileFieldDef,
  type ProfileFieldKind,
} from "@/lib/arc-stage"
import { BIG_FIVE_NEUTRAL } from "@/lib/big-five"
import { cn } from "@/lib/utils"

import { BubbleInput } from "../BubbleInput"
import {
  BeliefsFields,
  BigFiveSlider,
  MotivationsEditor,
  RelationshipsEditor,
} from "../character-fields"
import { EntityAttributesEditor } from "../EntityAttributesEditor"
import type {
  BeliefKey,
  Beliefs,
  BigFive,
  CharacterRecord,
  EntityAttributeItem,
  MotivationLayer,
  RelationshipItem,
} from "../types"

/** 选定属性后的初始值：与字段本体同构的空态（五维取中值，其余空串/空数组/空对象） */
function defaultChangeValue(kind: ProfileFieldKind): unknown {
  switch (kind) {
    case "tags":
      return []
    case "bigfive":
      return {
        openness: BIG_FIVE_NEUTRAL,
        conscientiousness: BIG_FIVE_NEUTRAL,
        extraversion: BIG_FIVE_NEUTRAL,
        agreeableness: BIG_FIVE_NEUTRAL,
        neuroticism: BIG_FIVE_NEUTRAL,
      }
    case "beliefs":
      return {}
    case "motivations":
    case "relationships":
    case "attributes":
      return []
    default:
      return ""
  }
}

/** 单条变化的值录入控件：按字段 kind 分发到共享控件（与角色资料面板同控件同交互） */
function ChangeValueControl({
  novelId,
  change,
  def,
  onValue,
  onBlurSave,
  selfId,
  selfName,
  allCharacters,
}: {
  novelId: string
  change: ArcStageChange
  def: ProfileFieldDef | null
  onValue: (value: unknown, immediate?: boolean) => void
  onBlurSave: () => void
  selfId: string
  selfName: string
  allCharacters: CharacterRecord[]
}) {
  if (!def) {
    return <p className="py-1.5 text-xs text-muted-foreground/70">先选择属性</p>
  }
  switch (def.kind) {
    case "text":
      return (
        <Input
          value={(change.value as string) ?? ""}
          maxLength={200}
          onChange={(e) => onValue(e.target.value)}
          onBlur={onBlurSave}
          placeholder="此阶段的新值"
        />
      )
    case "textarea":
      return (
        <Textarea
          value={(change.value as string) ?? ""}
          maxLength={2000}
          rows={2}
          className="resize-none"
          onChange={(e) => onValue(e.target.value)}
          onBlur={onBlurSave}
          placeholder="此阶段的新值"
        />
      )
    case "tags":
      return (
        <BubbleInput
          value={(change.value as string[]) ?? []}
          onChange={(tags) => onValue(tags, true)}
          onBlur={onBlurSave}
          max={12}
          itemMaxLength={30}
          placeholder="输入后回车添加"
          ariaLabel={def.label}
        />
      )
    case "bigfive":
      return (
        <BigFiveSlider
          value={(change.value as BigFive) ?? null}
          onChange={(next) => onValue(next)}
          onCommit={onBlurSave}
        />
      )
    case "beliefs":
      return (
        <BeliefsFields
          value={(change.value as Beliefs) ?? {}}
          onChange={(key: BeliefKey, text: string) =>
            onValue({ ...((change.value as Beliefs) ?? {}), [key]: text })
          }
          onBlurSave={onBlurSave}
        />
      )
    case "motivations":
      return (
        <MotivationsEditor
          value={(change.value as MotivationLayer[]) ?? []}
          onChange={(layers, immediate) => onValue(layers, immediate)}
          onBlurSave={onBlurSave}
        />
      )
    case "relationships":
      // 阶段快照语境只编辑「此阶段的关系状态」，不展示按当前资料反查的 inbound 块
      return (
        <RelationshipsEditor
          value={(change.value as RelationshipItem[]) ?? []}
          onChange={(rels) => onValue(rels)}
          onBlurSave={onBlurSave}
          selfId={selfId}
          selfName={selfName}
          allCharacters={allCharacters}
          showInbound={false}
        />
      )
    case "attributes":
      return (
        <EntityAttributesEditor
          novelId={novelId}
          target="CHARACTER"
          variant="stack"
          value={(change.value as EntityAttributeItem[]) ?? []}
          onChange={(attrs) => onValue(attrs)}
          onBlurSave={onBlurSave}
        />
      )
  }
}

export function ArcChangeEditor({
  novelId,
  changes,
  onChanges,
  selfId,
  selfName,
  allCharacters,
  onBlurSave,
}: {
  novelId: string
  changes: ArcStageChange[]
  onChanges: (changes: ArcStageChange[], immediate?: boolean) => void
  /** 本角色 id / 姓名：relationships 控件的对象候选与链接用 */
  selfId: string
  selfName: string
  allCharacters: CharacterRecord[]
  onBlurSave: () => void
}) {
  const setValueAt = (i: number, value: unknown, immediate = false) =>
    onChanges(
      changes.map((c, j) => (j === i ? { ...c, value } : c)),
      immediate
    )

  const removeAt = (i: number) =>
    onChanges(
      changes.filter((_, j) => j !== i),
      true
    )

  const addTo = (section: ArcStageSection) =>
    onChanges([...changes, { section, field: "", value: "" }], true)

  const changeField = (i: number, section: ArcStageSection, field: string) => {
    const def = profileFieldDef(section, field)
    onChanges(
      changes.map((c, j) =>
        j === i ? { ...c, field, value: def ? defaultChangeValue(def.kind) : "" } : c
      ),
      true
    )
  }

  return (
    <div className="flex flex-col gap-2.5">
      {PROFILE_FIELD_SECTIONS.map((section) => {
        const rows = changes
          .map((c, i) => ({ c, i }))
          .filter(({ c }) => c.section === section.key)
        return (
          <div
            key={section.key}
            className="flex flex-col gap-2 rounded-lg border border-border bg-muted/45 p-2.5 dark:bg-accent/60"
          >
            <span className="text-xs font-medium tracking-wide text-muted-foreground">
              {section.label}
            </span>
            {rows.length === 0 && (
              <p className="pl-0.5 text-xs text-muted-foreground/70">暂无，没变化的不添加</p>
            )}
            {rows.map(({ c, i }) => {
              const def = c.field ? profileFieldDef(c.section, c.field) : null
              // 非 text 控件（多行/滑杆/分层等）整行换行
              const wide = !def || def.kind !== "text"
              return (
                <div key={i} className="flex flex-wrap items-start gap-2">
                  <Select
                    value={c.field || null}
                    items={section.fields.map((field) => ({ value: field.key, label: field.label }))}
                    onValueChange={(f) => f && changeField(i, c.section, f)}
                  >
                    <SelectTrigger className="w-32 shrink-0" aria-label="选择属性">
                      <SelectValue placeholder="选择属性…" />
                    </SelectTrigger>
                    <SelectContent>
                      {section.fields.map((f) => (
                        <SelectItem key={f.key} value={f.key}>
                          {f.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className={cn("min-w-0", wide ? "basis-full" : "min-w-40 flex-1")}>
                    <ChangeValueControl
                      novelId={novelId}
                      change={c}
                      def={def}
                      onValue={(value, immediate) => setValueAt(i, value, immediate)}
                      onBlurSave={onBlurSave}
                      selfId={selfId}
                      selfName={selfName}
                      allCharacters={allCharacters}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label="移除该变化"
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => removeAt(i)}
                  >
                    <X />
                  </Button>
                </div>
              )
            })}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start border-dashed text-muted-foreground"
              disabled={changes.length >= ARC_STAGE_CHANGES_MAX}
              onClick={() => addTo(section.key)}
            >
              <Plus />
              添加属性变化
            </Button>
          </div>
        )
      })}
    </div>
  )
}
