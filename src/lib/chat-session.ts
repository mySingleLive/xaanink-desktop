import { savedPositionSchema } from "./creation-wizard/position"
import { z } from "zod"
import { chatActionSchema } from "./chat-parts"

const entrySchema = z.object({
  pendingNovelPosition: savedPositionSchema.nullable().optional(),
  action: chatActionSchema.nullable().optional(),
  draftId: z.string(), conversationId: z.string().nullable(), novelId: z.string().nullable(),
  draft: z.string(), pendingNovelTitle: z.string().nullable(), novelCreationRequestId: z.string().nullable(),
  modelChoice: z.object({ modelId: z.string().nullable(), effort: z.string().nullable() }),
  modelChoiceExplicit: z.boolean().optional(),
  mode: z.enum(["standard", "plan"]).optional(), modeExplicit: z.boolean().optional(),
  queuedMessages: z.array(z.object({ id: z.string(), text: z.string(), action: chatActionSchema.optional() })),
  wasRunning: z.boolean(), awaitingQuestion: z.boolean(),
  pendingRequest: z.object({ clientRequestId: z.string(), body: z.string() }).nullable().optional(),
})
const savedSchema = z.object({ version: z.literal(1), activeKey: z.string(), drafts: z.record(z.string(), entrySchema) })
export { entrySchema as chatSessionEntrySchema, savedSchema as chatSessionSnapshotSchema }
export type ChatSessionEntry = z.infer<typeof entrySchema>
export type ChatSessionStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">
export const chatSessionKey = (accountId: string) => `xaanink-chat-session:v1:${accountId}`
// Read historical snapshots in the same storage; all new writes use XaanInk.
const legacyChatSessionKey = (accountId: string) => `xuanxiang-chat-session:v1:${accountId}`

export function emptyChatSession(): ChatSessionEntry {
  return { draftId: crypto.randomUUID(), conversationId: null, novelId: null, draft: "", pendingNovelTitle: null, pendingNovelPosition: null, novelCreationRequestId: null,
    modelChoice: { modelId: null, effort: null }, queuedMessages: [], wasRunning: false, awaitingQuestion: false }
}

/** sessionStorage 自身提供标签页隔离；账号 ID 只取认证上下文，不由会话响应猜测。 */
export class ChatSessionRepository {
  private saved: z.infer<typeof savedSchema> | null = null
  private lastSerialized: string | null = null
  private unreadable = false
  constructor(readonly accountId: string, private storage: ChatSessionStorage | null) {}
  read(): { entry: ChatSessionEntry | null; error?: string } {
    try {
      const current = this.storage?.getItem(chatSessionKey(this.accountId))
      const raw = current == null ? this.storage?.getItem(legacyChatSessionKey(this.accountId)) : current
      if (raw == null) return { entry: null, ...(!this.storage ? { error: "此浏览器未提供草稿存储，刷新前请复制草稿" } : {}) }
      const saved = savedSchema.parse(JSON.parse(raw))
      this.saved = saved; this.lastSerialized = current == null ? null : raw
      return { entry: saved.drafts[saved.activeKey] ?? null }
    } catch {
      this.unreadable = true
      return { entry: null, error: "本地会话记录无法读取，原记录保留；请先复制当前草稿" }
    }
  }
  get(conversationId: string) { return this.saved?.drafts[conversationId] ?? null }
  save(entry: ChatSessionEntry): string | null {
    if (this.unreadable) return "本地记录尚未恢复，原记录保留；刷新前请复制草稿"
    const key = entry.conversationId ?? entry.draftId
    this.saved = { version: 1, activeKey: key, drafts: { ...this.saved?.drafts, [key]: entry } }
    try {
      if (!this.storage) throw new Error("storage unavailable")
      const serialized = JSON.stringify(this.saved)
      if (serialized !== this.lastSerialized) this.storage.setItem(chatSessionKey(this.accountId), serialized)
      this.lastSerialized = serialized
      return null
    } catch { return "草稿暂未写入本地存储，刷新前请复制草稿" }
  }
  clear() {
    this.saved = null; this.lastSerialized = null; this.unreadable = false
    this.storage?.removeItem(chatSessionKey(this.accountId))
    this.storage?.removeItem(legacyChatSessionKey(this.accountId))
  }
}

export function browserSessionStorage(): ChatSessionStorage | null {
  try { return typeof window === "undefined" ? null : window.sessionStorage } catch { return null }
}


export function announceChatLogout(userId: string) {
  if (typeof BroadcastChannel === "undefined") return
  const channel = new BroadcastChannel("xaanink-chat-account")
  channel.postMessage({ type: "logout", userId })
  channel.close()
}
