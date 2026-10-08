"use client"

/**
 * 角色资料字段编辑控件（CharacterPanel 与角色弧线阶段编辑器共用）。
 * 抽取自 CharacterPanel 内联实现（纯搬移，行为不变）：
 * BigFiveSlider（性格五维滑杆）、BeliefsFields（观念四项）、MotivationsEditor（核心动机分层）、
 * RelationshipsEditor（人物关系行 + 「TA 们与我的关系」反查）、FieldCard（字段卡片容器）。
 * 所有控件只通过 onChange/onBlurSave 上抛变更，由调用方并入表单状态并走统一自动保存。
 */
import { useId } from "react"
import { Plus, Trash2 } from "lucide-react"

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
import { MOTIVATION_IMPORTANCE_DEFAULT, motivationLayerLabel } from "@/lib/motivation"

import {
  BELIEF_KEYS,
  BIG_FIVE_DIMENSIONS,
  BIG_FIVE_NEUTRAL,
  normalizeRelationships,
  type BeliefKey,
  type Beliefs,
  type BigFive,
  type CharacterRecord,
  type MotivationLayer,
  type RelationshipItem,
} from "./types"

/** 属性网格中的内置字段卡片：与自定义属性卡片同款外观，保证「一视同仁」 */
export function FieldCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card/60 px-3 py-2">
      <span className="block truncate text-xs font-medium text-muted-foreground">
        {label}
      </span>
      <div className="mt-1.5">{children}</div>
    </div>
  )
}

/** 未评估时滑杆的展示值（全部中值；首次拨动即以它为底构造完整五维落库） */
const BIG_FIVE_UNSET: BigFive = {
  openness: BIG_FIVE_NEUTRAL,
  conscientiousness: BIG_FIVE_NEUTRAL,
  extraversion: BIG_FIVE_NEUTRAL,
  agreeableness: BIG_FIVE_NEUTRAL,
  neuroticism: BIG_FIVE_NEUTRAL,
}

/**
 * 性格五维滑杆：null（未评估）时整体 muted、滑杆停在中值；
 * 拖动中连续 onChange（父组件走防抖保存），松手/失焦 onCommit 立即保存。
 */
