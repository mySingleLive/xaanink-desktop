import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { transformSync } from "esbuild"
import ts from "typescript"
import * as appearance from "../../desktop/main/window-appearance"

type Theme = "paper" | "ink" | "system"
type Source = "light" | "dark" | "system"
const tree = ts.createSourceFile("main.ts", readFileSync("desktop/main/index.ts", "utf8"), ts.ScriptTarget.Latest, true)
const compile = (code: string) => transformSync(code, { loader: "ts", format: "cjs" }).code
function visit(node: ts.Node, run: (value: ts.Node) => void) { run(node); ts.forEachChild(node, child => visit(child, run)) }
function declaration(name: string) {
  const node = tree.statements.find(value => ts.isFunctionDeclaration(value) && value.name?.text === name)
  assert(node); return node.getText(tree)
}
const send = tree.statements.find(value => ts.isVariableStatement(value) && value.declarationList.declarations.some(node => node.name.getText(tree) === "send"))!
let updated = ""
visit(tree, node => {
  if (ts.isCallExpression(node) && node.expression.getText(tree) === "nativeTheme.on" && node.arguments[0]?.getText(tree) === '"updated"') updated = node.arguments[1].getText(tree)
})
assert(updated)

// Real host callbacks and real helper, with narrow native ports. No main startup,
// Electron process, author settings, filesystem service or model is imported.
function fixture(osDark: boolean, mode: "sync" | "queued" = "sync", initialSource: Source = "system") {
  let source = initialSource, listener: (() => void) | undefined
  const assignments: Source[] = [], queue: Array<() => void> = [], paints: Array<{ source: Source; background?: string; color?: string; symbolColor?: string }> = []
  const events: Array<{ type: string; dark?: boolean }> = []
  const nativeTheme = {
    get themeSource() { return source },
    set themeSource(value: Source) {
      assignments.push(value); assert(assignments.length < 20, "Theme synchronization must not recurse")
      source = value
      if (listener) { if (mode === "sync") listener(); else queue.push(listener) }
    },
    get shouldUseDarkColors() { return source === "dark" || source === "system" && osDark },
  }
  const windowPort = () => ({
    destroyed: false,
    isDestroyed() { return this.destroyed },
    setBackgroundColor(background: string) { paints.push({ source, background }) },
    setTitleBarOverlay(options: { color: string; symbolColor: string }) { paints.push({ source, ...options }) },
    webContents: { send(_channel: string, event: { type: string; dark?: boolean }) { events.push(event) } },
  })
  const initial = windowPort(), scope: { host?: any } = {}
  const code = compile(`let window=initial,menuRevision=-1,menuShortcuts={},windowTheme="system";
    ${send.getText(tree)};
    ${declaration("applyMainWindowAppearance")}
    ${declaration("refreshMenus")}
    const onUpdated=${updated};
    globalThis.host={send,onUpdated,replace:value=>{window=value},refresh:refreshMenus,
      get window(){return window},get theme(){return windowTheme}};`)
  const helpers = { ...appearance } as Record<string, unknown>
  new Function("globalThis", "initial", "nativeTheme", "process", "app", ...Object.keys(helpers), code)(
    scope, initial, nativeTheme, { platform: "win32" }, { isReady: () => false }, ...Object.values(helpers))
  const host = scope.host!
  listener = host.onUpdated
  const state = (revision: number, theme: Theme) => ({ revision, settings: { appearance: { theme, zoom: 1 }, shortcuts: { win32: {}, darwin: {} } } })
  return { host, nativeTheme, assignments, paints, events, windowPort, state,
    commit: (revision: number, theme: Theme) => host.send({ type: "state", state: state(revision, theme) }),
    flush: () => { while (queue.length) queue.shift()!() },
  }
}

