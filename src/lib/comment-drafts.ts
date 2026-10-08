/** 评论草稿与聊天草稿分仓；账号、目标、完整锚点或线程 ID 都参与身份。 */
import { z } from "zod"
export interface DraftTarget { novelId: string; targetType: string; targetId: string }
export interface DraftAnchor { quote: string; startOffset?: number; endOffset?: number; prefix?: string; suffix?: string }
export interface CommentDraft { key: string; target: DraftTarget; anchor?: DraftAnchor; threadId?: string; content: string; updatedAt: number }
export type DraftStorage = Pick<Storage, "getItem" | "setItem">
export const commentDraftKey = (target: DraftTarget, anchor?: DraftAnchor, threadId?: string) =>
  JSON.stringify([target.novelId, target.targetType, target.targetId, threadId ?? null,
    anchor?.quote || null, anchor?.startOffset ?? null, anchor?.endOffset ?? null, anchor?.prefix ?? null, anchor?.suffix ?? null])
export const sameDraftTarget = (a: DraftTarget, b: DraftTarget) => a.novelId === b.novelId && a.targetType === b.targetType && a.targetId === b.targetId
export const commentDraftStorageKey = (accountId: string) => `comment-drafts:v1:${encodeURIComponent(accountId)}`
export const commentDraftSchema: z.ZodType<CommentDraft> = z.object({
  key: z.string(), target: z.object({ novelId: z.string().min(1), targetType: z.string().min(1), targetId: z.string().min(1) }).strict(),
  anchor: z.object({ quote: z.string(), startOffset: z.number().int().nonnegative().optional(), endOffset: z.number().int().nonnegative().optional(), prefix: z.string().optional(), suffix: z.string().optional() }).strict().optional(),
  threadId: z.string().min(1).optional(), content: z.string(), updatedAt: z.number().int().nonnegative(),
}).strict().refine(row => row.key === commentDraftKey(row.target, row.anchor, row.threadId))

