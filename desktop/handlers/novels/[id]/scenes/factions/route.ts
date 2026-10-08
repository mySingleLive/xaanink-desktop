import { NextResponse } from "next/server"
import { sceneFactions } from "@/lib/services/scene"
import { getOwnedNovel } from "../lib"
export async function GET(_request: Request, ctx: {params: Promise<{id: string}>}) {const {id} = await ctx.params; const owner = await getOwnedNovel(id); if ("error" in owner) return owner.error; return NextResponse.json({factions: await sceneFactions(id)})}
