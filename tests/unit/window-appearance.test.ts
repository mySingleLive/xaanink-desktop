import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { transformSync } from "esbuild"
import ts from "typescript"
import { syncNativeThemeSource } from "../../desktop/main/window-appearance"

type Theme = "paper" | "ink" | "system"
const css = readFileSync("src/app/globals.css", "utf8")
const mainSource = readFileSync(process.env.XAANINK_WINDOW_THEME_MAIN_SOURCE ?? "desktop/main/index.ts", "utf8")
const main = ts.createSourceFile("main.ts", mainSource, ts.ScriptTarget.Latest, true)
function palette(theme: "paper" | "ink") {
  const block = css.match(new RegExp(`\\.${theme} \\{([\\s\\S]*?)\\n\\}`))![1]
  const token = (name: string) => block.match(new RegExp(`--${name}:\\s*([^;]+)`))![1].trim()
  return { background: token("background"), foreground: token("foreground") }
}
const helper = () => import("../../desktop/main/window-appearance")
function walk(node: ts.Node, visit: (node: ts.Node) => void) { visit(node); ts.forEachChild(node, child => walk(child, visit)) }
function compile(source: string) { return transformSync(source, { loader: "ts", format: "cjs" }).code }
function windowFixture(destroyed = false) {
  const backgrounds: string[] = [], overlays: unknown[] = [], events: unknown[] = []
  return { backgrounds, overlays, events, isDestroyed: () => destroyed,
    setBackgroundColor: (color: string) => { backgrounds.push(color) },
    setTitleBarOverlay: (options: unknown) => { overlays.push(options) },
    webContents: { send: (_channel: string, event: unknown) => { events.push(event) } },
  }
}

// Execute the actual host's state dispatch, revision gate, theme sync function,
// and nativeTheme callback without loading its Electron startup or author I/O.
function hostFixture() {
  const declarations = main.statements.filter(node => ts.isFunctionDeclaration(node) && ["refreshMenus", "applyMainWindowAppearance"].includes(node.name?.text ?? ""))
  const send = main.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(value => value.name.getText(main) === "send"))!
  let updated: ts.Expression | undefined
  walk(main, node => {
    if (ts.isCallExpression(node) && node.expression.getText(main) === "nativeTheme.on" && node.arguments[0]?.getText(main) === '"updated"') updated = node.arguments[1]
  })
  assert(updated, "Actual nativeTheme updated callback must exist")
  const calls: Array<{ target: ReturnType<typeof windowFixture> | null; theme: Theme; dark: boolean }> = []
  const nativeTheme = { themeSource: "system" as "light" | "dark" | "system", shouldUseDarkColors: false }
  const initial = windowFixture()
  const code = compile(`let window = initial; let menuRevision = -1; let menuShortcuts = {}; let windowTheme = "system";
    ${send.getText(main)}; ${declarations.map(node => node.getText(main)).join("\n")}
    const onSystem = ${updated.getText(main)};
    globalThis.__host = { send, replace: value => { window = value }, system: dark => { nativeTheme.shouldUseDarkColors = dark; onSystem() } };`)
  const scope = { __host: undefined as unknown }
  new Function("globalThis", "initial", "nativeTheme", "process", "app", "syncNativeThemeSource", "applyWindowAppearance", code)(scope, initial, nativeTheme, { platform: "win32" }, { isReady: () => false }, syncNativeThemeSource,
    (target: ReturnType<typeof windowFixture> | null, _platform: string, theme: Theme, dark: boolean) => { calls.push({ target, theme, dark }) })
  const host = scope.__host as { send(event: unknown): void; replace(value: ReturnType<typeof windowFixture> | null): void; system(dark: boolean): void }
  return { ...host, calls, initial, commit: (revision: number, theme: Theme) => host.send({ type: "state", state: { revision, settings: { appearance: { theme }, shortcuts: { win32: {}, darwin: {} } } } }) }
}

test("WTHEME-04 actual state dispatch immediately synchronizes committed appearance and rejects old revisions", () => {
  const host = hostFixture()
  host.commit(2, "ink")
  assert.equal(host.calls.at(-1)?.theme, "ink", "Committed settings must reach the native appearance setter")
  host.commit(1, "paper")
  assert.equal(host.calls.length, 1, "An older state must not repaint the caption")
  host.system(true)
  assert.equal(host.calls.at(-1)?.theme, "ink")
  assert.equal(host.calls.at(-1)?.dark, true)
})
test("WTHEME-04 same revision applies to a newly opened window", () => {
  const host = hostFixture(), reopened = windowFixture()
  host.commit(3, "paper"); host.replace(reopened); host.commit(3, "paper")
  assert.equal(host.calls.at(-1)?.target, reopened)
  assert.equal(host.calls.at(-1)?.theme, "paper")
})
test("WTHEME-05 theme choice is retained without a window and system updates use current system darkness", () => {
  const host = hostFixture(), reopened = windowFixture()
  host.replace(null); host.commit(4, "system"); host.replace(reopened); host.system(true)
  assert.equal(host.calls.at(-1)?.target, reopened)
  assert.equal(host.calls.at(-1)?.theme, "system")
  assert.equal(host.calls.at(-1)?.dark, true)
  assert.deepEqual(reopened.events.at(-1), { type: "theme", dark: true })
  host.commit(5, "paper"); host.system(true)
  assert.equal(host.calls.at(-1)?.theme, "paper", "Explicit paper must remain selected against a dark system")
})
test("WTHEME-05 startup subscribes before the first window begins loading", async () => {
  const launch = main.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "launch") as ts.FunctionDeclaration
  const statements = launch.body!.statements.filter(node => ts.isExpressionStatement(node) &&
    (node.expression.getText(main).startsWith('nativeTheme.on("updated"') || node.expression.getText(main) === "await createWindow()"))
  let listener: (() => void) | undefined, applied = false
  const nativeTheme = { shouldUseDarkColors: false, on: (_name: string, callback: () => void) => { listener = callback } }
  const createWindow = async () => {
    assert.equal(typeof listener, "function", "System changes must be observed during first-window loading")
    nativeTheme.shouldUseDarkColors = true; listener!()
    assert(applied)
  }
  await new Function("nativeTheme", "createWindow", "applyMainWindowAppearance", "send", compile(`return (async () => { ${statements.map(node => node.getText(main)).join("\n")} })()`))(
    nativeTheme, createWindow, () => { applied = true }, () => {})
})

