import type { DesktopSaveCoordinator } from "./save-coordinator"
import type { DraftSnapshot } from "../../../desktop/shared/drafts"
import type { ChatSessionStorage } from "../chat-session"
import { desktopWorkspaceDraftSource, type WorkspaceDraftSource } from "./workspace-draft-source"
import { z } from "zod"
import { workspaceLayoutSchema, workspaceTabSchema, type WorkspaceDraft } from "./workspace-draft-source"
import { useStagedChangesStore, type StagedBatch, type StagedChip } from "../../stores/staged-changes"
import { useSceneUiStore, type SceneDraft } from "../../stores/scene-ui"
import { stagedChangeSchema, matchStagedPattern } from "../staged-save"
import { chatSessionEntrySchema, chatSessionSnapshotSchema, chatSessionKey, type ChatSessionEntry } from "../chat-session"
import type { Tab } from "../../stores/tabs"
import { commentDraftSchema, commentDraftStoreFor } from "../comment-drafts"
import { prepareDisabledSessionCaches } from "./disabled-session-caches"

export type RecoveryTargetKind = "NOVEL" | "THEME" | "WORLD" | "SETTING" | "CHARACTER" | "ITEM" | "SCENE" | "TROPE" | "ATTRIBUTE" | "FORESHADOW" | "CHAPTER_CONTENT" | "CHAPTER_OUTLINE" | "VOLUME_OUTLINE" | "CHAPTER_CANDIDATE" | "SUBAGENT" | "SCENARIO"
export interface RecoveryTarget { novelId: string; kind: RecoveryTargetKind; id?: string; chapterId?: string }
export type RecoveryReason = "RESTORE_DISABLED" | "WORK_RESTORED" | "APPLICATION_RESTORED" | "AUTOSAVE_UNMATCHED" | "EXECUTION_METADATA" | "INVALID_DATA" | "TARGET_UNAVAILABLE" | "ACCOUNT_MISMATCH" | "STORAGE_UNAVAILABLE" | "UNKNOWN_SOURCE" | "SOURCE_UNREADABLE" | "CURRENT_DRAFT_CONFLICT"
export interface RecoveryItem { id: string; source: string; path: string; reason: RecoveryReason; createdAt: string; value: unknown }
export interface RecoveryDraft { version: 1; items: RecoveryItem[] }
/** Retained data has no save closure, request dispatcher, timer or execution API. */
export class DesktopRecoveryStore {
  private items = new Map<string, RecoveryItem>()
  private fingerprints = new Set<string>()
  private listeners = new Set<() => void>()
  read(): RecoveryDraft { return { version: 1, items: structuredClone([...this.items.values()]) } }
  retain(items: RecoveryItem[]) {
    let changed = false
    for (const item of items) {
      const fingerprint = JSON.stringify([item.source, item.path, item.reason, item.value])
      if (this.fingerprints.has(fingerprint)) continue
      this.fingerprints.add(fingerprint)
      // A retry can reuse an origin while input has changed. Keep both copies;
      // never let an origin-ID collision discard a different author's draft.
      const id = this.items.has(item.id) ? `${item.id}:${crypto.randomUUID()}` : item.id
      this.items.set(id, structuredClone({ ...item, id })); changed = true
    }
    if (changed) for (const listener of this.listeners) listener()
  }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
}
export const desktopRecoveryStore = new DesktopRecoveryStore()
export interface RestoreDesktopDraftOptions {
  restoreSession: boolean; disabledReason?: "RESTORE_DISABLED" | "WORK_RESTORED" | "APPLICATION_RESTORED"; accountId: string; storage: ChatSessionStorage | null
  verifyTarget?(target: RecoveryTarget): boolean | Promise<boolean>
  signal?: AbortSignal; recovery?: DesktopRecoveryStore; workspace?: WorkspaceDraftSource
}
export interface DesktopRecoverySummary { applied: { staged: number; scene: number; chat: number; workspace: number; comments: number }; retained: number; issues: Array<{ source: string; reason: RecoveryReason }>; layoutPending: boolean; requiresCheckpoint: boolean; afterCheckpoint?(): void }
const record = z.record(z.string(), z.unknown())
const batchSchema = z.object({ batchKey: z.string().min(1).max(200), novelId: z.string().min(1).max(80), label: z.string().min(1).max(160), changes: z.array(stagedChangeSchema).min(1).max(40), phase: z.enum(["editing", "chipped"]), revertNonce: z.number().int().nonnegative() }).strict()
const chipSchema = z.object({ batchKey: z.string(), novelId: z.string(), label: z.string(), count: z.number().int().positive(), items: stagedChangeSchema.shape.items, createdAt: z.number().int().nonnegative() }).strict()
const sceneRecordSchema = z.object({ id: z.string().min(1), novelId: z.string().min(1), name: z.string().min(1), parentId: z.string().nullable(), version: z.number().int().positive(), description: z.string(), coordinates: z.string(), attributes: z.unknown(), backstory: z.string(), entryMethod: z.string(), exteriorDescription: z.string(), interiorDescription: z.string(), factionSettingId: z.string().nullable(), factionId: z.string().nullable(), factionNameSnapshot: z.string().nullable(), exteriorImageUrl: z.string().nullable(), interiorImageUrl: z.string().nullable(), exteriorImageRevision: z.number().int().nonnegative(), interiorImageRevision: z.number().int().nonnegative(), createdAt: z.string(), updatedAt: z.string() }).strict()
const sceneDraftSchema = z.object({ value: sceneRecordSchema, baseline: z.number().int().positive(), operationId: z.string().optional(), saved: z.boolean().optional() }).strict()
const imageDraftSchema = z.object({ prompt: z.string().max(4000), modelId: z.string(), revision: z.number().int().nonnegative().optional() }).strict()
const reasons = ["RESTORE_DISABLED", "WORK_RESTORED", "APPLICATION_RESTORED", "AUTOSAVE_UNMATCHED", "EXECUTION_METADATA", "INVALID_DATA", "TARGET_UNAVAILABLE", "ACCOUNT_MISMATCH", "STORAGE_UNAVAILABLE", "UNKNOWN_SOURCE", "SOURCE_UNREADABLE", "CURRENT_DRAFT_CONFLICT"] as const
const retainedSchema = z.object({ version: z.literal(1), items: z.array(z.object({ id: z.string().min(1), source: z.string(), path: z.string(), reason: z.enum(reasons), createdAt: z.string(), value: z.unknown() }).strict()) }).strict()
const workspaceEnvelope = z.object({ version: z.literal(1), tabs: z.array(z.unknown()).max(4096), activeTabId: z.string().nullable(), subTabs: z.record(z.string(), z.string()), layout: z.unknown().nullable() }).strict()
const saveAttemptSchema = z.object({ value: z.unknown(), revision: z.number().int().nonnegative(), operationId: z.string().min(1) }).strict().nullable()
const autosaveSnapshotSchema = z.object({ revision: z.number().int().nonnegative(), status: z.enum(["idle", "pending", "saving", "saved", "error"]), paused: z.boolean(), pending: saveAttemptSchema, failed: saveAttemptSchema, inFlight: saveAttemptSchema, latest: saveAttemptSchema }).strict()
function tabTarget(tab: Tab): RecoveryTarget {
  const entityKinds: Partial<Record<Tab["type"], RecoveryTargetKind>> = { world: "WORLD", character: "CHARACTER", "character-image": "CHARACTER", item: "ITEM", "item-image": "ITEM", scene: "SCENE", "scene-image": "SCENE", "chapter-content": "CHAPTER_CONTENT", "chapter-outline": "CHAPTER_OUTLINE", "chapter-candidate": "CHAPTER_CANDIDATE", subagent: "SUBAGENT", scenario: "SCENARIO" }
  const kind = entityKinds[tab.type]
  return kind ? { novelId: tab.novelId, kind, id: tab.refId, ...(tab.chapterId ? { chapterId: tab.chapterId } : {}) } : { novelId: tab.novelId, kind: "NOVEL" }
}
/** Runs before editable UI mounts. Verify reads are trusted local reads only.
 * No transport, replay, approval, confirm, retry, or markSent is available here. */
