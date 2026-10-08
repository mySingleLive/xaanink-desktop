import { lockSceneTree } from "./scene";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { ContentError } from "@/lib/content-errors";
import {
  applyPlanningOperations,
  cardSchema,
  chapterProjection,
  operationSchema,
  planningSchema,
  validatePlanning,
  type PlanningData,
  type PlanningOperation,
} from "@/lib/planning/domain";
import {
  commitChapterRevisionInTransaction,
  lockContentOperation,
  requestHash,
} from "./content-commit";
import { ownedStory, type StoryScope } from "./story-artifacts";
import { loadStoryMaterials, validatePlanningMaterials } from "./story-materials";

export const planningMutationSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  operationId: z.string().min(1).max(120),
  operations: z.array(operationSchema).min(1).max(200),
});
type DB = Prisma.TransactionClient;
export async function getPlanning(scope: StoryScope, db: DB = prisma) {
  await ownedStory(scope, db);
  const row = await db.planningDocument.findUnique({
    where: { novelId: scope.novelId },
  });
  const [characters, worlds] = await Promise.all([
    db.character.findMany({
      where: { novelId: scope.novelId },
      select: { id: true, name: true, avatarUrl: true },
    }),
    db.world.findMany({
      where: { novelId: scope.novelId },
      select: { id: true, name: true },
    }),
  ]);
  return {
    version: row?.version ?? 0,
    data: row ? planningSchema.parse(row.data) : planningSchema.parse({}),
    characters,
    worlds,
    materials: (await loadStoryMaterials(db, scope.novelId)).map(({ kind, id, title }) => ({ kind, id, title })),
  };
}
async function validateReferences(
  db: DB,
  scope: StoryScope,
  data: PlanningData,
) {
  const people = new Set([
    ...data.events.flatMap((e) => [
      ...e.people,
      ...e.changes.map((c) => c.character),
    ]),
    ...data.cards.flatMap((c) =>
      c.tellings.flatMap((t) => [
        ...(t.character ? [t.character] : []),
        ...t.refs.flatMap((r) => (r.character ? [r.character] : [])),
      ]),
    ),
    ...data.connections.flatMap((c) => c.characters),
  ]);
  const count = await db.character.count({
    where: { novelId: scope.novelId, id: { in: [...people] } },
  });
  if (count !== people.size)
    throw new ContentError("PLANNING_CHARACTER", "角色不存在或不属于本书", 400);
  const worlds = [
    ...new Set(data.worlds.flatMap((w) => (w.worldId ? [w.worldId] : []))),
  ];
  if (
    (await db.world.count({
      where: { novelId: scope.novelId, id: { in: worlds } },
    })) !== worlds.length
  )
    throw new ContentError("PLANNING_WORLD", "关联世界观不属于本书", 400);
  await validatePlanningMaterials(db, scope.novelId, data);
}
async function syncProjection(
  db: DB,
  scope: StoryScope,
  previous: PlanningData,
  next: PlanningData,
  operationId: string,
  importing = false,
) {
  const existingVolumes = await db.volume.findMany({
    where: { novelId: scope.novelId },
  });
  let nextIndex = Math.max(0, ...existingVolumes.map((v) => v.index)) + 1;
  const volumes = [
    ...next.volumes,
    ...next.lines
      .filter((l) => next.chapters.some((ch) => ch.line === l.id && !ch.volume))
      .map((l) => ({
        id: `${l.id}-unfiled`,
        line: l.id,
        title: `${l.name} · 未分卷`,
        summary: "",
        order: 0,
      })),
  ];
  for (const v of volumes) {
    const old = await db.volume.findUnique({ where: { id: v.id } });
    if (old && old.novelId !== scope.novelId)
      throw new ContentError("PLANNING_SCOPE", "卷ID被其他作品占用", 400);
    if (!old)
      await db.volume.create({
        data: {
          id: v.id,
          novelId: scope.novelId,
          index: nextIndex++,
          title: v.title,
          summary: v.summary,
        },
      });
    else if (old.title !== v.title || old.summary !== v.summary)
      await db.volume.update({
        where: { id: v.id },
        data: { title: v.title, summary: v.summary },
      });
  }
  for (const ch of next.chapters) {
    const projection = chapterProjection(next, ch.id),
      oldPlan = previous.chapters.find((c) => c.id === ch.id),
      old = await db.chapter.findUnique({
        where: { id: ch.id },
        include: { volume: true },
      });
    if (old && old.volume.novelId !== scope.novelId)
      throw new ContentError("PLANNING_SCOPE", "章节ID被其他作品占用", 400);
    const volumeId = ch.volume || `${ch.line}-unfiled`;
    if (!old) {
      const last = await db.chapter.aggregate({
        where: { volumeId },
        _max: { index: true },
      });
      await db.chapter.create({
        data: {
          id: ch.id,
          volumeId,
          index: (last._max.index ?? 0) + 1,
          title: ch.title,
          outline: projection.outline,
        },
      });
      continue;
    }
    if (importing) continue;
    const changed =
      !oldPlan ||
      requestHash(chapterProjection(previous, ch.id)) !==
        requestHash(projection);
    if (changed) {
      if (
        old.status === "FINAL" &&
        (old.title !== ch.title || old.outline !== projection.outline)
      )
        throw new ContentError(
          "PLANNING_FINAL",
          "规划涉及定稿章，请先解除定稿后核对修改",
        );
      if (old.title !== ch.title || old.outline !== projection.outline)
        await commitChapterRevisionInTransaction(db, {
          ...scope,
          chapterId: ch.id,
          expectedVersion: old.version,
          operationId: `${operationId}:${ch.id}`,
          source: "planning",
          reason: "叙事线卷章投影更新",
          changes: {
            title: ch.title,
            outline: projection.outline,
            status: "OUTLINE",
          },
        });
    }
    if (old.volumeId !== volumeId) {
      const last = await db.chapter.aggregate({
        where: { volumeId },
        _max: { index: true },
      });
      await db.chapter.update({
        where: { id: ch.id },
        data: { volumeId, index: (last._max.index ?? 0) + 1 },
      });
    }
  }
  // Generated unfiled containers carry no author data once all chapters move out.
  const generatedUnfiled = previous.lines
    .map((l) => `${l.id}-unfiled`)
    .filter((id) => !volumes.some((v) => v.id === id));
  if (generatedUnfiled.length)
    await db.volume.deleteMany({
      where: {
        novelId: scope.novelId,
        id: { in: generatedUnfiled },
        chapters: { none: {} },
      },
    });
  if (!importing) {
    // Stable IDs and text survive reorder; temporary unique slots avoid index collisions.
    const allVolumes = await db.volume.findMany({
      where: { novelId: scope.novelId },
      include: { chapters: { orderBy: { index: "asc" } } },
      orderBy: { index: "asc" },
    });
    const lineOrder = next.lines
      .slice()
      .sort((a, b) => Number(b.primary) - Number(a.primary))
      .map((l) => l.id);
    const plannedVolumes = volumes
      .slice()
      .sort(
        (a, b) =>
          lineOrder.indexOf(a.line) - lineOrder.indexOf(b.line) ||
          a.order - b.order,
      )
      .map((v) => v.id);
    const volumeOrder = [
      ...plannedVolumes,
      ...allVolumes
        .filter((v) => !plannedVolumes.includes(v.id))
        .map((v) => v.id),
    ];
    for (const [i, v] of allVolumes.entries())
      await db.volume.update({
        where: { id: v.id },
        data: { index: -1000000 - i },
      });
    for (const [i, id] of volumeOrder.entries())
      await db.volume.update({ where: { id }, data: { index: i + 1 } });
    for (const v of allVolumes) {
      const planned = next.chapters
        .filter((ch) => (ch.volume || `${ch.line}-unfiled`) === v.id)
        .sort((a, b) => a.order - b.order)
        .map((ch) => ch.id);
      const order = [
        ...planned,
        ...v.chapters
          .filter((ch) => !planned.includes(ch.id))
          .map((ch) => ch.id),
      ];
      for (const [i, ch] of v.chapters.entries())
        await db.chapter.update({
          where: { id: ch.id },
          data: { index: -1000000 - i },
        });
      for (const [i, id] of order.entries())
        await db.chapter.update({ where: { id }, data: { index: i + 1 } });
    }
  }
}
async function commitPlanning(
  scope: StoryScope,
  input: { expectedVersion: number; operationId: string },
  change: (old: PlanningData, db: DB) => Promise<PlanningData> | PlanningData,
  request: unknown,
  importing = false,
  transaction?: DB,
) {
  const run = async (db: DB) => {
    await lockSceneTree(db, scope.novelId);
    const novel = await ownedStory(scope, db);
    if (novel.status !== "ACTIVE")
      throw new ContentError("READ_ONLY", "归档作品仅可查看规划", 403);
    await lockContentOperation(db, scope.userId, input.operationId);
    await db.$queryRaw`SELECT id FROM "Novel" WHERE id=${scope.novelId} FOR UPDATE`;
    const hash = requestHash(request),
      prior = await db.contentMutation.findUnique({
        where: {
          userId_operationId: {
            userId: scope.userId,
            operationId: input.operationId,
          },
        },
      });
    if (prior) {
      if (prior.novelId !== scope.novelId || prior.requestHash !== hash)
        throw new ContentError(
          "OPERATION_CONFLICT",
          "操作编号已用于不同请求",
        );
      return prior.result;
    }
    const row = await db.planningDocument.findUnique({
      where: { novelId: scope.novelId },
    });
    if ((row?.version ?? 0) !== input.expectedVersion)
      throw new ContentError(
        "VERSION_CONFLICT",
        "规划已有新版本，输入已保留，请核对后重试",
      );
    const old = row
        ? planningSchema.parse(row.data)
        : planningSchema.parse({}),
      next = validatePlanning(await change(structuredClone(old), db));
    await validateReferences(db, scope, next);
    await syncProjection(db, scope, old, next, input.operationId, importing);
    const version = (row?.version ?? 0) + 1;
    if (!row)
      await db.contentVersion.create({
        data: {
          targetType: "Planning",
          targetId: scope.novelId,
          version: 0,
          snapshot: old as unknown as Prisma.InputJsonValue,
          reason: "接入规划前",
        },
      });
    await db.planningDocument.upsert({
      where: { novelId: scope.novelId },
      create: {
        novelId: scope.novelId,
        version,
        data: next as unknown as Prisma.InputJsonValue,
      },
      update: { version, data: next as unknown as Prisma.InputJsonValue },
    });
    const restoredId =
      request && typeof request === "object" && "snapshotId" in request
        ? String(request.snapshotId)
        : null;
    const restored = restoredId
      ? await db.contentVersion.findFirst({
          where: {
            id: restoredId,
            targetType: "Planning",
            targetId: scope.novelId,
          },
          select: { version: true },
        })
      : null;
    const adjustWordRange =
      request && typeof request === "object" && "kind" in request && request.kind === "adjustChapterWordRange";
    const snapshot = await db.contentVersion.create({
      data: {
        targetType: "Planning",
        targetId: scope.novelId,
        version,
        snapshot: next as unknown as Prisma.InputJsonValue,
        reason: importing
          ? "接入已有大纲"
          : restored
            ? `恢复规划版本：${restored.version}`
            : adjustWordRange
              ? "调整章节字数档"
              : "修改世界线与叙事线",
      },
    });
    const result = {
      version,
      snapshotId: snapshot.id,
      operationId: input.operationId,
    };
    await db.contentMutation.create({
      data: {
        userId: scope.userId,
        novelId: scope.novelId,
        targetType: "Planning",
        targetId: scope.novelId,
        operationId: input.operationId,
        requestHash: hash,
        beforeVersion: row?.version ?? 0,
        afterVersion: version,
        beforeHash: requestHash(old),
        afterHash: requestHash(next),
        result,
      },
    });
    return result;
  };
  return transaction ? run(transaction) : prisma.$transaction(run, { timeout: 30000 });
}
export async function mutatePlanning(scope: StoryScope, raw: unknown) {
  const input = planningMutationSchema.parse(raw);
  return commitPlanning(
    scope,
    input,
    (old) => {
      for (const op of input.operations)
        if (
          op.kind === "put" &&
          op.collection === "worlds" &&
          "fork" in op.value
        ) {
          const previous = old.worlds.find((w) => w.id === op.value.id);
          if (
            requestHash(previous?.fork ?? null) !== requestHash(op.value.fork)
          )
            throw new ContentError(
              "FROZEN_HISTORY",
              "前史只能通过分叉创建，不能直接改写",
              400,
            );
        }
      return applyPlanningOperations(
        old,
        input.operations,
        input.expectedVersion,
      );
    },
    input,
  );
}

