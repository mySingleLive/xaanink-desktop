import assert from "node:assert/strict"
import {test} from "node:test"
import {CommentDraftStore,commentDraftKey} from "../../src/lib/comment-drafts"
// Existing Web assertions from scripts/tests/world-interactions.test.ts, isolated from its database suite.
test("A14 评论草稿按账号/目标/重复锚点/回复隔离，刷新保留，明确丢弃清除", () => {
  const memory = new Map<string, string>(), storage = () => ({ getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => { memory.set(k, v) } })
  const t = { novelId: "n", targetType: "CHAPTER_CONTENT", targetId: "c" }, a = { quote: "重复句", startOffset: 1, endOffset: 4 }
  const first = new CommentDraftStore("u1", storage)
  first.set(t, a, undefined, "评论一"); first.set(t, { ...a, startOffset: 9, endOffset: 12 }, undefined, "评论二")
  first.set(t, undefined, "thread1", "回复"); first.set({ ...t, targetId: "c2" }, a, undefined, "另一章")
  assert.equal(new CommentDraftStore("u2", storage).list(t).length, 0)
  const reloaded = new CommentDraftStore("u1", storage); assert.equal(reloaded.list(t).length, 3)
  reloaded.discard(commentDraftKey(t, a)); assert.equal(new CommentDraftStore("u1", storage).list(t).length, 2)
})
test("A14 草稿存储失败仍保留内存；损坏原数据有备份", () => {
  const target = { novelId: "n", targetType: "WORLD", targetId: "w" }
  const broken = new CommentDraftStore("u", () => { throw new Error("QuotaExceededError") })
  broken.set(target, undefined, undefined, "不能丢"); assert.equal(broken.get(commentDraftKey(target)), "不能丢"); assert.match(broken.warning, /复制/)
  const memory = new Map<string, string>([["comment-drafts:v1:u", "{broken"]])
  const store = new CommentDraftStore("u", () => ({ getItem: k => memory.get(k) ?? null, setItem: (k, v) => { memory.set(k, v) } }))
  store.set(target, undefined, undefined, "新草稿")
  assert.ok([...memory].some(([k, v]) => k.includes("unreadable") && v === "{broken"))
})
