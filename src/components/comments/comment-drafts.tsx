"use client"
import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react"
import { commentDraftStoreFor, commentDraftKey, type DraftAnchor, type DraftTarget } from "@/lib/comment-drafts"
import { Button } from "@/components/ui/button"

const Account = createContext<string | undefined>(undefined)
export function CommentDraftAccount({ userId, children }: { userId: string; children: ReactNode }) {
  return <Account.Provider value={userId}>{children}</Account.Provider>
}
const Context = createContext<{ target: DraftTarget | null; source?: string }>({ target: null })
const noopSubscribe = () => () => {}
const zero = () => 0
const empty = () => ""
function storeFor(accountId?: string) {
  return commentDraftStoreFor(accountId)
}
export function CommentDraftProvider({ target, source, children }: { target: DraftTarget | null; source?: string; children: ReactNode }) {
  return <Context.Provider value={{ target, source }}>{children}</Context.Provider>
}
export function useCommentDraft(anchor?: DraftAnchor, threadId?: string, override?: DraftTarget) {
  const context = useContext(Context)
  const store = storeFor(useContext(Account))
  const target = override ?? context.target
  const key = target ? commentDraftKey(target, anchor, threadId) : ""
  const draft = useSyncExternalStore(store?.subscribe ?? noopSubscribe, () => store?.get(key) ?? "", empty)
  useSyncExternalStore(store?.subscribe ?? noopSubscribe, store?.version ?? zero, zero)
  return { draft, ready: !!store && !!target, warning: store?.warning,
    setDraft: (content: string) => { if (target) store?.set(target, anchor, threadId, content) },
    clear: () => store?.discard(key) }
}
/** 关闭编辑气泡之后仍有入口；失效锚点的文字可复制到重新选择的范围。 */
export function CommentDraftList() {
  const { target, source } = useContext(Context)
  const store = storeFor(useContext(Account))
  useSyncExternalStore(store?.subscribe ?? noopSubscribe, store?.version ?? zero, zero)
  if (!target || !store) return null
  const rows = store.list(target)
  if (!rows.length && !store.warning) return null
  return <div className="shrink-0 px-3 py-1 text-xs text-muted-foreground" data-comment-drafts>
    {store.warning && <p role="status">{store.warning}</p>}
    {!!rows.length && <details><summary className="cursor-pointer">未发布评论草稿 {rows.length}</summary>
      <div className="max-h-52 space-y-2 overflow-auto py-2">{rows.map(row => {
        const anchor = row.anchor
        const valid = !anchor?.quote || source === undefined || (anchor.startOffset !== undefined && anchor.endOffset !== undefined &&
          source.slice(anchor.startOffset, anchor.endOffset) === anchor.quote &&
          (!anchor.prefix || source.slice(Math.max(0, anchor.startOffset - anchor.prefix.length), anchor.startOffset) === anchor.prefix) &&
          (!anchor.suffix || source.slice(anchor.endOffset, anchor.endOffset + anchor.suffix.length) === anchor.suffix))
        return <div key={row.key} className="rounded-card border bg-card p-2">
          <p>{row.threadId ? "回复草稿：点原评论的回复继续" : anchor?.quote ? valid ? "重新选中原文可继续评论" : "原文已改动，请重新选区并复制草稿" : "整体评论：点添加评论继续"}</p>
          {anchor?.quote && <blockquote className="comment-quote line-clamp-2">{anchor.quote}</blockquote>}
          <textarea className="mt-1 w-full bg-transparent" aria-label="保留的评论草稿" value={row.content} readOnly />
          <Button size="xs" variant="ghost" onClick={() => void navigator.clipboard.writeText(row.content)}>复制草稿</Button>
          <Button size="xs" variant="ghost" onClick={() => store.discard(row.key)}>丢弃草稿</Button>
        </div>
      })}</div>
    </details>}
  </div>
}
