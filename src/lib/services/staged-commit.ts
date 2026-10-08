import { z } from "zod"

import { ContentError } from "@/lib/content-errors"
import { prisma } from "@/lib/db"
import {
  firstControl,
  stagedDataFields,
  type StagedChange,
} from "@/lib/staged-save"
import type { TextBaseline } from "./target-text"
import { updateWorld, createWorld, deleteWorld } from "./world"
import { updateSetting, upsertSetting, deleteSetting } from "./setting"
import { updateCharacter, deleteCharacter } from "./character"
import { updateItem, deleteItem } from "./item"
import { updateScene, deleteScene } from "./scene"
import { toggleTrope, deleteCustomTrope } from "./trope"
import { updateAttributeDefinition, deleteAttributeDefinition } from "./attribute"
import { updateForeshadow, deleteForeshadow } from "./foreshadow"
import { upsertTheme } from "./theme"
import { updateChapterContent } from "./chapter"
import { updateChapterOutline, updateVolume } from "./outline"

/**
 * 三阶段保存 · 服务端落库执行器（阶段三唯一落库口）。
 * 把结构化暂存修改逐条映射到既有服务层提交函数（版本/幂等/快照原样生效）；
 * 不做模型调用、不做 HTTP 自调。单笔失败不中断整批，回执区分 committed/conflicts/errors。
 * SETTING/CHARACTER 提交不自动级联（cascade:false），级联候选由回执给出，流水线问答后再触发。
 */

export interface StagedCommitItemReceipt {
  targetKind: StagedChange["targetKind"]
  targetId: string
  /** create 落库后的真实 id（modify/delete 与 targetId 相同） */
  operationId?: string
  committedId: string
  targetLabel: string
  op: StagedChange["op"]
}

export interface StagedCommitFailure {
  targetKind: StagedChange["targetKind"]
  targetId: string
  targetLabel: string
  op: StagedChange["op"]
  operationId?: string
  code: string
  message: string
}

export interface StagedCascadeCandidate {
  triggerType: "SETTING" | "CHARACTER"
  triggerId: string
  changeDescription: string
}

export interface StagedCommitReceipt {
  committed: StagedCommitItemReceipt[]
  conflicts: StagedCommitFailure[]
  errors: StagedCommitFailure[]
  cascade: StagedCascadeCandidate[]
}

const baselineSchema = z.object({ version: z.number().nullable(), updatedAt: z.string(), hash: z.string() })

function fail(kind: string, change: StagedChange, err: unknown): StagedCommitFailure {
  const isConflict =
    (err instanceof ContentError && ["VERSION_CONFLICT", "SNAPSHOT_CONFLICT", "BASELINE_CONFLICT", "OPERATION_CONFLICT"].includes(err.code)) ||
    (err instanceof Error && /CONFLICT|冲突/.test(err.message))
  return {
    targetKind: change.targetKind,
    targetId: change.targetId,
    targetLabel: change.targetLabel,
    op: change.op,
    operationId: firstControl(change.request.body).operationId,
    code: isConflict ? "VERSION_CONFLICT" : "COMMIT_FAILED",
    message: err instanceof Error ? err.message : "落库失败",
  }
}