test("WCO-F01 explicit themes select the native ColorProvider before painting", () => {
  const r = fixture(true)
  r.commit(1, "paper")
  assert.equal(r.nativeTheme.themeSource, "light")
  assert.equal(r.nativeTheme.shouldUseDarkColors, false)
  assert.equal(r.paints.at(-1)?.source, "light")
  assert.equal(r.paints.at(-1)?.symbolColor, "#2b251b")
  r.commit(2, "ink")
  assert.equal(r.nativeTheme.themeSource, "dark")
  assert.equal(r.paints.at(-1)?.symbolColor, "#ece7e1")
})
for (const osDark of [false, true]) test(`WCO-F01 returning to system resamples darkness after source changes (${osDark})`, () => {
  const r = fixture(osDark)
  r.commit(1, osDark ? "paper" : "ink")
  r.commit(2, "system")
  assert.equal(r.nativeTheme.themeSource, "system")
  assert.equal(r.nativeTheme.shouldUseDarkColors, osDark)
  assert.equal(r.paints.at(-1)?.symbolColor, osDark ? "#ece7e1" : "#2b251b")
  assert.equal(r.events.filter(event => event.type === "theme").at(-1)?.dark, osDark)
})
test("WCO-F02 synchronous updated reentry assigns once and cannot overwrite the latest theme", () => {
  const r = fixture(true)
  r.commit(1, "paper")
  assert.deepEqual(r.assignments, ["light"])
  assert(r.paints.every(value => value.source === "light"))
  assert.equal(r.events.filter(event => event.type === "theme").at(-1)?.dark, false)
  const paints = r.paints.length
  r.commit(0, "ink")
  assert.equal(r.paints.length, paints)
  assert.deepEqual(r.assignments, ["light"])
  r.host.replace(r.windowPort()); r.commit(1, "paper")
  assert(r.paints.length > paints)
  assert.deepEqual(r.assignments, ["light"])
})
test("WCO-F02 queued old updated callbacks paint and broadcast the current committed choice", () => {
  const r = fixture(false, "queued")
  r.commit(1, "paper"); r.commit(2, "ink")
  assert.deepEqual(r.assignments, ["light", "dark"])
  const paints = r.paints.length
  r.flush()
  assert(r.paints.slice(paints).every(value => value.source === "dark" && (!value.symbolColor || value.symbolColor === "#ece7e1")))
  assert.equal(r.events.filter(event => event.type === "theme").at(-1)?.dark, true)
  assert.deepEqual(r.assignments, ["light", "dark"])
})
test("WCO-F02 no window or a destroyed window still updates the native source without invoking window setters", () => {
  const r = fixture(true)
  r.host.replace(null); r.commit(1, "paper")
  assert.equal(r.nativeTheme.themeSource, "light"); assert.equal(r.paints.length, 0)
  const destroyed = r.windowPort(); destroyed.destroyed = true
  r.host.replace(destroyed); r.commit(2, "ink")
  assert.equal(r.nativeTheme.themeSource, "dark"); assert.equal(r.paints.length, 0)
})
for (const theme of ["paper", "system"] as const) test(`WCO-F03 actual constructor prefix commits source before evaluating its options (${theme})`, async () => {
  const r = fixture(true, "sync", theme === "system" ? "light" : "system")
  const create = tree.statements.find(value => ts.isFunctionDeclaration(value) && value.name?.text === "createWindow") as ts.FunctionDeclaration
  const statements = [...create.body!.statements]
  const first = statements.findIndex(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(value => value.name.getText(tree) === "state"))
  const last = statements.findIndex(node => ts.isExpressionStatement(node) && node.expression.getText(tree).startsWith("window = new BrowserWindow"))
  assert(first >= 0 && last > first)
  let captured: { source: Source; options: any } | undefined
  class BrowserWindow { constructor(options: unknown) { captured = { source: r.nativeTheme.themeSource, options } } }
  const helpers = { ...appearance } as Record<string, unknown>
  await new Function("repository", "nativeTheme", "BrowserWindow", "process", "join", "__dirname", "refreshMenus", ...Object.keys(helpers),
    compile(`return (async()=>{let window;${statements.slice(first, last + 1).map(node => node.getText(tree)).join("\n")}})()`))(
    { read: async () => r.state(1, theme) }, r.nativeTheme, BrowserWindow, { platform: "win32" }, (...parts: string[]) => parts.join("/"), "/isolated/main", r.host.refresh, ...Object.values(helpers))
  assert.equal(captured!.source, theme === "paper" ? "light" : "system")
  assert.equal(captured!.options.titleBarOverlay.symbolColor, theme === "paper" ? "#2b251b" : "#ece7e1")
  assert.equal(r.host.theme, theme)
})
