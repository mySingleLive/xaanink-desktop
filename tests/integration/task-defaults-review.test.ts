import assert from "node:assert/strict"
import { test } from "node:test"
import { randomUUID } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { Workspaces } from "../../desktop/service/workspaces"
import { configureModelTransport } from "../../desktop/service/models"
import { runWithNewTaskDefaults } from "../../desktop/service/task-defaults"
import { defaultState } from "../../desktop/core/settings"
import { freezeTaskDefaults } from "../../desktop/shared/task-defaults"
import { prisma } from "../../src/lib/db"
import { beginChatRequest, scopeFor } from "../../src/lib/services/chat-turn"
import { GET } from "../../desktop/handlers/chat/conversations/[id]/route"

test("MR45-04: later omitted mode follows the last accepted choice and never rewrites historical defaults", async () => {
  const root = await mkdtemp(join(tmpdir(), "xuanxiang-defaults-review-"))
  const works = new Workspaces(join(root, "app"), join(process.cwd(), "prisma/migrations"))
  const agent = { ...defaultState.settings.agent, mode: "standard" as "standard" | "plan" }
  let revision = 1
  configureModelTransport(async method => {
    if (method === "model.defaults") return freezeTaskDefaults(agent, revision) as never
    throw Error(`Unexpected model call: ${method}`)
  })
  const finish = async (binding: Awaited<ReturnType<typeof beginChatRequest>>) => {
    await prisma.chatTurn.update({ where: { id: binding.turn.id }, data: { status: "succeeded" } })
    await prisma.chatAttempt.update({ where: { id: binding.attempt.id }, data: { status: "succeeded", endedAt: new Date() } })
    await prisma.conversation.update({ where: { id: binding.conversation.id }, data: { activeAttemptId: null } })
  }
  try {
    await works.initialize()
    await works.runWithGlobal("inbox", async () => {
      const first = await runWithNewTaskDefaults(() => beginChatRequest("local-author", { clientRequestId: randomUUID(), message: "Start in standard mode" }))
      const historical = (first.conversation as unknown as { defaultsSnapshot: unknown }).defaultsSnapshot
      assert.equal(scopeFor(first.conversation, first.turn, first.attempt).taskDefaults!.mode, "standard")
      await finish(first)
      const chosen = await runWithNewTaskDefaults(() => beginChatRequest("local-author", { clientRequestId: randomUUID(), conversationId: first.conversation.id, message: "Choose planning mode", mode: "plan" }))
      assert.equal(scopeFor(chosen.conversation, chosen.turn, chosen.attempt).taskDefaults!.mode, "plan")
      await finish(chosen)
      const response = await GET(new Request("https://local.invalid"), { params: Promise.resolve({ id: first.conversation.id }) })
      assert.ok(response)
      const detail = await response.json()
      assert.ok(detail.conversation)
      assert.equal(detail.conversation.mode, "plan")
      // A global change must not repair or replace this existing choice.
      agent.mode = "standard"; revision++
      const next = await runWithNewTaskDefaults(() => beginChatRequest("local-author", { clientRequestId: randomUUID(), conversationId: first.conversation.id, message: "Continue without overriding mode" }))
      assert.equal(scopeFor(next.conversation, next.turn, next.attempt).taskDefaults!.mode, "plan")
      assert.deepEqual((next.conversation as unknown as { defaultsSnapshot: unknown }).defaultsSnapshot, historical)
      assert.equal(scopeFor(first.conversation, first.turn, first.attempt).taskDefaults!.mode, "standard")
    })
  } finally { await works.close(); await rm(root, { recursive: true, force: true }) }
})
