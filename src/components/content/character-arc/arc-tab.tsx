"use client"

/**
 * 角色面板「弧线」页入口：
 * - arcStages 非空 → 阶段卡片链视图（ArcChain）/ 阶段编辑 drill-down（局部 editingId，不开新 tab）
 * - 为空 → 空态文案 +「添加阶段」；旧 backstory/growthArc 文本不提供编辑入口
 *   （存量文本保留在库中并继续用于 AI 回退渲染，卡片建立后以卡片为准）
 * - 新建阶段为草稿态：首次产生内容才并入弧线并落库/暂存；未做任何修改就返回或删除，
 *   等同撤销——不创建卡片、不产生暂存修改。
 * 所有变更经 onArcStagesChange 回写 CharacterPanel 表单，走统一自动保存。
 */
import { useState } from "react"
import { Plus } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { ArcStage } from "@/lib/arc-stage"

import type { CharacterRecord } from "../types"
import { ArcChain } from "./arc-chain"
import { ArcStageEditor } from "./arc-stage-editor"

const DEFAULT_STAGE_NAME = "新阶段"

function newStage(): ArcStage {
  return {
    id: crypto.randomUUID(),
    name: DEFAULT_STAGE_NAME,
    markers: [],
    startChapter: null,
    changes: [],
    description: "",
    tags: [],
    isDebut: false,
  }
}

/** 阶段仍是默认空白态（新建后未做任何修改） */
function isPristineStage(s: ArcStage): boolean {
  return (
    s.name === DEFAULT_STAGE_NAME &&
    s.markers.length === 0 &&
    !s.startChapter &&
    s.changes.length === 0 &&
    s.description.trim() === "" &&
    s.tags.length === 0 &&
    !s.isDebut
  )
}

export function ArcTab({
  novelId,
  arcStages,
  backstory,
  growthArc,
  selfId,
  selfName,
  allCharacters,
  onArcStagesChange,
  onBlurSave,
}: {
  novelId: string
  arcStages: ArcStage[]
  backstory: string
  growthArc: string
  /** 本角色 id / 姓名：阶段「人物关系」变化控件的对象候选与链接用 */
  selfId: string
  selfName: string
  allCharacters: CharacterRecord[]
  /** 阶段卡片链变更：immediate=false 走防抖（连续输入），true 立即保存（离散操作） */
  onArcStagesChange: (stages: ArcStage[], immediate?: boolean) => void
  /** 失焦 flush 待保存修改（接 useAutosave.saveNow） */
  onBlurSave: () => void
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  /** 新建草稿：首次产生内容前不入弧线、不落库；index 为预定插入位置 */
  const [draft, setDraft] = useState<{ stage: ArcStage; index: number } | null>(null)
  const editing = editingId
    ? (arcStages.find((s) => s.id === editingId) ??
      (draft?.stage.id === editingId ? draft.stage : null))
    : null
  // 编辑目标被删（危险区/外部写入）时回链视图（渲染期调整自身 state）
  if (editingId && !editing) {
    setEditingId(null)
    setDraft(null)
  }

  /** 在 index 处新建草稿并直接进入编辑（不落库，见 handleEditorChange） */
  const addStage = (index: number) => {
    const stage = newStage()
    setDraft({ stage, index })
    setEditingId(stage.id)
  }

  /** 返回链视图：若编辑的是仍空白的新建草稿，直接丢弃（等同撤销，不创建卡片） */
  const back = () => {
    setDraft(null)
    setEditingId(null)
  }

  /** 编辑视图回写：草稿编辑只更新本地；首次出现真实内容才并入弧线走保存 */
  const handleEditorChange = (next: ArcStage[], immediate?: boolean) => {
    if (draft && editingId === draft.stage.id) {
      const d = next.find((s) => s.id === draft.stage.id)
      if (!d) {
        // 草稿在危险区被删除：从未落库，直接丢弃
        back()
        return
      }
      if (isPristineStage(d)) {
        setDraft({ ...draft, stage: d })
        return
      }
      // 首次产生内容：并入弧线成为真实卡片，后续编辑走正常链路
      setDraft(null)
      onArcStagesChange(next, immediate)
      return
    }
    onArcStagesChange(next, immediate)
  }

  if (editing) {
    // 草稿编辑时传入含草稿的合成链（编辑器的 patchStage/setDebut 依赖 id 在列表中）
    const stagesForEditor =
      draft && editing.id === draft.stage.id
        ? [...arcStages.slice(0, draft.index), draft.stage, ...arcStages.slice(draft.index)]
        : arcStages
    return (
      <ArcStageEditor
        novelId={novelId}
        stage={editing}
        stages={stagesForEditor}
        selfId={selfId}
        selfName={selfName}
        allCharacters={allCharacters}
        onChange={handleEditorChange}
        onBlurSave={onBlurSave}
        onBack={back}
      />
    )
  }

  if (arcStages.length === 0) {
    const hasLegacy = backstory.trim() !== "" || growthArc.trim() !== ""
    return (
      <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-border p-6">
        <p className="text-sm text-muted-foreground">
          还没有阶段卡片。把角色的生命历程拆成按时间先后排列的阶段：定位、属性变化、起始章节逐阶段管理；标记「出场」阶段后，其前的卡片自动视为出场前经历。
        </p>
        {hasLegacy && (
          <p className="text-xs text-muted-foreground">
            原有的「出场前经历 / 成长弧线」文本仍保留在角色资料中，并继续用于 AI 上下文；建立阶段卡片后，AI 上下文以卡片为准。
          </p>
        )}
        <Button type="button" variant="outline" size="sm" onClick={() => addStage(0)}>
          <Plus />
          添加阶段
        </Button>
      </div>
    )
  }

  return (
    <ArcChain
      novelId={novelId}
      stages={arcStages}
      onChange={onArcStagesChange}
      onEdit={setEditingId}
      onAddStage={() => addStage(arcStages.length)}
      onInsertAfter={(index) => addStage(index + 1)}
    />
  )
}
