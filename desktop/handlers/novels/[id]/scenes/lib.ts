import { NextResponse } from "next/server"
import { getOwnedNovel as getOwnedBook } from "../lib"
export { firstIssueMessage } from "../lib"

/** Scene endpoints conceal another author's book existence while preserving the shared auth/admin contract. */
export async function getOwnedNovel(id: string) {
  const result = await getOwnedBook(id)
  if ("error" in result && result.error.status === 403) {
    return {error: NextResponse.json({error: "小说不存在"}, {status: 404})}
  }
  return result
}
