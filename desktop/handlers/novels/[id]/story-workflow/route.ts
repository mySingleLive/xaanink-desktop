import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { ContentError } from "@/lib/content-errors"
import { getStoryWorkflow, getStoryReviewHistory } from "@/lib/services/story-workflow"
import { storySources } from "@/lib/services/story-artifacts"

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "未登录" }, { status: 401 })
  const { id: novelId } = await params, scope = { userId: session.user.id, novelId }
  try {
    const reviewKey = new URL(request.url).searchParams.get("review")
    if (reviewKey) return NextResponse.json(await getStoryReviewHistory(scope, reviewKey))
    const key = new URL(request.url).searchParams.get("key")
    if (!key) return NextResponse.json({ workflow: await getStoryWorkflow(scope) })
    const graph = await storySources(scope, key)
    const compact = ({ text, ...artifact }: typeof graph.sources[number]) => { void text; return artifact }
    return NextResponse.json({ sources: graph.sources.map(compact), targets: graph.targets.map(compact), edges: graph.edges })
  } catch (error) {
    return NextResponse.json({ error: error instanceof ContentError ? error.message : "创作进度读取失败，请重试" }, { status: error instanceof ContentError ? error.status : 500 })
  }
}
