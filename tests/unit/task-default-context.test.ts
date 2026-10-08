import assert from "node:assert/strict"
import { test } from "node:test"
import { defaultState } from "../../desktop/core/settings"
import { freezeTaskDefaults } from "../../desktop/shared/task-defaults"
import { runWithTaskDefaults, currentTaskDefaults } from "../../desktop/service/task-defaults"
import { runInChatExecution, outsideChatExecution, currentChatExecution } from "../../src/lib/chat-execution"
test("DEFAULT-17: task defaults survive child execution and control writes outside the chat fence", async () => {
  const old = freezeTaskDefaults({ ...defaultState.settings.agent, mode: "plan", thinking: "low" }, 3)
  const latest = freezeTaskDefaults({ ...defaultState.settings.agent, mode: "standard", thinking: "high" }, 9)
  await runWithTaskDefaults(latest, () => runInChatExecution({ userId: "local-author", conversationId: "conversation", turnId: "turn", attemptId: "attempt", epoch: 1, taskDefaults: old }, async () => {
    assert.equal(currentTaskDefaults(), old)
    await outsideChatExecution(async () => {
      assert.equal(currentChatExecution(), undefined)
      await Promise.resolve(); assert.equal(currentTaskDefaults(), old)
    })
    assert.equal(currentChatExecution()!.taskDefaults, old)
  }))
  assert.equal(currentTaskDefaults(), undefined)
})
