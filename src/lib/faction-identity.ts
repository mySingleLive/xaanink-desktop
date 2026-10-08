import { randomUUID } from "node:crypto"
import { ContentError } from "@/lib/content-errors"
type Entry = Record<string, unknown> & {id?: string; name?: string}
export function factionEntries(raw: unknown): Entry[] {
  const value = raw as { factions?: unknown } | null
  return Array.isArray(value?.factions) ? value.factions.filter((item): item is Entry => !!item && typeof item === "object" && !Array.isArray(item)) : []
}
/** Preserve unknown data and stable identities. A missing ID may match only one existing name. */
export function normalizeFactionIdentity(raw: unknown, previous?: unknown, historical?: Entry[]) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ContentError("INVALID_FACTIONS", "势力内容必须为对象", 400)
  const old = factionEntries(previous); const used = new Set<string>()
  const factions = factionEntries(raw).map(entry => {
    let id = typeof entry.id === "string" && entry.id.trim() ? entry.id : undefined
    if (!id) {
      const matches = old.filter(item => item.name === entry.name)
      if (matches.length > 1) throw new ContentError("FACTION_AMBIGUOUS", "同名势力无法确定身份，请传条目 ID", 400)
      id = matches[0]?.id
      if (!id && historical) {
        const identities = [...new Set(historical.filter(item => item.name === entry.name && item.id).map(item => item.id!))]
        if (identities.length !== 1) throw new ContentError("FACTION_HISTORY_AMBIGUOUS", "历史势力无法唯一确定身份，请明确条目ID后恢复", 400)
        id = identities[0]
      }
      id ||= randomUUID()
    }
    if (used.has(id)) throw new ContentError("FACTION_ID_DUPLICATE", "势力条目 ID 不能重复", 400)
    used.add(id)
    const original = old.find(item => item.id === id)
    return {...original, ...entry, id}
  })
  return {...previous as Record<string, unknown>, ...raw as Record<string, unknown>, factions}
}
