"use client"

import { useChatStore } from "./chat"
import { useSceneUiStore } from "./scene-ui"
import { create, type StateCreator } from "zustand"

import {
  STAGED_SAVE_ENABLED,
  buildSyntheticCreated,
  buildSyntheticReceipt,
  deriveStagedItems,
  deriveStagedOpItem,
  firstControl,
  matchStagedPattern,
  stagedDataFields,
  stagedFieldLabel,
  stagedTargetName,
  STAGED_DELETE_RECEIPT,
  type StagedBatchPayload,
  type StagedChange,
  type StagedChangeItem,
} from "@/lib/staged-save"

/**
 * 三阶段保存 · 暂存仓（zustand）。
 * 阶段一：apiSend 拦截写请求 → record 进 batches（按面板 batchKey 聚合）；
 * 阶段二：confirm 生成 chip（composer 气泡）；revert 撤销并 revertNonce++ 强制面板重挂载；
 * 阶段三：takeForSend 取出载荷随对话请求上行，接受后 markSent 清除。
 */

export interface StagedBatch {
  batchKey: string
  novelId: string
  /** 气泡 XXX：面板/对象名（tab 标题或目标名） */
  label: string
  changes: StagedChange[]
  phase: "editing" | "chipped"
  revertNonce: number
}

export interface StagedChip {
  batchKey: string
  novelId: string
  label: string
  count: number
  items: StagedChangeItem[]
  createdAt: number
}

interface StagedSendRequest {
  batchKey: string
  novelId: string
  nonce: number
}

interface StagedState {
  batches: Record<string, StagedBatch>
  chips: StagedChip[]
  /** 面板 [发送] 桥：ChatPanel 订阅消费（同 newConversationRequested 模式） */
  sendRequest: StagedSendRequest | null

  record: (batchKey: string, novelId: string, label: string, change: StagedChange) => void
  confirm: (batchKey: string) => void
  revert: (batchKey: string) => void
  discardTarget: (novelId: string, targetId: string) => void
  chipsFor: (novelId: string | null) => StagedChip[]
  batchFor: (batchKey: string) => StagedBatch | undefined
  requestStagedSend: (batchKey: string, novelId: string) => void
  clearStagedSend: () => void
  takeForSend: (novelId: string | null) => StagedBatchPayload[]
  markSent: (batchKeys: string[], sentBatches?: StagedBatchPayload[], onlyScenes?: boolean) => void
}

const sumItems = (changes: StagedChange[]) => changes.reduce((n, c) => n + c.items.length, 0)

