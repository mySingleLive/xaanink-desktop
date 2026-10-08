import { NextResponse } from "next/server"
import { Prisma } from "@/generated/prisma/client"
import { ReferenceError } from "@/lib/services/foreshadow-reference"
export function referenceErrorResponse(error: unknown) {
  if (error instanceof ReferenceError) return NextResponse.json({ error: error.message }, { status: error.status })
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return NextResponse.json({ error: "该位置已有相同引用，请刷新后重试" }, { status: 409 })
  return NextResponse.json({ error: "保存引用失败，请重试" }, { status: 500 })
}
