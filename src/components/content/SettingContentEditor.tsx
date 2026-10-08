"use client"

import { useEffect, useRef } from "react"
import { ArrowUp, ArrowDown, Plus, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { MarkdownEditor, type MarkdownEditorCommentsTarget } from "@/components/editor/MarkdownEditor"
import { Textarea } from "@/components/ui/textarea"
import type { SettingType } from "@/generated/prisma/enums"
import { cn } from "@/lib/utils"

import { LevelSystemEditor } from "./LevelSystemEditor"
import {
  DIALOGUE_MARK_OPTIONS,
  INNER_DIALOGUE_MARK_OPTIONS,
  isTextSettingType,
  type ConceptContent,
  type FactionContent,
  type GoldFingerContent,
  type LevelSystemContent,
  type SettingContent,
  type StyleContent,
  type TextContent,
} from "./setting-content"

/** 对话区实体芯片带来的子概念定位请求（滚动 + 高亮）；key 变化即重新触发 */
export type ConceptFocus = { name: string; key: number }

interface EditorProps {
  settingType: SettingType
  value: SettingContent
  onChange: (value: SettingContent) => void
  onBlur?: () => void
  /** 行内评论挂载目标（由 SettingEditor 注入 novelId + setting.id） */
  commentsTarget?: MarkdownEditorCommentsTarget
  focusConcept?: ConceptFocus
  /** 所属设定名称（结构化编辑器生成引用芯片序列时用，如等级体系的「引用到对话」） */
  settingName?: string
  /** 所属设定 id（引用芯片序列携带，供悬停卡按 id 反查） */
  settingId?: string
}

/** 符号类选项的分段选择：直接摆出符号形态，点击即选（沿用「编辑/分屏/预览」分段控件样式） */
function MarkOptionGroup<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
  ariaLabel: string
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="flex w-fit items-center gap-0.5 rounded-md border bg-muted p-0.5"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "flex h-8 min-w-14 items-center justify-center rounded px-3 text-sm transition-colors",
            value === o.value
              ? "bg-card font-medium text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function BigTextarea(props: {
  value: string
  onChange: (v: string) => void
  onBlur?: () => void
  placeholder?: string
  rows?: number
  commentsTarget?: MarkdownEditorCommentsTarget
  focusText?: { text: string; key: number }
}) {
  return (
    <div onBlur={props.onBlur} className="h-full">
      <MarkdownEditor
        value={props.value}
        onChange={props.onChange}
        placeholder={props.placeholder}
        commentsTarget={props.commentsTarget}
        focusText={props.focusText}
        className="h-full min-h-[320px]"
      />
    </div>
  )
}

/** 按设定类型渲染对应的结构化 content 编辑器 */
export function SettingContentEditor({ settingType, value, onChange, onBlur, commentsTarget, focusConcept, settingName, settingId }: EditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  // 结构化内容的子概念定位：按 data-concept-name 找行容器，滚动到视口中央并短暂高亮
  // （纯文本类型不走这里，由 MarkdownEditor 的 focusText 在文本内选中定位）
  useEffect(() => {
    if (!focusConcept || isTextSettingType(settingType)) return
    const el = containerRef.current?.querySelector(
      focusConcept.name.startsWith("faction-id:") ? `[data-faction-id="${CSS.escape(focusConcept.name.slice(11))}"]` : `[data-concept-name="${CSS.escape(focusConcept.name)}"]`
    )
    if (!(el instanceof HTMLElement)) return
    el.scrollIntoView({ block: "center", behavior: "smooth" })
    el.classList.add("setting-concept-flash")
    const timer = setTimeout(() => el.classList.remove("setting-concept-flash"), 2400)
    return () => {
      clearTimeout(timer)
      el.classList.remove("setting-concept-flash")
    }
  }, [focusConcept, settingType])

  const editor = renderEditor(settingType, value, onChange, onBlur, commentsTarget, focusConcept, settingName, settingId)
  return (
    <div ref={containerRef} className="h-full">
      {editor}
    </div>
  )
}

