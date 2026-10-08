import assert from "node:assert/strict"
import { readFile, mkdtemp, mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runInNewContext } from "node:vm"
import { test } from "node:test"
import ts from "typescript"
import { DirectoryAuthority } from "../../desktop/main/directory-authority"
import { Workspaces } from "../../desktop/service/workspaces"
import { getDatabaseContext, runInDatabaseContext } from "../../desktop/service/context"
import { prisma, globalPrisma } from "../../src/lib/db"
import { auth } from "../../src/lib/auth"
import { AttemptMeter } from "../../src/lib/services/attempt-observation"
import { acquireLongTask, runInsideLongTask, longTaskQueue } from "../../src/lib/long-task"
import { registerAttemptAbort, localAttemptCount } from "../../src/lib/local-chat-cancellation"

type Timer = { fire: () => void; interval: boolean; ms: number; cleared: boolean }

/** Exercise the real handler body without contacting a provider. The timer shim
 * preserves the trusted ALS context, just as a real Node timer does. Only control
 * service/model dependencies are fixtures; directory leases and both engines are real.
 */
async function reviewDetachedExecutor(mode: "inflight" | "scheduled-retry") {
  const root = await mkdtemp(join(tmpdir(), "xuanxiang-chat-detached-"))
  const works = new Workspaces(join(root, "app"), join(process.cwd(), "prisma/migrations"))
  const quotaEntered = Promise.withResolvers<void>(), quota = Promise.withResolvers<void>()
  const heartbeatEntered = Promise.withResolvers<void>(), heartbeatGate = Promise.withResolvers<void>()
  const checkpointEntered = Promise.withResolvers<void>(), checkpointGate = Promise.withResolvers<void>()
  const observationEntered = Promise.withResolvers<void>(), observationGate = Promise.withResolvers<void>()
  const stopped = Promise.withResolvers<void>(), finished = Promise.withResolvers<void>()
  const retryScheduled = Promise.withResolvers<Timer>()
  let heartbeatCalls = 0, finalObservationCalls = 0, released = false, checkpointWrites = 0
  let clock = 0, nextTimer = 0
  const timers = new Map<number, Timer>()
  const attemptId = `retained-handler-${mode}`
  class ClockDate extends Date { static now() { return clock } }
  class FixtureContentError extends Error {}
  const binding = {
    replay: false,
    conversation: { id: "conversation-fixture", novelId: null },
    turn: { id: "turn-fixture", userMessageId: "user-message-fixture" },
    attempt: { id: attemptId, assistantMessageId: "assistant-fixture", createdAt: new Date() },
  }
  const captureTimer = (fn: () => void, ms: number, interval: boolean) => {
    const context = getDatabaseContext()
    const timer: Timer = { fire: () => runInDatabaseContext(context, fn), ms, interval, cleared: false }
    const id = ++nextTimer
    timers.set(id, timer)
    if (!interval && ms === 3000) retryScheduled.resolve(timer)
    return id
  }
  const clearTimer = (id: number | undefined) => {
    const timer = id === undefined ? undefined : timers.get(id)
    if (timer) {
      timer.cleared = true
      if (timer.interval && timer.ms === 15000) stopped.resolve()
    }
  }
  const mocks: Record<string, unknown> = {
    "@desktop/service/conversation-runtime": { runConversationTask: (_scope: unknown, run: () => Promise<Response>) => run(), refreshConversationTask: async () => {}, finishConversationTask: async () => {} },
    "@/lib/long-task": { acquireLongTask, runInsideLongTask },
    "@/lib/auth": { auth },
    "@/lib/db": { prisma },
    "@/lib/ai/cost-config": { getCostConfig: async () => ({ maxConcurrentTasks: 1 }) },
    "@/lib/services/attempt-observation": {
      AttemptMeter,
      saveAttemptObservation: async (_scope: unknown, meter: AttemptMeter) => {
        if (meter.data.status === "failed") {
          finalObservationCalls++
          observationEntered.resolve()
          await observationGate.promise
          await globalPrisma.user.update({ where: { id: "local-author" }, data: { name: "final-observation" } })
        } else await prisma.user.count()
      },
    },
    "@/lib/quota": { checkQuota: async () => { quotaEntered.resolve(); await quota.promise } },
    "@/lib/local-chat-cancellation": {
      registerAttemptAbort: (id: string, controller: AbortController) => {
        const release = registerAttemptAbort(id, controller)
        return () => { release(); released = true; finished.resolve() }
      },
    },
    "@/lib/content-errors": { ContentError: FixtureContentError },
    "@/lib/ai/error-classification": { chatTerminalError: () => ({ code: "FIXTURE_PREPARE_FAILURE", message: "isolated preparation failure" }) },
    "@/lib/ai/errors": { toErrorResponse: (error: unknown) => new Response(String(error), { status: 500 }) },
    "@/lib/chat-protocol": { CHAT_HEARTBEAT_MS: 15000, CHAT_LEASE_MS: 60000, chatRequestSchema: { parse: (value: unknown) => value } },
    "@/lib/services/chat-turn": {
      beginChatRequest: async () => binding,
      scopeFor: () => ({ conversationId: "conversation-fixture", turnId: "turn-fixture", attemptId, userId: "local-author" }),
      finishChatAttempt: async () => { await prisma.user.count() },
      checkpointChatAttempt: async () => {
        checkpointEntered.resolve()
        await checkpointGate.promise
        await prisma.user.count()
        checkpointWrites++
      },
      heartbeatChatAttempt: async () => {
        heartbeatCalls++
        if (heartbeatCalls <= 2) { await prisma.user.count(); return }
        heartbeatEntered.resolve()
        await heartbeatGate.promise
        if (mode === "scheduled-retry") throw new Error("fixture transient heartbeat failure")
        await prisma.user.update({ where: { id: "local-author" }, data: { name: "settled-heartbeat" } })
      },
    },
    "next/server": { NextResponse: { json: (value: unknown, init?: ResponseInit) => Response.json(value, init) } },
  }
  const source = await readFile(join(process.cwd(), "desktop/handlers/chat/route.ts"), "utf8")
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  const exports = {} as { POST: (request: Request) => Promise<Response> }
  runInNewContext(code, {
    exports, require: (id: string) => mocks[id] ?? {},
    TextEncoder, ReadableStream, Response, Request, AbortController,
    Date: ClockDate, Error, DOMException, crypto, performance,
    console: { ...console, error: () => {}, warn: () => {} },
    setInterval: (fn: () => void, ms: number) => captureTimer(fn, ms, true),
    clearInterval: clearTimer,
    setTimeout: (fn: () => void, ms: number) => captureTimer(fn, ms, false),
    clearTimeout: clearTimer,
  })
  const active = () => [...(works as unknown as { slots: Map<string, { active: number }> }).slots.values()].map(slot => slot.active)
  try {
    await works.initialize()
    const path = join(root, "work")
    await mkdir(path)
    const authority = new DirectoryAuthority()
    const grant = await authority.issue(path, "create-work", "handler-review")
    const work = await works.create(await authority.consume(grant.id, "create-work", "handler-review"), { title: "后台生命期回归", requestId: `handler-${mode}` })
    const response = await works.runWithGlobal(work.id, () => exports.POST(new Request("http://localhost/api/chat", { method: "POST", body: "{}" })))
    await response.body!.cancel()
    await quotaEntered.promise
    const heartbeatTimer = [...timers.values()].find(timer => timer.interval && timer.ms === 15000)!
    heartbeatTimer.fire()
    await heartbeatEntered.promise
    clock = 15000
    const checkpointTimer = [...timers.values()].find(timer => timer.interval && timer.ms === 1000)!
    checkpointTimer.fire()
    await checkpointEntered.promise
    await assert.rejects(works.close(), /任务运行/)
    let retry: Timer | undefined
    if (mode === "scheduled-retry") {
      heartbeatGate.resolve()
      retry = await retryScheduled.promise
      await new Promise<void>(resolve => setImmediate(resolve))
    }
    quota.reject(new Error("fixture prepare failure"))
    checkpointGate.resolve()
    await stopped.promise
    assert.equal(checkpointWrites, 1)
    assert.equal(released, false)
    if (mode === "inflight") {
      assert.equal(finalObservationCalls, 0, "final observation follows settlement of the independent heartbeat")
      assert.deepEqual(active(), [2, 2], "registration and queue grant retain both databases")
      await assert.rejects(works.close(), /任务运行/)
      heartbeatGate.resolve()
    } else {
      assert.equal(retry!.cleared, true, "already scheduled retries are cleared before final persistence")
      retry!.fire() // Even an already dispatched timer callback must respect stopping.
      await new Promise<void>(resolve => setImmediate(resolve))
      assert.equal(heartbeatCalls, 3)
    }
    await observationEntered.promise
    assert.equal(released, false)
    assert.deepEqual(active(), [2, 2])
    await assert.rejects(works.close(), /任务运行/)
    observationGate.resolve()
    await finished.promise
    assert.equal(localAttemptCount(), 0)
    assert.equal(longTaskQueue.active, 0)
    assert.equal(longTaskQueue.waiting, 0)
    assert.deepEqual(active(), [0, 0])
    const saved = await works.runWithGlobal(work.id, async () => ({
      work: (await prisma.user.findUniqueOrThrow({ where: { id: "local-author" } })).name,
      global: (await globalPrisma.user.findUniqueOrThrow({ where: { id: "local-author" } })).name,
    }))
    if (mode === "inflight") assert.equal(saved.work, "settled-heartbeat")
    assert.equal(saved.global, "final-observation")
    await works.close()
  } finally {
    quota.resolve(); heartbeatGate.resolve(); checkpointGate.resolve(); observationGate.resolve()
    if (localAttemptCount()) await finished.promise
    await works.close()
    await rm(root, { recursive: true, force: true })
  }
}

test("DESK-D04: real detached handler retains both databases through inflight heartbeat, checkpoint and final observation", { timeout: 30000 }, () => reviewDetachedExecutor("inflight"))
test("DESK-D04: detached handler stops scheduled heartbeat retries before final observation and release", { timeout: 30000 }, () => reviewDetachedExecutor("scheduled-retry"))