const stagedStore: StateCreator<StagedState> = (set, get) => ({
  batches: {},
  chips: [],
  sendRequest: null,

  record: (batchKey, novelId, label, change) =>
    set(s => {
      const prev = s.batches[batchKey]
      const others = (prev?.changes ?? []).filter(
        c => !(c.targetKind === change.targetKind && c.targetId === change.targetId && c.op === change.op)
      )
      const prior = (prev?.changes ?? []).find(
        c => c.targetKind === change.targetKind && c.targetId === change.targetId && c.op === change.op
      )
      // 同目标同操作合并：items 按 key 去重（同字段反复改记 1 处）；请求体数据字段用最新一帧
      // （落库执行器按它取数据），控制字段保留首帧（其值才是真实服务端版本/基线）
      const mergedItems = [...(prior?.items ?? [])]
      for (const item of change.items) {
        const idx = mergedItems.findIndex(i => i.key === item.key)
        if (idx >= 0) mergedItems[idx] = { ...mergedItems[idx], after: item.after }
        else mergedItems.push(item)
      }
      const merged: StagedChange = prior
        ? {
            ...change,
            request: {
              ...change.request,
              body: {
                ...(change.request.body !== null && typeof change.request.body === "object" ? change.request.body : {}),
                ...firstControl(prior.request.body),
              },
            },
            items: mergedItems,
            updatedAt: change.updatedAt,
          }
        : change
      const changes = [...others, merged]
      return {
        batches: {
          ...s.batches,
          [batchKey]: {
            batchKey,
            novelId,
            label,
            changes,
            phase: prev?.phase ?? "editing",
            revertNonce: prev?.revertNonce ?? 0,
          },
        },
      }
    }),

  confirm: batchKey =>
    set(s => {
      const batch = s.batches[batchKey]
      if (!batch || sumItems(batch.changes) === 0) return s
      const chip: StagedChip = {
        batchKey,
        novelId: batch.novelId,
        label: batch.label,
        count: sumItems(batch.changes),
        items: batch.changes.flatMap(c => c.items),
        createdAt: Date.now(),
      }
      return {
        batches: { ...s.batches, [batchKey]: { ...batch, phase: "chipped" } },
        chips: [...s.chips.filter(c => c.batchKey !== batchKey), chip],
      }
    }),

  revert: batchKey =>
    set(s => {
      const batch = s.batches[batchKey]
      const ids = new Set(batch?.changes.filter(c => c.targetKind === "SCENE").map(c => c.targetId))
      const sceneStore = useSceneUiStore.getState()
      for (const [key, draft] of Object.entries(sceneStore.drafts)) if (draft.value.novelId === batch?.novelId && ids.has(draft.value.id)) sceneStore.setDraft(key, null)
      // 撤销后影子快照（含已撤销的暂存值）作废：下次编辑必须从服务端真稿重新取基座
      snapshotCache.clear()
      return {
        batches: batch
          ? { ...s.batches, [batchKey]: { ...batch, changes: [], phase: "editing" as const, revertNonce: batch.revertNonce + 1 } }
          : s.batches,
        chips: s.chips.filter(c => c.batchKey !== batchKey),
      }
    }),

  discardTarget: (novelId, targetId) => set(s => {
    snapshotCache.clear()
    const batches = {...s.batches}
    for(const [key, batch] of Object.entries(batches)) if(batch.novelId === novelId) batches[key] = {...batch, changes: batch.changes.filter(c => !(c.targetKind === "SCENE" && c.targetId === targetId))}
    return {batches, chips: s.chips.flatMap(chip => {const batch = batches[chip.batchKey]; if (!batch?.changes.length) return []; return [{...chip, count: sumItems(batch.changes), items: batch.changes.flatMap(c => c.items)}]})}
  }),

  chipsFor: novelId => get().chips.filter(c => !novelId || c.novelId === novelId),
  batchFor: batchKey => get().batches[batchKey],

  requestStagedSend: (batchKey, novelId) =>
    set(s => ({ sendRequest: { batchKey, novelId, nonce: (s.sendRequest?.nonce ?? 0) + 1 } })),
  clearStagedSend: () => set({ sendRequest: null }),

  takeForSend: novelId =>
    get()
      .chips.filter(c => !novelId || c.novelId === novelId)
      .flatMap(chip => {
        const batch = get().batches[chip.batchKey]
        if (!batch || batch.changes.length === 0) return []
        return [{ batchKey: chip.batchKey, novelId: chip.novelId, label: chip.label, changes: batch.changes } satisfies StagedBatchPayload]
      }),

  markSent: (batchKeys, sentBatches, onlyScenes = false) => set(s => {
    const batches = {...s.batches}
    const accountId = useChatStore.getState().accountId
    for (const key of batchKeys) {
      const batch = batches[key]
      const sent = sentBatches?.find(b => b.batchKey === key) ?? batch
      if (!sent) continue
      const sceneChanges = sent.changes.filter(c => c.targetKind === "SCENE")
      if (onlyScenes && sceneChanges.length && accountId) {
        const token = sceneChanges.map(c => firstControl(c.request.body).operationId).join(":")
        useSceneUiStore.getState().setSubmission(`${accountId}:${key}:${token}`, {accountId, batch: {...sent, changes: sceneChanges}})
      }
      if (!batch) continue
      const remaining = batch.changes.filter(c => !sent.changes.some(old => old.targetKind === c.targetKind && old.targetId === c.targetId && old.op === c.op && old.updatedAt === c.updatedAt && JSON.stringify(old.request.body) === JSON.stringify(c.request.body) && (!onlyScenes || c.targetKind === "SCENE")))
      if (remaining.length) batches[key] = {...batch, changes: remaining}
      else delete batches[key]
    }
    return {batches, chips: s.chips.flatMap(chip => {const batch = batches[chip.batchKey]; return batch ? [{...chip, count: sumItems(batch.changes), items: batch.changes.flatMap(c => c.items)}] : []})}
  }),
})

export const useStagedChangesStore = create<StagedState>()(stagedStore)

/* ============================== apiSend 拦截层 ============================== */