/** 单条落库；返回落库后的真实 id */
async function commitOne(scope: { userId: string; novelId: string }, change: StagedChange): Promise<string> {
  const data = stagedDataFields(change.request.body)
  const control = firstControl(change.request.body)
  const { targetKind, targetId, op } = change

  if (op === "delete") {
    switch (targetKind) {
      case "WORLD": await deleteWorld(targetId); break
      case "SETTING": await deleteSetting(targetId); break
      case "CHARACTER": await deleteCharacter(targetId); break
      case "ITEM": await deleteItem(targetId); break
      case "SCENE": await deleteScene(targetId, {...scope, expectedVersion: control.expectedVersion!, operationId: control.operationId!}); break
      case "TROPE": await deleteCustomTrope(targetId); break
      case "ATTRIBUTE": await deleteAttributeDefinition(targetId); break
      case "FORESHADOW": await deleteForeshadow(scope.novelId, targetId); break
      default: throw new ContentError("STAGED_KIND_UNSUPPORTED", `不支持删除的对象类型：${targetKind}`, 400)
    }
    return targetId
  }

  if (op === "create") {
    switch (targetKind) {
      case "WORLD": {
        const created = await createWorld(scope.novelId, {
          name: String(data.name ?? change.targetLabel),
          ...(typeof data.description === "string" ? { description: data.description } : {}),
          ...(typeof data.parentId === "string" ? { parentId: data.parentId } : {}),
        })
        return created.id
      }
      case "SETTING": {
        const created = await upsertSetting({
          novelId: scope.novelId,
          type: data.type as never,
          name: String(data.name ?? change.targetLabel),
          content: (data.content ?? { text: "" }) as never,
          ...(typeof data.worldId === "string" ? { worldId: data.worldId } : {}),
          ...(typeof data.parentId === "string" ? { parentId: data.parentId } : {}),
        })
        return created.id
      }
      default: throw new ContentError("STAGED_KIND_UNSUPPORTED", `世界观面板外不支持创建：${targetKind}`, 400)
    }
  }

  // op === "modify"
  switch (targetKind) {
    case "THEME": {
      await upsertTheme(scope.novelId, data as never, { source: "author", userId: scope.userId, expectedVersion: control.expectedVersion, operationId: control.operationId })
      return targetId
    }
    case "WORLD": {
      if (!control.operationId || !control.baseline) throw new ContentError("PRECONDITION_REQUIRED", "世界观修改缺少首帧基线，请撤销后重新编辑", 428)
      await updateWorld(targetId, data as { name?: string; description?: string }, {
        userId: scope.userId,
        operationId: control.operationId,
        baseline: baselineSchema.parse(control.baseline) as TextBaseline,
      })
      return targetId
    }
    case "SETTING": {
      if (!control.operationId || control.expectedVersion === undefined) throw new ContentError("PRECONDITION_REQUIRED", "设定修改缺少首帧版本，请撤销后重新编辑", 428)
      await updateSetting(targetId, data as { name?: string; content?: never }, {
        userId: scope.userId,
        operationId: control.operationId,
        expectedVersion: control.expectedVersion,
        cascade: false,
      })
      return targetId
    }
    case "CHARACTER": {
      await updateCharacter(targetId, data as never, control.expectedVersion, { cascade: false })
      return targetId
    }
    case "ITEM": await updateItem(targetId, data as never); return targetId
    case "SCENE": await updateScene(targetId, data as never, {...scope, expectedVersion: control.expectedVersion!, operationId: control.operationId!}); return targetId
    case "TROPE": {
      if (typeof data.selected === "boolean") await toggleTrope(targetId, data.selected)
      return targetId
    }
    case "ATTRIBUTE": await updateAttributeDefinition(targetId, data as never); return targetId
    case "FORESHADOW": await updateForeshadow(scope.novelId, targetId, data as never); return targetId
    case "CHAPTER_CONTENT": {
      if (!control.operationId || control.expectedVersion === undefined) throw new ContentError("PRECONDITION_REQUIRED", "正文修改缺少首帧版本，请撤销后重新编辑", 428)
      await updateChapterContent(targetId, String(data.content ?? ""), {
        userId: scope.userId,
        novelId: scope.novelId,
        expectedVersion: control.expectedVersion,
        operationId: control.operationId,
      })
      return targetId
    }
    case "CHAPTER_OUTLINE": {
      if (!control.operationId || control.expectedVersion === undefined) throw new ContentError("PRECONDITION_REQUIRED", "章大纲修改缺少首帧版本，请撤销后重新编辑", 428)
      await updateChapterOutline(targetId, data as { title?: string; outline?: string }, {
        userId: scope.userId,
        novelId: scope.novelId,
        expectedVersion: control.expectedVersion,
        operationId: control.operationId,
      })
      return targetId
    }
    case "VOLUME_OUTLINE": {
      await updateVolume(targetId, data as { title?: string; summary?: string }, control.expectedUpdatedAt)
      return targetId
    }
    default: throw new ContentError("STAGED_KIND_UNSUPPORTED", `不支持的对象类型：${targetKind as string}`, 400)
  }
}

export async function commitStagedChanges(
  scope: { userId: string; novelId: string },
  changes: StagedChange[]
): Promise<StagedCommitReceipt> {
  // 归属校验先行（与各路由 getOwnedNovel 同级）
  const novel = await prisma.novel.findFirst({ where: { id: scope.novelId, userId: scope.userId, status: { not: "DELETED" } }, select: { id: true } })
  if (!novel) throw new ContentError("TARGET_NOT_FOUND", "作品不存在或无权访问", 404)

  const receipt: StagedCommitReceipt = { committed: [], conflicts: [], errors: [], cascade: [] }
  // An author deletion supersedes unsaved form edits; do not advance the DB version before deleting.
  const effective = changes.filter(change => !(change.targetKind === "SCENE" && change.op === "modify" && changes.some(c => c.targetKind === "SCENE" && c.targetId === change.targetId && c.op === "delete")))
  for (const raw of effective) {
    const modified = raw.targetKind === "SCENE" && raw.op === "delete" ? changes.find(c => c.targetKind === "SCENE" && c.targetId === raw.targetId && c.op === "modify") : undefined
    const change = modified ? {...raw, request: {...raw.request, body: {...(raw.request.body as Record<string, unknown>), expectedVersion: firstControl(modified.request.body).expectedVersion}}} : raw
    try {
      const committedId = await commitOne(scope, change)
      receipt.committed.push({
        targetKind: change.targetKind,
        targetId: change.targetId,
        committedId,
        operationId: firstControl(change.request.body).operationId,
        targetLabel: change.targetLabel,
        op: change.op,
      })
      // 级联候选（SETTING/CHARACTER 的修改与创建；删除的影响由流水线风险问答处理）
      if ((change.targetKind === "SETTING" || change.targetKind === "CHARACTER") && change.op !== "delete") {
        const fields = change.items.map(i => i.fieldLabel).join("、")
        receipt.cascade.push({
          triggerType: change.targetKind,
          triggerId: committedId,
          changeDescription: `${change.targetKind === "SETTING" ? "设定" : "角色"}「${change.targetLabel}」${change.op === "create" ? "新增" : "已更新"}（${fields}）。变更摘要：${change.items.map(i => i.summary).join("；")}`,
        })
      }
    } catch (err) {
      const failure = fail(change.targetKind, change, err)
      if (failure.code === "VERSION_CONFLICT") receipt.conflicts.push(failure)
      else receipt.errors.push(failure)
    }
  }
  return receipt
}