export function BigFiveSlider({
  value,
  onChange,
  onCommit,
}: {
  value: BigFive | null
  onChange: (next: BigFive) => void
  onCommit: () => void
}) {
  return (
    <div className="flex flex-col gap-2">
      {value === null && (
        <p className="text-xs text-muted-foreground">未评估（拨动滑杆即设定）</p>
      )}
      <div className={value === null ? "flex flex-col gap-2 opacity-60" : "flex flex-col gap-2"}>
        {BIG_FIVE_DIMENSIONS.map(({ key, label, low, high }) => (
          <div key={key} className="flex items-center gap-2">
            <span className="w-14 shrink-0 text-xs text-muted-foreground">{label}</span>
            <span className="@sm:inline hidden w-16 shrink-0 text-right text-[11px] text-muted-foreground/70">
              {low}
            </span>
            <input
              type="range"
              min={0}
              max={100}
              value={value?.[key] ?? BIG_FIVE_NEUTRAL}
              aria-label={`${label}（${low} ~ ${high}）`}
              onChange={(e) =>
                onChange({ ...(value ?? BIG_FIVE_UNSET), [key]: Number(e.target.value) })
              }
              onPointerUp={onCommit}
              onBlur={onCommit}
              className="h-1.5 min-w-16 flex-1 cursor-pointer accent-primary"
            />
            <span className="@sm:inline hidden w-16 shrink-0 text-[11px] text-muted-foreground/70">
              {high}
            </span>
            <span className="w-9 shrink-0 rounded bg-muted/60 px-1 py-0.5 text-center font-mono text-[11px] text-muted-foreground">
              {value?.[key] ?? BIG_FIVE_NEUTRAL}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** 观念四项（世界观/价值观/人生观/其他）：每项一个自适应多行框 */
export function BeliefsFields({
  value,
  onChange,
  onBlurSave,
}: {
  value: Beliefs
  onChange: (key: BeliefKey, text: string) => void
  onBlurSave: () => void
}) {
  return (
    <div className="grid gap-3">
      {BELIEF_KEYS.map(({ key, label, placeholder }) => (
        <div key={key} className="grid gap-1">
          <Label className="text-xs text-muted-foreground">{label}</Label>
          <Textarea
            value={value[key] ?? ""}
            onChange={(e) => onChange(key, e.target.value)}
            onBlur={onBlurSave}
            rows={2}
            className="resize-none"
            placeholder={placeholder}
          />
        </div>
      ))}
    </div>
  )
}

/**
 * 核心动机分层编辑：层（表面 → 根本）× 同层多条，每条带重要性下拉。
 * onChange 的 immediate 标记离散操作（下拉/删除/增层）由调用方立即保存，文本输入走防抖。
 */
export function MotivationsEditor({
  value,
  onChange,
  onBlurSave,
}: {
  value: MotivationLayer[]
  onChange: (layers: MotivationLayer[], immediate?: boolean) => void
  onBlurSave: () => void
}) {
  const setText = (li: number, ii: number, text: string) =>
    onChange(
      value.map((l, j) =>
        j === li ? { items: l.items.map((m, k) => (k === ii ? { ...m, text } : m)) } : l
      )
    )

  const setImportance = (li: number, ii: number, importance: number) =>
    onChange(
      value.map((l, j) =>
        j === li ? { items: l.items.map((m, k) => (k === ii ? { ...m, importance } : m)) } : l
      ),
      true
    )

  const addItem = (li: number) =>
    onChange(
      value.map((l, j) =>
        j === li
          ? { items: [...l.items, { text: "", importance: MOTIVATION_IMPORTANCE_DEFAULT }] }
          : l
      )
    )

  const removeItem = (li: number, ii: number) =>
    onChange(
      value.flatMap((l, j) => {
        if (j !== li) return [l]
        const items = l.items.filter((_, k) => k !== ii)
        return items.length > 0 ? [{ items }] : []
      }),
      true
    )

  const addLayer = () =>
    onChange([...value, { items: [{ text: "", importance: MOTIVATION_IMPORTANCE_DEFAULT }] }])

  const removeLayer = (li: number) =>
    onChange(
      value.filter((_, j) => j !== li),
      true
    )

  /** 动机条目 placeholder：多层时首层问表面、末层问根本 */
  const placeholder = (li: number) => {
    const total = value.length
    if (total <= 1) return "这个角色最想得到/完成什么……"
    if (li === 0) return "表面上想要……"
    if (li === total - 1) return "其实真正想要……"
    return "更深一层……"
  }

  return (
    <div className="flex flex-col gap-2">
      {value.map((layer, li) => (
        <div
          key={li}
          className="flex flex-col gap-2 rounded-md border border-border/60 bg-background/40 p-2"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              {motivationLayerLabel(li, value.length)}
            </span>
            {value.length > 1 && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-6"
                aria-label="删除该层"
                onClick={() => removeLayer(li)}
              >
                <Trash2 />
              </Button>
            )}
          </div>
          {layer.items.map((m, ii) => (
            <div key={ii} className="flex items-center gap-2">
              <Input
                value={m.text}
                onChange={(e) => setText(li, ii, e.target.value)}
                onBlur={onBlurSave}
                placeholder={placeholder(li)}
                className="flex-1"
              />
              <Select
                value={String(m.importance)}
                onValueChange={(v) => setImportance(li, ii, Number(v))}
              >
                <SelectTrigger className="w-[86px] shrink-0" aria-label="重要性">
                  <SelectValue>{`重要 ${m.importance}`}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      重要 {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="删除该动机"
                onClick={() => removeItem(li, ii)}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="self-start text-muted-foreground"
            onClick={() => addItem(li)}
          >
            <Plus />
            同层再加一条
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        onClick={addLayer}
      >
        <Plus />
        {value.length === 0 ? "添加动机" : "添加更深一层"}
      </Button>
    </div>
  )
}

/**
 * 人物关系编辑：可输入可下拉的关系对象（命中既有角色名则链接 characterId）+ 关系描述，
 * 末尾附「TA 们与我的关系」反查块（showInbound=false 时隐藏，阶段卡片等快照语境用）。
 */
export function RelationshipsEditor({
  value,
  onChange,
  onBlurSave,
  selfId,
  selfName,
  allCharacters,
  showInbound = true,
}: {
  value: RelationshipItem[]
  onChange: (next: RelationshipItem[]) => void
  onBlurSave: () => void
  /** 本角色 id：候选列表排除自己 */
  selfId: string
  /** 本角色姓名：反查时匹配自由文本目标 */
  selfName: string
  allCharacters: CharacterRecord[]
  showInbound?: boolean
}) {
  const datalistId = useId()

  /** 关系对象下拉候选（datalist）：排除自己 */
  const relationshipCandidates = allCharacters.filter((c) => c.id !== selfId)

  /** 「TA 们与我的关系」：其他角色资料里指向本角色的关系条目（characterId 命中，或自由文本名命中） */
  const inboundRelationships = relationshipCandidates.flatMap((c) =>
    normalizeRelationships(c.relationships)
      .filter((r) =>
        r.characterId
          ? r.characterId === selfId
          : r.target.trim() !== "" && r.target.trim() === selfName.trim()
      )
      .map((r) => ({ name: c.name, description: r.description }))
  )

  const setRelationship = (i: number, patch: Partial<RelationshipItem>) =>
    onChange(value.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  /** 关系对象输入：与既有角色同名（trim 后精确匹配）则链接 characterId，否则记自由文本 */
  const setRelationshipTarget = (i: number, target: string) => {
    const hit = relationshipCandidates.find((c) => c.name.trim() === target.trim())
    setRelationship(i, { target, characterId: hit ? hit.id : null })
  }

  return (
    <>
      <datalist id={datalistId}>
        {relationshipCandidates.map((c) => (
          <option key={c.id} value={c.name} />
        ))}
      </datalist>
      <div className="flex flex-col gap-2">
        {value.map((rel, i) => (
          <div key={i} className="flex items-start gap-2">
            <Input
              list={datalistId}
              value={rel.target}
              onChange={(e) => setRelationshipTarget(i, e.target.value)}
              onBlur={onBlurSave}
              placeholder="关系对象"
              className="w-40 shrink-0"
            />
            <Input
              value={rel.description}
              onChange={(e) => setRelationship(i, { description: e.target.value })}
              onBlur={onBlurSave}
              placeholder="关系描述"
              className="flex-1"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="删除该关系"
              onClick={() => onChange(value.filter((_, j) => j !== i))}
            >
              <Trash2 />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() =>
            onChange([...value, { target: "", description: "", characterId: null }])
          }
        >
          <Plus />
          添加关系
        </Button>
        {showInbound && inboundRelationships.length > 0 && (
          <div className="mt-2 flex flex-col gap-1 rounded-lg border border-dashed px-3 py-2">
            <span className="text-xs font-medium text-muted-foreground">
              TA 们与我的关系
            </span>
            {inboundRelationships.map((r, i) => (
              <p key={i} className="text-xs text-muted-foreground">
                {r.name}：{r.description || "未填写描述"}
              </p>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