function renderEditor(
  settingType: SettingType,
  value: SettingContent,
  onChange: (value: SettingContent) => void,
  onBlur: (() => void) | undefined,
  commentsTarget: MarkdownEditorCommentsTarget | undefined,
  focusConcept: ConceptFocus | undefined,
  settingName: string | undefined,
  settingId: string | undefined
) {
  switch (settingType) {
    case "LEVEL_SYSTEM": {
      const v = value as LevelSystemContent
      return (
        <LevelSystemEditor
          content={v}
          onChange={onChange}
          onBlur={onBlur}
          focusConcept={focusConcept}
          settingName={settingName ?? "设定"}
          settingId={settingId ?? ""}
        />
      )
    }
    case "CONCEPT": {
      const v = value as ConceptContent
      const setConcepts = (concepts: ConceptContent["concepts"]) => onChange({ concepts })
      return (
        <div className="flex flex-col gap-3">
          {v.concepts.map((concept, i) => (
            <section key={i} aria-label={`概念 ${concept.term || i + 1}`} data-concept-name={concept.term} className="flex flex-col gap-2 rounded-lg border border-border p-3">
              <div className="flex items-center gap-2">
              <Input
                value={concept.term}
                onChange={(e) =>
                  setConcepts(
                    v.concepts.map((c, j) => (j === i ? { ...c, term: e.target.value } : c))
                  )
                }
                onBlur={onBlur}
                placeholder="术语"
                className="flex-1 font-medium"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="删除该概念"
                onClick={() => setConcepts(v.concepts.filter((_, j) => j !== i))}
              >
                <Trash2 />
              </Button>
              </div>
              <div onBlur={onBlur} className={concept.explanation.length > 300 ? "h-96" : "h-56"}>
                <MarkdownEditor value={concept.explanation} defaultMode="preview"
                  onChange={text => setConcepts(v.concepts.map((c, j) => j === i ? { ...c, explanation: text } : c))}
                  placeholder="解释" className="h-full" />
              </div>
            </section>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => setConcepts([...v.concepts, { term: "", explanation: "" }])}
          >
            <Plus />
            添加概念
          </Button>
        </div>
      )
    }
    case "GOLD_FINGER": {
      const v = value as GoldFingerContent
      return (
        <div className="flex flex-col gap-4">
          <div className="grid gap-2">
            <Label>触发条件</Label>
            <BigTextarea
              value={v.trigger}
              onChange={(t) => onChange({ ...v, trigger: t })}
              onBlur={onBlur}
              placeholder="主角如何获得/激活金手指"
              rows={4}
              commentsTarget={commentsTarget}
            />
          </div>
          <div className="grid gap-2">
            <Label>核心功能</Label>
            <BigTextarea
              value={v.ability}
              onChange={(t) => onChange({ ...v, ability: t })}
              onBlur={onBlur}
              placeholder="金手指能做什么"
              rows={5}
              commentsTarget={commentsTarget}
            />
          </div>
          <div className="grid gap-2">
            <Label>限制</Label>
            <BigTextarea
              value={v.limitation}
              onChange={(t) => onChange({ ...v, limitation: t })}
              onBlur={onBlur}
              placeholder="代价、冷却、限制条件（没有限制的金手指会毁掉剧情张力）"
              rows={4}
              commentsTarget={commentsTarget}
            />
          </div>
        </div>
      )
    }
    case "STYLE": {
      const v = value as StyleContent
      return (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-x-8 gap-y-3">
            <div className="grid gap-2">
              <Label>对话符号</Label>
              <MarkOptionGroup
                ariaLabel="对话符号"
                value={v.dialogueMark}
                options={DIALOGUE_MARK_OPTIONS}
                onChange={(m) => onChange({ ...v, dialogueMark: m })}
              />
            </div>
            <div className="grid gap-2">
              <Label>心理对话符号</Label>
              <MarkOptionGroup
                ariaLabel="心理对话符号"
                value={v.innerDialogueMark}
                options={INNER_DIALOGUE_MARK_OPTIONS}
                onChange={(m) => onChange({ ...v, innerDialogueMark: m })}
              />
            </div>
          </div>
          <div className="grid gap-2">
            <Label>行文风格</Label>
            <BigTextarea
              value={v.style}
              onChange={(t) => onChange({ ...v, style: t })}
              onBlur={onBlur}
              placeholder="叙事视角、节奏、语言特点、对话风格等"
              rows={8}
              commentsTarget={commentsTarget}
            />
          </div>
          <div className="grid gap-2">
            <Label>参考案例</Label>
            <BigTextarea
              value={v.referenceCases}
              onChange={(t) => onChange({ ...v, referenceCases: t })}
              onBlur={onBlur}
              placeholder="参考段落或对标作品的文风示例"
              rows={6}
              commentsTarget={commentsTarget}
            />
          </div>
        </div>
      )
    }
    case "FACTION": {
      const v = value as FactionContent
      const setFactions = (factions: FactionContent["factions"]) => onChange({ ...v, factions })
      return (
        <div className="flex flex-col gap-4">
          {v.factions.map((faction, i) => (
            <div key={faction.id ?? i} data-concept-name={faction.name} data-faction-id={faction.id} className="flex flex-col gap-2 rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <Input
                  value={faction.name}
                  onChange={(e) =>
                    setFactions(
                      v.factions.map((f, j) => (j === i ? { ...f, name: e.target.value } : f))
                    )
                  }
                  onBlur={onBlur}
                  placeholder="势力名称"
                  className="flex-1"
                />
                <Button type="button" variant="ghost" size="icon" aria-label={`上移势力${faction.name}`} disabled={i === 0} onClick={() => {
                  const next = [...v.factions]; [next[i - 1], next[i]] = [next[i], next[i - 1]]; setFactions(next)
                }}><ArrowUp className="size-4"/></Button>
                <Button type="button" variant="ghost" size="icon" aria-label={`下移势力${faction.name}`} disabled={i === v.factions.length - 1} onClick={() => {
                  const next = [...v.factions]; [next[i + 1], next[i]] = [next[i], next[i + 1]]; setFactions(next)
                }}><ArrowDown className="size-4"/></Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="删除该势力"
                  onClick={() => setFactions(v.factions.filter((_, j) => j !== i))}
                >
                  <Trash2 />
                </Button>
              </div>
              <Textarea
                value={faction.description}
                onChange={(e) =>
                  setFactions(
                    v.factions.map((f, j) => (j === i ? { ...f, description: e.target.value } : f))
                  )
                }
                onBlur={onBlur}
                placeholder="势力简介"
                rows={2}
              />
              <Textarea
                value={faction.relations}
                onChange={(e) =>
                  setFactions(
                    v.factions.map((f, j) => (j === i ? { ...f, relations: e.target.value } : f))
                  )
                }
                onBlur={onBlur}
                placeholder="与其他势力的关系"
                rows={2}
              />
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() =>
              setFactions([...v.factions, { id: crypto.randomUUID(), name: "", description: "", relations: "" }])
            }
          >
            <Plus />
            添加势力
          </Button>
        </div>
      )
    }
    default: {
      // POWER_SYSTEM / MAP / SOCIETY / CULTURE / GEOGRAPHY / WORLD_HISTORY：大段富文本段落
      const v = value as TextContent
      const placeholders: Partial<Record<SettingType, string>> = {
        POWER_SYSTEM: "力量的来源、运转规则、上限与代价……",
        MAP: "主要地域、方位关系、关键地点……",
        SOCIETY: "社会制度、阶层结构、律法与秩序……",
        CULTURE: "语言文字、风俗节庆、信仰与禁忌……",
        GEOGRAPHY: "山川地貌、气候物产、疆域边界……",
        WORLD_HISTORY: "纪元与朝代更替、重大历史事件、古老传说与失落文明……",
      }
      return (
        <BigTextarea
          value={v.text}
          onChange={(t) => onChange({ text: t })}
          onBlur={onBlur}
          placeholder={placeholders[settingType] ?? "填写设定内容"}
          rows={16}
          commentsTarget={commentsTarget}
          focusText={focusConcept ? { text: focusConcept.name, key: focusConcept.key } : undefined}
        />
      )
    }
  }
}