export async function restoreDesktopDraft(snapshot: DraftSnapshot | null, options: RestoreDesktopDraftOptions): Promise<DesktopRecoverySummary> {
  const recovery = options.recovery ?? desktopRecoveryStore, workspace = options.workspace ?? desktopWorkspaceDraftSource
  const result: DesktopRecoverySummary = { applied: { staged: 0, scene: 0, chat: 0, workspace: 0, comments: 0 }, retained: 0, issues: [], layoutPending: false, requiresCheckpoint: false }
  const disabledReason = options.disabledReason ?? "RESTORE_DISABLED"
  const assertActive = () => { if (options.signal?.aborted) throw new DOMException("恢复已取消", "AbortError") }
  assertActive()
  if (!options.restoreSession) {
    const disabled = prepareDisabledSessionCaches(options.accountId, options.storage, workspace, options.signal), createdAt = snapshot?.createdAt ?? new Date().toISOString()
    recovery.retain(disabled.archives.map(archive => ({ id: JSON.stringify([createdAt, snapshot?.revision ?? 0, archive.source, archive.path]), ...archive, createdAt, reason: disabledReason })))
    result.requiresCheckpoint = disabled.archives.length > 0 || !!snapshot
    result.afterCheckpoint = disabled.afterCheckpoint
  }
  if (!snapshot) return { ...result, retained: recovery.read().items.length }
  const retained: RecoveryItem[] = [], commits: Array<() => void> = [], checks = new Map<string, Promise<boolean>>()
  const keep = (source: string, path: string, value: unknown, reason: RecoveryReason) => {
    const id = JSON.stringify([snapshot.createdAt, snapshot.revision, source, path])
    retained.push({ id, source, path, value: structuredClone(value), reason, createdAt: snapshot.createdAt }); result.issues.push({ source, reason })
  }
  const verify = async (target: RecoveryTarget) => {
    assertActive(); const key = JSON.stringify(target)
    if (!checks.has(key)) checks.set(key, Promise.resolve().then(() => { assertActive(); return options.verifyTarget?.(target) ?? false }).catch(() => false))
    const pending = checks.get(key)!
    const ok = options.signal ? await new Promise<boolean>((resolve, reject) => {
      const signal = options.signal!, abort = () => { signal.removeEventListener("abort", abort); reject(new DOMException("恢复已取消", "AbortError")) }
      signal.addEventListener("abort", abort, { once: true })
      if (signal.aborted) { abort(); return }
      pending.then(value => { signal.removeEventListener("abort", abort); if (!signal.aborted) resolve(value) }, reject)
    }) : await pending
    assertActive(); return ok === true
  }
  // Carry prior retained items directly, never put an old snapshot inside itself.
  if (snapshot.sources.recovery !== undefined) { const parsed = retainedSchema.safeParse(snapshot.sources.recovery); if (parsed.success) retained.push(...parsed.data.items); else keep("recovery", "invalid", snapshot.sources.recovery, "INVALID_DATA") }
  for (const item of snapshot.autosaves) keep("autosaves", item.id, item.draft, !options.restoreSession ? disabledReason : autosaveSnapshotSchema.safeParse(item.draft).success ? "AUTOSAVE_UNMATCHED" : "INVALID_DATA")
  for (const issue of snapshot.issues) keep(issue.source, "unreadable", issue, "SOURCE_UNREADABLE")
  for (const [source, raw] of Object.entries(snapshot.sources)) {
    if (source === "recovery") continue
    assertActive()
    if (!options.restoreSession) { keep(source, "source", raw, disabledReason); continue }
    if (source === "staged") {
      const parsed = z.object({ batches: record, chips: z.array(z.unknown()) }).strict().safeParse(raw)
      if (!parsed.success) { keep(source, "source", raw, "INVALID_DATA"); continue }
      const batches: Record<string, StagedBatch> = {}, chips: StagedChip[] = []
      for (const [key, value] of Object.entries(parsed.data.batches)) {
        const batch = batchSchema.safeParse(value)
        if (!batch.success || batch.data.batchKey !== key) { keep(source, key, value, "INVALID_DATA"); continue }
        let valid = true
        for (const change of batch.data.changes) {
          try {
            const match = matchStagedPattern(change.request.url, change.request.method)
            if (!match || /[?#]|\/\//.test(change.request.url) || match.pattern.kind !== change.targetKind || match.pattern.op !== change.op || match.novelId !== batch.data.novelId || change.novelId !== batch.data.novelId || change.op === "create" && !change.targetId.startsWith("staged-") || change.op !== "create" && change.targetId !== (Object.values(match.params)[0] ?? change.novelId)) valid = false
          } catch { valid = false }
        }
        const matching = parsed.data.chips.filter(value => typeof value === "object" && value !== null && (value as { batchKey?: unknown }).batchKey === key)
        const items = batch.data.changes.flatMap(change => change.items), chip = matching.length === 1 ? chipSchema.safeParse(matching[0]) : null
        if (batch.data.phase === "chipped" && (!chip?.success || chip.data.novelId !== batch.data.novelId || chip.data.label !== batch.data.label || chip.data.count !== items.length || JSON.stringify(chip.data.items) !== JSON.stringify(items)) || batch.data.phase === "editing" && matching.length) valid = false
        if (!valid) { keep(source, key, value, "INVALID_DATA"); continue }
        let available = true
        for (const change of batch.data.changes) if (!await verify(change.op === "create" ? { novelId: change.novelId, kind: "NOVEL" } : { novelId: change.novelId, kind: change.targetKind, id: change.targetId })) available = false
        if (!available) { keep(source, key, value, "TARGET_UNAVAILABLE"); continue }
        batches[key] = batch.data; if (chip?.success) chips.push(chip.data)
      }
      for (const chip of parsed.data.chips) if (!chips.some(existing => JSON.stringify(existing) === JSON.stringify(chip))) keep(source, `chip:${JSON.stringify(chip)}`, chip, "INVALID_DATA")
      commits.push(() => {
        const state = useStagedChangesStore.getState(), accepted: Record<string, StagedBatch> = {}
        for (const [key, batch] of Object.entries(batches)) if (state.batches[key] && JSON.stringify(state.batches[key]) !== JSON.stringify(batch)) keep(source, key, batch, "CURRENT_DRAFT_CONFLICT"); else accepted[key] = batch
        useStagedChangesStore.setState({ batches: { ...state.batches, ...accepted }, chips: [...state.chips.filter(chip => !accepted[chip.batchKey]), ...chips.filter(chip => accepted[chip.batchKey])] })
        result.applied.staged += Object.keys(accepted).length
      })
    } else if (source === "scene") {
      const parsed = z.object({ drafts: record.optional(), imageDrafts: record.optional(), imageRequests: record.optional(), submissions: record.optional(), commitErrors: record.optional() }).strict().safeParse(raw)
      if (!parsed.success) { keep(source, "source", raw, "INVALID_DATA"); continue }
      const drafts: Record<string, SceneDraft> = {}, imageDrafts: Record<string, z.infer<typeof imageDraftSchema>> = {}, commitErrors: Record<string, string> = {}
      for (const [key, value] of Object.entries(parsed.data.drafts ?? {})) {
        const draft = sceneDraftSchema.safeParse(value)
        if (!draft.success || key !== `${options.accountId}:${draft.data.value.novelId}:draft:${draft.data.value.id}`) { keep(source, `draft:${key}`, value, "INVALID_DATA"); continue }
        if (!await verify({ novelId: draft.data.value.novelId, kind: "SCENE", id: draft.data.value.id })) { keep(source, `draft:${key}`, value, "TARGET_UNAVAILABLE"); continue }
        drafts[key] = draft.data
      }
      for (const [key, value] of Object.entries(parsed.data.imageDrafts ?? {})) {
        const draft = imageDraftSchema.safeParse(value), parts = key.startsWith(`${options.accountId}:`) ? key.slice(options.accountId.length + 1).split(":") : []
        if (!draft.success || parts.length !== 3 || !["exterior", "interior"].includes(parts[2]) || !parts[0] || !parts[1]) { keep(source, `image:${key}`, value, "INVALID_DATA"); continue }
        if (!await verify({ novelId: parts[0], kind: "SCENE", id: parts[1] })) { keep(source, `image:${key}`, value, "TARGET_UNAVAILABLE"); continue }
        imageDrafts[key] = draft.data
      }
      for (const [key, value] of Object.entries(parsed.data.commitErrors ?? {})) if (drafts[key] && typeof value === "string") commitErrors[key] = value; else keep(source, `error:${key}`, value, "INVALID_DATA")
      if (Object.keys(parsed.data.imageRequests ?? {}).length) keep(source, "imageRequests", parsed.data.imageRequests, "EXECUTION_METADATA")
      if (Object.keys(parsed.data.submissions ?? {}).length) keep(source, "submissions", parsed.data.submissions, "EXECUTION_METADATA")
      commits.push(() => {
        const state = useSceneUiStore.getState(), acceptedDrafts: typeof drafts = {}, acceptedImages: typeof imageDrafts = {}
        for (const [key, draft] of Object.entries(drafts)) if (state.drafts[key] && JSON.stringify(state.drafts[key]) !== JSON.stringify(draft)) keep(source, `draft:${key}`, draft, "CURRENT_DRAFT_CONFLICT"); else acceptedDrafts[key] = draft
        for (const [key, draft] of Object.entries(imageDrafts)) if (state.imageDrafts[key] && JSON.stringify(state.imageDrafts[key]) !== JSON.stringify(draft)) keep(source, `image:${key}`, draft, "CURRENT_DRAFT_CONFLICT"); else acceptedImages[key] = draft
        useSceneUiStore.setState({ drafts: { ...state.drafts, ...acceptedDrafts }, imageDrafts: { ...state.imageDrafts, ...acceptedImages }, commitErrors: { ...state.commitErrors, ...Object.fromEntries(Object.entries(commitErrors).filter(([key]) => acceptedDrafts[key])) } })
        result.applied.scene += Object.keys(acceptedDrafts).length + Object.keys(acceptedImages).length
      })
    } else if (source === "chat") {
      const parsed = z.object({ accountId: z.string().nullable(), active: chatSessionEntrySchema.nullable(), saved: chatSessionSnapshotSchema.nullable() }).strict().safeParse(raw)
      if (!parsed.success) { keep(source, "source", raw, "INVALID_DATA"); continue }
      if (parsed.data.accountId !== options.accountId) { keep(source, "source", raw, "ACCOUNT_MISMATCH"); continue }
      if (!options.storage) { keep(source, "source", raw, "STORAGE_UNAVAILABLE"); continue }
      let existing: z.infer<typeof chatSessionSnapshotSchema> | null = null, capturedRaw: string | null
      try { capturedRaw = options.storage.getItem(chatSessionKey(options.accountId)); if (capturedRaw !== null) existing = chatSessionSnapshotSchema.parse(JSON.parse(capturedRaw)) } catch { keep(source, "source", raw, "STORAGE_UNAVAILABLE"); continue }
      const drafts = { ...existing?.drafts }, incoming = { ...parsed.data.saved?.drafts }, accepted = new Set<string>()
      if (parsed.data.active) incoming[parsed.data.active.conversationId ?? parsed.data.active.draftId] = parsed.data.active
      for (const [key, entry] of Object.entries(incoming)) {
        if (key !== (entry.conversationId ?? entry.draftId)) { keep(source, `draft:${key}`, entry, "INVALID_DATA"); continue }
        if (drafts[key] && JSON.stringify(drafts[key]) !== JSON.stringify(entry)) { keep(source, `draft:${key}`, entry, "CURRENT_DRAFT_CONFLICT"); continue }
        drafts[key] = entry; accepted.add(key)
        if (entry.pendingRequest) { keep(source, `request:${key}`, entry.pendingRequest, "EXECUTION_METADATA"); drafts[key] = { ...entry, pendingRequest: null, wasRunning: true } }
      }
      const activeKey = existing?.activeKey ?? (parsed.data.active ? parsed.data.active.conversationId ?? parsed.data.active.draftId : parsed.data.saved?.activeKey)
      if (!activeKey || !drafts[activeKey]) { keep(source, "source", raw, "INVALID_DATA"); continue }
      const value = { version: 1 as const, activeKey, drafts }
      commits.push(() => {
        try {
          // A later source may have awaited target validation. This exact key
          // must still contain the bytes read above before restoring its draft.
          if (options.storage!.getItem(chatSessionKey(options.accountId)) !== capturedRaw) { keep(source, "source", raw, "CURRENT_DRAFT_CONFLICT"); return }
          if (accepted.size) options.storage!.setItem(chatSessionKey(options.accountId), JSON.stringify(value))
          result.applied.chat += accepted.size
        } catch { keep(source, "source", raw, "STORAGE_UNAVAILABLE") }
      })
    } else if (source === "comments") {
      const parsed = z.object({ accountId: z.string(), rows: z.array(z.unknown()) }).strict().safeParse(raw)
      if (!parsed.success) { keep(source, "source", raw, "INVALID_DATA"); continue }
      if (parsed.data.accountId !== options.accountId) { keep(source, "source", raw, "ACCOUNT_MISMATCH"); continue }
      if (!options.storage) { keep(source, "source", raw, "STORAGE_UNAVAILABLE"); continue }
      const rows: z.infer<typeof commentDraftSchema>[] = []
      for (const [index, value] of parsed.data.rows.entries()) {
        const row = commentDraftSchema.safeParse(value)
        if (!row.success) { keep(source, `row:${index}`, value, "INVALID_DATA"); continue }
        const kind = row.data.target.targetType === "CANDIDATE_CONTENT" ? "CHAPTER_CANDIDATE" : row.data.target.targetType
        if (!["CHAPTER_OUTLINE", "CHAPTER_CONTENT", "WORLD", "SETTING", "SCENE", "CHAPTER_CANDIDATE"].includes(kind) || !await verify({ novelId: row.data.target.novelId, kind: kind as RecoveryTargetKind, id: row.data.target.targetId })) { keep(source, `row:${index}`, value, "TARGET_UNAVAILABLE"); continue }
        rows.push(row.data)
      }
      commits.push(() => {
        const store = commentDraftStoreFor(options.accountId, () => options.storage!)!
        const restored = store.restore(rows)
        for (const row of restored.retained) keep(source, `row:${row.key}`, row, restored.failed ? "STORAGE_UNAVAILABLE" : "CURRENT_DRAFT_CONFLICT")
        result.applied.comments += restored.applied.length
      })
    } else if (source === "workspace") {
      const parsed = workspaceEnvelope.safeParse(raw)
      if (!parsed.success) { keep(source, "source", raw, "INVALID_DATA"); continue }
      const tabs: Tab[] = [], ids = new Set<string>()
      for (const value of parsed.data.tabs) {
        const tab = workspaceTabSchema.safeParse(value)
        if (!tab.success || ids.has(tab.data.id)) { keep(source, `tab:${JSON.stringify(value)}`, value, "INVALID_DATA"); continue }
        if (!await verify(tabTarget(tab.data))) { keep(source, `tab:${tab.data.id}`, value, "TARGET_UNAVAILABLE"); continue }
        tabs.push(tab.data); ids.add(tab.data.id)
      }
      const parsedLayout = workspaceLayoutSchema.nullable().safeParse(parsed.data.layout)
      if (!parsedLayout.success) keep(source, "layout", parsed.data.layout, "INVALID_DATA")
      const emptyContent = !tabs.length && parsedLayout.success && parsedLayout.data?.contentVisible
      if (emptyContent) keep(source, "layout", parsed.data.layout, "TARGET_UNAVAILABLE")
      const value: WorkspaceDraft = { version: 1, tabs, activeTabId: parsed.data.activeTabId && ids.has(parsed.data.activeTabId) ? parsed.data.activeTabId : tabs.at(-1)?.id ?? null, subTabs: Object.fromEntries(Object.entries(parsed.data.subTabs).filter(([key]) => ids.has(key))), layout: parsedLayout.success && !emptyContent ? parsedLayout.data : null }
      commits.push(() => { workspace.restore(value); result.applied.workspace += tabs.length })
    } else keep(source, "source", raw, "UNKNOWN_SOURCE")
  }
  assertActive()
  for (const commit of commits) { assertActive(); commit() }
  assertActive(); recovery.retain(retained); result.retained = recovery.read().items.length; result.layoutPending = workspace.layoutPending
  return result
}
export function installRecoveryDraftSource(coordinator: DesktopSaveCoordinator, store = desktopRecoveryStore) { return coordinator.registerSource("recovery", store) }
