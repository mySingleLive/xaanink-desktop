import assert from "node:assert/strict"
import { test } from "node:test"
import { spawn } from "node:child_process"

test("B29: actual verification runner rejects EOF, malformed and invalid scopes without exposing input", { timeout: 60000 }, async () => {
  const validScope = JSON.stringify(["openai", "deepseek", "zai", "moonshot", "minimax", "bytedance"].map(provider => ({ provider, key: "private-runner-fixture" }))) + "\n"
  const cases = ["", "not-json\n", JSON.stringify([{ provider: "openai", key: "private-runner-fixture" }]) + "\n", JSON.stringify(Array.from({ length: 6 }, () => ({ provider: "openai", key: "private-runner-fixture" }))) + "\n"].map(input => ({ input, args: [] as string[] }))
  cases.push({ input: validScope, args: ["--catalog-only", "--models=nonexistent-model"] })
  for (const { input, args } of cases) {
    const child = spawn(process.execPath, ["--import", "tsx", "scripts/verify-byok.ts", ...args], { stdio: ["pipe", "pipe", "pipe"] })
    let output = ""
    child.stdout.on("data", data => { output += data }); child.stderr.on("data", data => { output += data })
    const result = new Promise<number | null>((resolve, reject) => { child.on("error", reject); child.on("close", resolve) })
    child.stdin.end(input)
    assert.equal(await result, 1)
    assert.ok(output.includes("Verification runner failed before completion"))
    assert.equal(output.includes("private-runner-fixture"), false)
    assert.equal(output.includes('"event":"case"'), false)
    assert.equal(output.includes('"event":"complete"'), false)
  }
})
