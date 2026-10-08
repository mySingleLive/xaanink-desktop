import { getDatabaseContext } from "@desktop/service/context"
type Cache = Map<string, { content: string; cachedAt: number }>
let caches = new WeakMap<object, Cache>()
export function currentPromptCache(): Cache {
  const context = getDatabaseContext()
  const database = context.globalDatabase ?? (context.workspaceId === "inbox" ? context.database : undefined)
  if (!database) throw Error("No trusted global template database")
  let cache = caches.get(database)
  if (!cache) { cache = new Map(); caches.set(database, cache) }
  return cache
}
export function clearPromptCache(key?: string): void {
  if (key === undefined) { caches = new WeakMap(); return }
  try { currentPromptCache().delete(key) } catch { caches = new WeakMap() }
}