/**
 * 调整单章字数规划档（选卡「调整字数范围后采用」链路，card-select-product.md F2）：
 * 走 commitPlanning 全链（校验/投影/快照/回执），可挂调用方事务（accept 的调档-复评-采用原子提交）。
 * expectedVersion 取当前规划版本——accept 链路不知规划版本，锁内 CAS 失败即回滚由调用方重试。
 */
export async function adjustChapterWordRange(
  scope: StoryScope,
  chapterId: string,
  range: { wordMin: number; wordBudget: number },
  operationId: string,
  transaction?: DB,
) {
  if (
    !Number.isInteger(range.wordMin) ||
    !Number.isInteger(range.wordBudget) ||
    range.wordMin < 1 ||
    range.wordMin > range.wordBudget ||
    range.wordBudget > 200000
  )
    throw new ContentError("INVALID_INPUT", "字数范围无效", 400);
  const db = transaction ?? prisma;
  const row = await db.planningDocument.findUnique({
    where: { novelId: scope.novelId },
  });
  if (!row) throw new ContentError("PLANNING_MISSING", "本书尚未接入卷章规划", 409);
  return commitPlanning(
    scope,
    { expectedVersion: row.version, operationId },
    (old) => {
      const chapter = old.chapters.find((ch) => ch.id === chapterId);
      if (!chapter)
        throw new ContentError("CHAPTER_NOT_IN_PLANNING", "本章不在卷章规划中", 409);
      chapter.wordMin = range.wordMin;
      chapter.wordBudget = range.wordBudget;
      return old;
    },
    { kind: "adjustChapterWordRange", chapterId, ...range },
    false,
    transaction,
  );
}

