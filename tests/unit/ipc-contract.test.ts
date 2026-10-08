import assert from "node:assert/strict"
import { test } from "node:test"
import { randomUUID } from "node:crypto"
import { requestSchema } from "../../desktop/shared/ipc"
const valid = { version: 1, id: randomUUID(), path: "/api/novels", method: "GET", headers: {} }
test("IPC-01/02: local request envelope rejects paths, credentials, unknown fields and unsupported methods", () => {
  assert.equal(requestSchema.parse(valid).path, "/api/novels")
  for (const path of ["https://server.test/api/novels", "//server.test/api/novels", "/api/../secrets", "/api/%2e%2e/secrets", "/api/novels%2fsecret", "/api/novels\\secret", "/api/novels#fragment"]) assert.equal(requestSchema.safeParse({ ...valid, path }).success, false, path)
  for (const change of [{ headers: { Authorization: "fixture" } }, { method: "CONNECT" }, { workspacePath: "/unselected" }, { body: [1] }, { headers: { cookie: "fixture" } }]) assert.equal(requestSchema.safeParse({ ...valid, ...change }).success, false)
})

test("IPC-01: allowed headers are normalized once and ambiguous duplicate casing is rejected", () => {
  assert.deepEqual(requestSchema.parse({ ...valid, headers: { "Content-Type": "application/json" } }).headers, { "content-type": "application/json" })
  assert.equal(requestSchema.safeParse({ ...valid, headers: { "Content-Type": "application/json", "content-type": "text/plain" } }).success, false)
})
