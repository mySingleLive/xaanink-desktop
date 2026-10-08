import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { listLocalModels } from "@desktop/service/models"
/** Main's saved public image catalog, with an explicit default reference. */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "未登录" }, { status: 401 })
  return NextResponse.json(await listLocalModels(session.user.id, "IMAGE"))
}
