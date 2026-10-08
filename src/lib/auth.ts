import { getDatabaseContext, LOCAL_AUTHOR_ID } from "@desktop/service/context"

export interface Session { user: { id: string; role: "USER" | "ADMIN"; email?: string | null; name?: string | null; image?: string | null } }

/** Only the trusted worker dispatcher establishes identity; never read request headers. */
export async function auth(): Promise<Session | null> {
  try { getDatabaseContext() } catch { return null }
  return { user: { id: LOCAL_AUTHOR_ID, role: "USER" } }
}