/** 面板侧补充上下文：tab id 与对象名由调用方（StagedSaveSurface 经上下文）或 tabs store 解析；body 用于世界下设定等需要请求体判定归属表盘的场景 */
export interface StagedInterceptionContext {
  resolveBatch: (
    match: NonNullable<ReturnType<typeof matchStagedPattern>>,
    body?: unknown
  ) => { batchKey: string; label: string }
  snapshot?: (url: string, envelope: string) => Promise<unknown>
}

let interceptionContext: StagedInterceptionContext | null = null

/** 由 StagedSaveSurface 的 Provider 注册一次（dashboard 挂载点） */
export function registerStagedInterception(ctx: StagedInterceptionContext | null) {
  interceptionContext = ctx
  // 拦截上下文更换（重注册/卸载）时影子同步失效：快照必须按新上下文重取
  if (!ctx) snapshotCache.clear()
}

/** 开发排障：浏览器 console 里 __stagedDebug.state() 看拦截上下文与影子快照键 */
export function stagedDebugState() {
  return {
    hasContext: !!interceptionContext,
    hasSnapshotFn: !!interceptionContext?.snapshot,
    snapshotCacheKeys: [...snapshotCache.keys()],
  }
}

const snapshotCache = new Map<string, Promise<unknown>>()

async function fetchSnapshot(url: string, envelope: string): Promise<unknown> {
  const res = await fetch(url)
  if (!res.ok) return undefined
  const data = (await res.json()) as Record<string, unknown>
  return data?.[envelope]
}

/** 影子基座累积暂存内容；版本令牌始终来自实际落库快照。 */
function stagedSnapshot(url: string, envelope: string): Promise<unknown> {
  const key = `${url}#${envelope}`
  if (!snapshotCache.has(key)) {
    // 上下文快照（React Query 缓存，多数白名单路由无 GET）优先；拿不到回退 GET 直取
    const seed = (async () => {
      const fromCtx = interceptionContext?.snapshot
        ? await interceptionContext.snapshot(url, envelope).catch(() => undefined)
        : undefined
      if (fromCtx !== undefined && fromCtx !== null) return fromCtx
      return fetchSnapshot(url, envelope).catch(() => undefined)
    })()
    snapshotCache.set(key, seed)
    return seed
  }
  return snapshotCache.get(key)!
}

/**
 * apiSend 的唯一钩子：命中白名单则零网络暂存并返回合成回执；未命中返回 null 走原 fetch。
 * 无注册上下文（非 dashboard 环境）时短路放行。
 */