for (const theme of ["paper", "ink"] as const) test(`WTHEME-01 ${theme} uses transparent caption and actual CSS palette`, async () => {
  const { nativeWindowAppearance } = await helper()
  const appearance = nativeWindowAppearance(theme, theme === "paper")
  assert.equal(appearance.backgroundColor, palette(theme).background)
  assert.deepEqual(appearance.titleBarOverlay, { color: "#00000000", symbolColor: palette(theme).foreground, height: 44 })
})
test("WTHEME-02 system resolves on each call; explicit choices override the system", async () => {
  const { nativeWindowAppearance } = await helper()
  for (const dark of [false, true]) {
    assert.deepEqual(nativeWindowAppearance("system", dark), nativeWindowAppearance(dark ? "ink" : "paper", dark))
    assert.deepEqual(nativeWindowAppearance("paper", dark), nativeWindowAppearance("paper", false))
    assert.deepEqual(nativeWindowAppearance("ink", dark), nativeWindowAppearance("ink", true))
  }
})
test("WTHEME-03 actual native setters update Windows caption and background", async () => {
  const { applyWindowAppearance, nativeWindowAppearance } = await helper()
  const window = windowFixture()
  applyWindowAppearance(window, "win32", "paper", true)
  applyWindowAppearance(window, "win32", "ink", false)
  assert.deepEqual(window.backgrounds, [palette("paper").background, palette("ink").background])
  assert.deepEqual(window.overlays, [nativeWindowAppearance("paper", true).titleBarOverlay, nativeWindowAppearance("ink", false).titleBarOverlay])
})
test("WTHEME-03 missing/destroyed window is safe; other platforms retain their own native controls", async () => {
  const { applyWindowAppearance } = await helper()
  const destroyed = windowFixture(true), mac = windowFixture(), linux = windowFixture()
  applyWindowAppearance(null, "win32", "ink", false)
  applyWindowAppearance(destroyed, "win32", "ink", false)
  applyWindowAppearance(mac, "darwin", "ink", false)
  applyWindowAppearance(linux, "linux", "paper", true)
  assert.deepEqual(destroyed.backgrounds, []); assert.deepEqual(destroyed.overlays, [])
  assert.deepEqual(mac.overlays, []); assert.deepEqual(linux.overlays, [])
})

// Evaluate each real BrowserWindow options expression, with cold-host values.
// This checks constructor wiring; it is not a native Windows rendering test.
for (const file of ["index", "root-maintenance-window", "root-relocation-window"]) test(`WTHEME-06 ${file} constructor has a transparent native caption`, async () => {
  const source = readFileSync(`desktop/main/${file}.ts`, "utf8")
  const tree = ts.createSourceFile(file + ".ts", source, ts.ScriptTarget.Latest, true)
  let options: ts.Expression | undefined
  walk(tree, node => {
    if (ts.isNewExpression(node) && node.expression.getText(tree) === "BrowserWindow" && node.arguments?.[0]?.getText(tree).includes("titleBarStyle")) options = node.arguments[0]
  })
  assert(options)
  let nativeWindowAppearance: Awaited<ReturnType<typeof helper>>["nativeWindowAppearance"] | undefined
  try { nativeWindowAppearance = (await helper()).nativeWindowAppearance } catch { /* Old constructors still execute, providing a substantive red baseline. */ }
  for (const theme of ["paper", "ink"] as const) {
    const dark = theme === "ink", nativeAppearance = nativeWindowAppearance?.(theme, dark)
    const module = { exports: {} as { titleBarOverlay: { color: string; symbolColor: string; height: number } } }
    new Function("module", "process", "theme", "dark", "nativeAppearance", "backgroundColor", "isolated", "join", "__dirname", compile(`module.exports = ${options.getText(tree)}`))(
      module, { platform: "win32" }, theme, dark, nativeAppearance, dark ? "#171312" : "#faf5e8", {}, (...parts: string[]) => parts.join("/"), "isolated")
    assert.equal(module.exports.titleBarOverlay.color, "#00000000")
    assert.equal(module.exports.titleBarOverlay.symbolColor, palette(theme).foreground)
    assert.equal(module.exports.titleBarOverlay.height, 44)
  }
})
