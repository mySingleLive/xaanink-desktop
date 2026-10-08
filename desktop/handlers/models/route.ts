import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { listLocalModels } from "@desktop/service/models"
export const dynamic = "force-dynamic"
/** Main's saved public text catalog; list reads do not invoke any model. */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "未登录" }, { status: 401 })
  return NextResponse.json(await listLocalModels(session.user.id, "TEXT"))
}
