import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import ts from "typescript"
import { transformSync } from "esbuild"

// Exercise the actual command dispatcher with controlled native dependencies.
// These checks do not constitute native Electron acceptance.
const syntax = ts.createSourceFile("main.ts", readFileSync("desktop/main/index.ts", "utf8"), ts.ScriptTarget.Latest, true)
const command = syntax.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "executeCommand")
assert.ok(command)
const code = transformSync(command.getText(syntax), { loader: "ts" }).code

function rig(platform = "darwin", closingFlow = false, closed = false) {
  const urls: string[] = [], panels: unknown[] = [], aboutPages: string[] = []
  let shown = 0
  const app = { getVersion: () => "0.2.3", setAboutPanelOptions: (options: unknown) => panels.push(options), showAboutPanel: () => { shown++ } }
  class BrowserWindow {
    setMenu() {}
    async loadURL(url: string) { aboutPages.push(url) }
  }
  const execute = new Function("process", "closingFlow", "businessGate", "commands", "shell", "app", "BrowserWindow", "window", `${code}\nreturn executeCommand`)(
    { platform }, closingFlow, { closed }, { commands: [{ id: "help.feedback" }, { id: "app.about" }] },
    { openExternal: async (url: string) => { urls.push(url) } }, app, BrowserWindow, undefined,
  ) as (id: string) => Promise<void>
  return { execute, urls, panels, aboutPages, shown: () => shown }
}

test("feedback opens the current desktop repository", async () => {
  const r = rig()
  await r.execute("help.feedback")
  assert.deepEqual(r.urls, ["https://github.com/mySingleLive/xaanink-desktop/issues/new/choose"])
})

test("macOS About shows GPL-3.0 and the installed version", async () => {
  const r = rig()
  await r.execute("app.about")
  assert.deepEqual(r.panels, [{ applicationName: "玄印写作", applicationVersion: "0.2.3", copyright: "GPL-3.0 · XaanInk" }])
  assert.equal(r.shown(), 1)
})

test("Windows About shows GPL-3.0 and the installed version", async () => {
  const r = rig("win32")
  await r.execute("app.about")
  assert.equal(r.aboutPages.length, 1)
  const html = decodeURIComponent(r.aboutPages[0].split(",").slice(1).join(","))
  assert.match(html, /GPL-3\.0 · XaanInk/)
  assert.match(html, /版本 0\.2\.3/)
})

test("closing or closed admission blocks feedback and About", async () => {
  for (const [closing, closed] of [[true, false], [false, true]]) {
    const r = rig("darwin", closing, closed)
    await r.execute("help.feedback")
    await r.execute("app.about")
    assert.deepEqual(r.urls, [])
    assert.deepEqual(r.panels, [])
    assert.equal(r.shown(), 0)
  }
})