export async function tryStageRequest(
  url: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: unknown
): Promise<Record<string, unknown> | null> {
  if (!STAGED_SAVE_ENABLED) return null
  const match = matchStagedPattern(url, method)
  if (!match) return null
  const { pattern, novelId, params } = match

  const store = useStagedChangesStore.getState()
  const { batchKey, label } = interceptionContext?.resolveBatch(match, body) ?? fallbackBatch(match)

  // ---- 删除：记一条 delete 修改，合成 { ok: true } ----
  if (pattern.op === "delete") {
    const targetId = Object.values(params)[0] ?? url
    const targetLabel = label
    store.record(batchKey, novelId, label, {
      targetKind: pattern.kind,
      targetId,
      targetLabel,
      novelId,
      op: "delete",
      request: { url, method, body: pattern.kind === "SCENE" ? {...(body as Record<string, unknown>), ...firstControl(store.batches[batchKey]?.changes.find(c => c.targetKind === "SCENE" && c.targetId === targetId && c.op === "modify")?.request.body), operationId: (body as Record<string, unknown>)?.operationId} : body },
      items: [deriveStagedOpItem({ kind: pattern.kind, targetId, targetLabel, op: "delete" })],
      updatedAt: Date.now(),
    })
    return { ...STAGED_DELETE_RECEIPT }
  }

  // ---- 创建：占位 id 合成实体；暂存期再 PATCH 占位实体时合并进同一条 create ----
  if (pattern.op === "create") {
    const placeholderId = `staged-${crypto.randomUUID()}`
    const data = stagedDataFields(body)
    const name = stagedTargetName(data, pattern.kindLabel)
    store.record(batchKey, novelId, label, {
      targetKind: pattern.kind,
      targetId: placeholderId,
      targetLabel: name,
      novelId,
      op: "create",
      request: { url, method, body },
      items: [
        deriveStagedOpItem({ kind: pattern.kind, targetId: placeholderId, targetLabel: name, op: "create", body }),
        ...deriveStagedItems({ kind: pattern.kind, targetId: placeholderId, targetLabel: name, kindLabel: pattern.kindLabel, body }).filter(i => i.field !== "name" && i.field !== "title"),
      ],
      updatedAt: Date.now(),
    })
    return buildSyntheticCreated({ body, envelope: pattern.envelope!, placeholderId, extra: { novelId } })
  }

  // ---- 修改：占位 id（暂存期创建的实体）合并进 create 批次，不产生第二条 ----
  const targetId = Object.values(params).find(v => v.startsWith("staged-"))
  if (targetId) {
    const batch = store.batches[batchKey]
    const createChange = batch?.changes.find(c => c.targetId === targetId && c.op === "create")
    if (createChange) {
      const mergedBody = { ...stagedDataFields(createChange.request.body), ...stagedDataFields(body) }
      const name = stagedTargetName(mergedBody, createChange.targetLabel)
      store.record(batchKey, novelId, label, {
        ...createChange,
        targetLabel: name,
        request: { ...createChange.request, body: { ...(typeof createChange.request.body === "object" && createChange.request.body ? createChange.request.body : {}), ...stagedDataFields(body) } },
        items: [
          deriveStagedOpItem({ kind: pattern.kind, targetId, targetLabel: name, op: "create" }),
          ...deriveStagedItems({ kind: pattern.kind, targetId, targetLabel: name, kindLabel: pattern.kindLabel, body: mergedBody }).filter(i => i.field !== "name" && i.field !== "title"),
        ],
        updatedAt: Date.now(),
      })
      const synthetic = buildSyntheticReceipt({ snapshot: { id: targetId, version: 1, novelId }, body, envelope: pattern.envelope! })
      return synthetic
    }
  }

  // ---- 常规修改：GET 快照 → 影子合并 → 合成回执 ----
  const snapshot = await stagedSnapshot(url, pattern.envelope!)
  if (pattern.kind === "SCENE" && (snapshot == null || typeof snapshot !== "object" || !("version" in snapshot))) {snapshotCache.delete(`${url}#${pattern.envelope!}`); throw new Error("无法读取场景基线，草稿已保留，请重试")}
  const name = stagedTargetName(stagedDataFields(body).name ? stagedDataFields(body) : snapshot, label)
  const items = deriveStagedItems({
    kind: pattern.kind,
    targetId: Object.values(params)[0] ?? url,
    targetLabel: name,
    kindLabel: pattern.kindLabel,
    body,
    before: snapshot,
  })
  if (items.length === 0) {
    // 与影子基座一致的冗余整表单保存（如物品功效半填行被保存载荷过滤后）：
    // 批次存续期放行会把暂存内容提前落库，吞掉并回影子回执；
    // 无数据字段的纯控制请求与无暂存批次的场景保持直连（重命名立即落库语义不变）。
    const targetId = Object.values(params)[0] ?? url
    const hasDataFields = Object.keys(stagedDataFields(body)).length > 0
    const hasStagedModify = store.batches[batchKey]?.changes.some(
      c => c.targetKind === pattern.kind && c.targetId === targetId && c.op === "modify"
    )
    if (hasDataFields && hasStagedModify && snapshot !== undefined) {
      return buildSyntheticReceipt({ snapshot, body, envelope: pattern.envelope! })
    }
    return null
  }
  store.record(batchKey, novelId, label, {
    targetKind: pattern.kind,
    targetId: Object.values(params)[0] ?? url,
    targetLabel: name,
    novelId,
    op: "modify",
    request: { url, method, body },
    items,
    updatedAt: Date.now(),
  })
  const receipt = buildSyntheticReceipt({ snapshot, body, envelope: pattern.envelope! })
  // 下一次拦截沿用本次影子内容，保留首次真实版本令牌。
  snapshotCache.set(`${url}#${pattern.envelope!}`, Promise.resolve(receipt[pattern.envelope!]))
  return receipt
}

function fallbackBatch(match: NonNullable<ReturnType<typeof matchStagedPattern>>): { batchKey: string; label: string } {
  const t = match.pattern.tab(match.params, match.novelId)
  return { batchKey: `${t.type}:${t.refId ?? match.novelId}`, label: match.pattern.kindLabel }
}

/** 供 StagedSaveSurface 展示：批次计数与摘要 */
export function stagedBatchCount(batch: StagedBatch | undefined): number {
  return batch ? sumItems(batch.changes) : 0
}

export { stagedFieldLabel }
