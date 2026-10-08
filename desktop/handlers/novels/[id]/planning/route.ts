import { NextResponse } from "next/server";
import { z } from "zod";
import { getOwnedNovel } from "../lib";
import { ContentError } from "@/lib/content-errors";
import { PlanningError } from "@/lib/planning/domain";
import {
  applyPlanningProposal,
  getPlanning,
  importOutlinePlanning,
  mutatePlanning,
  planningHistory,
  planningProposals,
  restorePlanning,
} from "@/lib/services/planning";
type Context = { params: Promise<{ id: string }> };
function errorResult(error: unknown) {
  if (error instanceof ContentError)
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
  if (error instanceof PlanningError)
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: 400 },
    );
  if (error instanceof z.ZodError)
    return NextResponse.json(
      { error: error.issues[0]?.message ?? "规划数据格式错误" },
      { status: 400 },
    );
  console.error(
    "Planning request failed",
    error instanceof Error ? error.name : "unknown",
  );
  return NextResponse.json(
    { error: "规划保存失败，输入已保留" },
    { status: 500 },
  );
}
export async function GET(_request: Request, ctx: Context) {
  const { id } = await ctx.params,
    result = await getOwnedNovel(id);
  if ("error" in result) return result.error;
  try {
    const scope = { novelId: id, userId: result.session.user!.id! };
    const [planning, history, proposals] = await Promise.all([
      getPlanning(scope),
      planningHistory(scope),
      planningProposals(scope),
    ]);
    return NextResponse.json({
      ...planning,
      history,
      proposals,
      readonly: result.novel.status !== "ACTIVE",
    });
  } catch (error) {
    return errorResult(error);
  }
}
const controlSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  operationId: z.string().min(1).max(120),
});
export async function POST(request: Request, ctx: Context) {
  const { id } = await ctx.params,
    result = await getOwnedNovel(id);
  if ("error" in result) return result.error;
  try {
    const scope = { novelId: id, userId: result.session.user!.id! },
      body = await request.json();
    let receipt;
    if (body.action === "import")
      receipt = await importOutlinePlanning(scope, controlSchema.parse(body));
    else if (body.action === "restore")
      receipt = await restorePlanning(
        scope,
        controlSchema.extend({ snapshotId: z.string().min(1) }).parse(body),
      );
    else if (body.action === "apply-proposal")
      receipt = await applyPlanningProposal(
        scope,
        z.string().min(1).parse(body.proposalId),
      );
    else receipt = await mutatePlanning(scope, body);
    return NextResponse.json({ receipt, ...(await getPlanning(scope)) });
  } catch (error) {
    return errorResult(error);
  }
}