export async function importOutlinePlanning(
  scope: StoryScope,
  input: { expectedVersion: number; operationId: string },
) {
  return commitPlanning(
    scope,
    input,
    async (old, db) => {
      if (old.lines.length || old.cards.length)
        throw new ContentError(
          "PLANNING_IMPORTED",
          "已有叙事规划，不重复接入大纲",
        );
      const volumes = await db.volume.findMany({
          where: { novelId: scope.novelId },
          orderBy: { index: "asc" },
          include: { chapters: { orderBy: { index: "asc" } } },
        }),
        line = `narrative-${randomUUID()}`;
      old.lines.push({ id: line, name: "全书叙事", primary: true });
      for (const [i, v] of volumes.entries()) {
        old.volumes.push({
          id: v.id,
          line,
          title: v.title,
          summary: v.summary,
          order: i,
        });
        for (const [j, ch] of v.chapters.entries()) {
          old.chapters.push({
            id: ch.id,
            line,
            volume: v.id,
            title: ch.title,
            order: j,
            wordMin: 0,
            wordBudget: 3000,
          });
          old.cards.push(
            cardSchema.parse({
              id: `card-${randomUUID()}`,
              line,
              title: ch.title,
              chapter: ch.id,
              order: old.cards.length,
              tellings: [{ id: `pov-${randomUUID()}`, intent: ch.outline }],
            }),
          );
        }
      }
      return old;
    },
    { ...input, kind: "import" },
    true,
  );
}
export async function planningHistory(scope: StoryScope) {
  await ownedStory(scope);
  return prisma.contentVersion.findMany({
    where: { targetType: "Planning", targetId: scope.novelId },
    orderBy: { version: "desc" },
    take: 50,
    select: { id: true, version: true, reason: true, createdAt: true },
  });
}
export async function restorePlanning(
  scope: StoryScope,
  input: { expectedVersion: number; operationId: string; snapshotId: string },
) {
  return commitPlanning(
    scope,
    input,
    async (_old, db) => {
      const row = await db.contentVersion.findFirst({
        where: {
          id: input.snapshotId,
          targetType: "Planning",
          targetId: scope.novelId,
        },
      });
      if (!row)
        throw new ContentError("SNAPSHOT_NOT_FOUND", "规划历史不存在", 404);
      return planningSchema.parse(row.snapshot);
    },
    input,
  );
}
export async function proposePlanning(scope: StoryScope, raw: unknown) {
  const input = planningMutationSchema.parse(raw);
  return prisma.$transaction(async (db) => {
    await lockSceneTree(db, scope.novelId);
    const novel = await ownedStory(scope, db);
    if (novel.status !== "ACTIVE")
      throw new ContentError("READ_ONLY", "归档作品仅可查看规划", 403);
    await lockContentOperation(
      db,
      scope.userId,
      `proposal:${input.operationId}`,
    );
    const proposalId = `proposal-${requestHash({ userId: scope.userId, novelId: scope.novelId, operationId: input.operationId })}`;
    const prior = await db.contentVersion.findFirst({
      where: {
        targetType: "PlanningProposal",
        targetId: scope.novelId,
        reason: proposalId,
      },
    });
    if (prior && requestHash(prior.snapshot) !== requestHash(input))
      throw new ContentError("OPERATION_CONFLICT", "建议编号已用于不同内容");
    let proposalRowId = prior?.id;
    if (!prior) {
      const current = await getPlanning(scope, db);
      if (current.version !== input.expectedVersion)
        throw new ContentError("VERSION_CONFLICT", "规划已变化，请重新查询");
      const next = applyPlanningOperations(
        current.data,
        input.operations,
        current.version,
      );
      await validateReferences(db, scope, next);
      const created = await db.contentVersion.create({
        data: {
          targetType: "PlanningProposal",
          targetId: scope.novelId,
          version: 1,
          snapshot: input as unknown as Prisma.InputJsonValue,
          reason: proposalId,
        },
      });
      proposalRowId = created.id;
    }
    return {
      proposalId,
      id: proposalRowId,
      expectedVersion: input.expectedVersion,
      operations: input.operations,
      // 对话内采用闭环：不要把确认推给面板操作（2026-09-25 作者反馈的断流问题）
      message: `规划建议已保存为候选（提案ID=${proposalRowId}），当前规划未改变。立即用 askUserQuestion 列出要点请作者确认（选项如：采用这份提案 / 需要调整）；作者明确同意后调用 applyNovelPlanningProposal 落入作品并继续后续挂载，不要把确认推给面板操作。`,
    };
  });
}
export async function planningProposals(scope: StoryScope) {
  await ownedStory(scope);
  const rows = await prisma.contentVersion.findMany({
    where: { targetType: "PlanningProposal", targetId: scope.novelId },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  const receipts = await prisma.contentMutation.findMany({
    where: {
      userId: scope.userId,
      novelId: scope.novelId,
      targetType: "Planning",
    },
    select: { operationId: true },
  });
  const used = new Set(receipts.map((r) => r.operationId));
  return rows.filter(
    (r) => !used.has(planningMutationSchema.parse(r.snapshot).operationId),
  );
}
export async function applyPlanningProposal(scope: StoryScope, id: string) {
  await ownedStory(scope);
  const proposal = await prisma.contentVersion.findFirst({
    where: { id, targetType: "PlanningProposal", targetId: scope.novelId },
  });
  if (!proposal)
    throw new ContentError("PROPOSAL_NOT_FOUND", "建议不存在", 404);
  return mutatePlanning(scope, proposal.snapshot);
}

/** 提案涉及的线索引摘要（AI 引用与作者确认用）：集合名 + 标题/名称/ID。 */
function summarizePlanningOperations(operations: PlanningOperation[]) {
  return operations.map((op) => {
    if (op.kind === "put") {
      const value = op.value as { title?: string; name?: string; id?: string };
      return `${op.collection}:${value.title ?? value.name ?? value.id ?? "?"}`;
    }
    return `${op.kind}:${op.id}`;
  });
}

/** 待采用提案的 AI 可读摘要（id 即 applyNovelPlanningProposal 的入参）。 */
export async function pendingPlanningProposals(scope: StoryScope) {
  const rows = await planningProposals(scope);
  if (!rows.length) return [];
  const current = await prisma.planningDocument.findUnique({
    where: { novelId: scope.novelId }, select: { version: true },
  });
  return rows.flatMap((row) => {
    const snapshot = planningMutationSchema.parse(row.snapshot);
    // 已过期的候选仍留在历史面板，但不能成为下一步采用任务。
    if (snapshot.expectedVersion !== (current?.version ?? 0)) return [];
    return [{
      id: row.id,
      expectedVersion: snapshot.expectedVersion,
      createdAt: row.createdAt,
      operationCount: snapshot.operations.length,
      targets: summarizePlanningOperations(snapshot.operations),
    }];
  });
}

/**
 * 收尾安全网：本轮新提案优先确认；无本轮提案时可查全部有效候选。
 * 与 nextStoryApproval 同风格；只有提案、没有交互载荷——作者回答后由模型调 applyNovelPlanningProposal 落入。
 */
export async function nextPlanningProposalApproval(scope: StoryScope, proposalId?: string) {
  const pending = (await pendingPlanningProposals(scope)).filter(row => !proposalId || row.id === proposalId);
  if (!pending.length) return null;
  const latest = pending[0];
  const summary = latest.targets.slice(0, 4).join("、");
  return {
    questions: [
      {
        question: `有 ${pending.length} 份世界线/叙事线规划提案待采用。本次确认提案 ${latest.id}（${summary}），是否采用并继续？`,
        options: ["采用并继续推进", "先不采用，我要调整"],
      },
    ],
    focus: { kind: "planning" as const, id: scope.novelId, title: "规划提案待采用" },
  };
}