export class CommentDraftStore {
  private rows = new Map<string, CommentDraft>()
  private listeners = new Set<() => void>()
  private revision = 0
  private retainedReset: { raw: string | null; signature: string } | null = null
  warning = ""
  readonly storageKey: string
  constructor(accountId: string, private storage: () => DraftStorage) {
    this.storageKey = commentDraftStorageKey(accountId)
    try {
      const raw = storage().getItem(this.storageKey)
      if (raw) {
        try {
          const parsed: unknown = JSON.parse(raw)
          if (!Array.isArray(parsed) || parsed.some(row => !row || typeof row.content !== "string" || !row.target ||
            [row.target.novelId, row.target.targetType, row.target.targetId].some((v: unknown) => typeof v !== "string") ||
            row.key !== commentDraftKey(row.target, row.anchor, row.threadId))) throw new Error("Invalid drafts")
          for (const row of parsed as CommentDraft[]) this.rows.set(row.key, row)
        } catch {
          // 先备份原始值，备份失败也不覆盖原存储。内存仍可继续编辑。
          storage().setItem(`${this.storageKey}:unreadable:${Date.now()}`, raw)
          this.warning = "原草稿数据无法读取，已保留原始备份。"
        }
      }
    } catch { this.warning = "草稿暂存不可用，文字仍保留在当前页面，请复制后再离开。" }
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  version = () => this.revision
  get = (key: string) => this.rows.get(key)?.content ?? ""
  list = (target: DraftTarget) => [...this.rows.values()].filter(row => sameDraftTarget(row.target, target))
  snapshot = (): CommentDraft[] => structuredClone([...this.rows.values()].map(row => commentDraftSchema.parse(row)))
  /** Only a disabled-session bootstrap archive can use unreadable raw rows.
   * Their exact bytes and memory data are retained in the recovery source. */
  retainedSnapshotForCheckpoint(): unknown[] | null {
    const current = this.retainedReset
    if (!current || this.storage().getItem(this.storageKey) !== current.raw || JSON.stringify([...this.rows.values()]) !== current.signature) return null
    return structuredClone([...this.rows.values()])
  }
  prepareResetAfterCheckpoint() {
    const raw = this.storage().getItem(this.storageKey), rows = structuredClone([...this.rows.values()]), current = { raw, signature: JSON.stringify(rows) }
    this.retainedReset = current
    let committed = false
    const assertCurrent = () => {
      const expectedRaw = committed ? "[]" : raw, expectedRows = committed ? "[]" : current.signature
      if (this.storage().getItem(this.storageKey) !== expectedRaw || JSON.stringify([...this.rows.values()]) !== expectedRows) throw new Error("DRAFT_CHANGED_DURING_RECOVERY")
    }
    const cancel = () => { if (this.retainedReset === current) this.retainedReset = null }
    return { raw, rows, assertCurrent, cancel, commit: () => {
      assertCurrent(); if (committed) return
      this.storage().setItem(this.storageKey, "[]"); this.rows.clear(); committed = true; cancel()
      this.revision++; this.listeners.forEach(listener => listener())
    } }
  }
  /** Bootstrap restoration is not publication. Do not overwrite a current
   * different draft or an unreadable storage value; the caller retains it. */
  restore(rows: CommentDraft[]): { applied: CommentDraft[]; retained: CommentDraft[]; failed: boolean } {
    const incoming = rows.map(row => commentDraftSchema.parse(row)), next = new Map(this.rows), applied: CommentDraft[] = [], retained: CommentDraft[] = []
    try {
      const raw = this.storage().getItem(this.storageKey)
      if (raw !== null) z.array(commentDraftSchema).parse(JSON.parse(raw))
      for (const row of incoming) {
        const previous = next.get(row.key)
        if (previous && JSON.stringify(previous) !== JSON.stringify(row)) { retained.push(row); continue }
        next.set(row.key, structuredClone(row)); applied.push(row)
      }
      if (applied.length) this.storage().setItem(this.storageKey, JSON.stringify([...next.values()]))
    } catch { return { applied: [], retained: structuredClone(incoming), failed: true } }
    this.rows = next
    if (applied.length) { this.revision++; this.listeners.forEach(listener => listener()) }
    return { applied: structuredClone(applied), retained: structuredClone(retained), failed: false }
  }
  set(target: DraftTarget, anchor: DraftAnchor | undefined, threadId: string | undefined, content: string) {
    if (anchor) anchor = { quote: anchor.quote, startOffset: anchor.startOffset, endOffset: anchor.endOffset, prefix: anchor.prefix, suffix: anchor.suffix }
    const key = commentDraftKey(target, anchor, threadId)
    if (content) this.rows.set(key, { key, target, anchor, threadId, content, updatedAt: Date.now() })
    else this.rows.delete(key)
    this.publish()
  }
  discard(key: string) { this.rows.delete(key); this.publish() }
  private publish() {
    try {
      // 不可读取的原值必须已备份，才能覆盖；失败时仅更新内存。
      const raw = this.storage().getItem(this.storageKey)
      if (raw) { try { JSON.parse(raw) } catch { this.storage().setItem(`${this.storageKey}:unreadable`, raw) } }
      this.storage().setItem(this.storageKey, JSON.stringify([...this.rows.values()]))
    } catch { this.warning = "草稿暂存不可用，文字仍保留在当前页面，请复制后再离开。" }
    this.revision++
    this.listeners.forEach(listener => listener())
  }
}
// Same account store used by the original UI and desktop snapshot/recovery.
const stores = new Map<string, CommentDraftStore>()
export function commentDraftStoreFor(accountId: string | undefined, storage?: () => DraftStorage) {
  if (!accountId || !storage && typeof window === "undefined") return null
  let store = stores.get(accountId)
  if (!store) { store = new CommentDraftStore(accountId, storage ?? (() => window.sessionStorage)); stores.set(accountId, store) }
  return store
}
