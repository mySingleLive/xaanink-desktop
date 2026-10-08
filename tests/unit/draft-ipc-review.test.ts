import {mainFunction} from "../helpers/main-function"
import assert from "node:assert/strict"
import { test } from "node:test"
import { readFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import ts from "typescript"
import { transformSync } from "esbuild"
import { z } from "zod"

const source = ts.createSourceFile("main.ts", readFileSync(new URL("../../desktop/main/index.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true)
const body = ["trusted", "registerIpc"].map(name => {
  const node = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)
  assert(node); return node.getText(source)
}).join("\n")
function fixture() {
  const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()
  let finish!: (value: unknown) => void
  const pending = new Promise(resolve => { finish = resolve })
  const frame = { url: "xaanink://app/" }, contents = { id: 51, mainFrame: frame }, event = { sender: contents, senderFrame: frame }
  const draftSession = { owner: 51, id: randomUUID(), ready: true }, calls: unknown[] = []
  const draftJournal = { read: () => pending, persist: (...args: unknown[]) => { calls.push(args); return pending } }
  mainFunction("ipcMain", "window", "z", "draftSession", "draftJournal", transformSync(body, { loader: "ts" }).code + "\nregisterIpc()")(
    { handle: (id: string, handler: (...args: unknown[]) => Promise<unknown>) => handlers.set(id, handler), on() {} }, { webContents: contents }, z, draftSession, draftJournal)
  return { finish, contents, event, draftSession, calls, call: (id: string) => { const handler = handlers.get(id); assert(handler); return handler(event, draftSession.id, { revision: 2 }) } }
}
test("J51-IPC01: an old persist receipt cannot cross a renderer nonce change during the awaited disk operation", async () => {
  const f = fixture(), pending = f.call("desktop:draft-persist")
  const rejected = assert.rejects(pending, /窗口|不受信/)
  f.draftSession.id = randomUUID(); f.finish({ revision: 1, digest: "f".repeat(64), clientRevision: 2 })
  await rejected; assert.equal(f.calls.length, 1)
})
test("J51-IPC02: an awaited journal read cannot return manuscript data to a no-longer-current main frame", async () => {
  const f = fixture(), pending = f.call("desktop:draft-read")
  const rejected = assert.rejects(pending, /不受信|窗口/)
  f.contents.mainFrame = { url: "xaanink://app/" }; f.finish({ privateDraft: "不得返回旧frame" })
  await rejected
})
test("J51-IPC03: preload forwards only the draft session nonce and snapshot on the two narrow channels", async () => {
  const preload = ts.createSourceFile("preload.ts", readFileSync(new URL("../../desktop/preload/index.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true)
  const statement = preload.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(d => d.name.getText(preload) === "bridge"))
  assert(statement && ts.isVariableStatement(statement))
  const initializer = statement.declarationList.declarations.find(d => d.name.getText(preload) === "bridge")?.initializer
  assert(initializer)
  const calls: unknown[][] = [], bridge = mainFunction("ipcRenderer", transformSync(`const bridge = ${initializer.getText(preload)}`, { loader: "ts" }).code + "\nreturn bridge")({ invoke: (...args: unknown[]) => { calls.push(args); return Promise.resolve(null) } })
  const nonce = randomUUID(), snapshot = { version: 1, revision: 2 }
  await bridge.persistDraft(nonce, snapshot); await bridge.readDraft(nonce)
  assert.deepEqual(calls, [["desktop:draft-persist", nonce, snapshot], ["desktop:draft-read", nonce]])
})
