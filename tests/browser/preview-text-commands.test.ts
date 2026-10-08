import test from "node:test"
import assert from "node:assert/strict"
import { buildSync } from "esbuild"
import { chromium, type Browser, type Page } from "playwright-core"
// Actual isolated Chromium DOM Range/Selection + real hook function bodies.
// All external HTTP is blocked and clipboard/model/editor IO uses controlled
// substitutes. This is not Electron GUI, real clipboard or native acceptance.
const executable = process.env.XAANINK_TEST_CHROMIUM
const bundle = (entry: string) => buildSync({ entryPoints: [entry], bundle: true, platform: "browser", format: "cjs", write: false, external: ["react", "@/stores/tabs", "@/lib/desktop/command-runtime"], tsconfig: "tsconfig.json" }).outputFiles[0].text
const hookCode = bundle("src/components/editor/use-editor-commands.ts"), helperCode = bundle("src/lib/desktop/preview-text-commands.ts")
let browser: Browser
test.before(async () => { browser = await chromium.launch({ headless: true, ...(executable ? { executablePath: executable } : {}) }) })
test.after(async () => { await browser?.close() })
async function fixture(options: { readOnly?: boolean; editingMode?: "edit" | "split" | null; desktop?: boolean; model?: boolean } = {}) {
  const page = await browser.newPage()
  await page.addInitScript("globalThis.__name = (target) => target")
  await page.route("**/*", route => route.abort())
  await page.setContent('<div id="root" class="desktop-markdown-editor"><div id="preview" tabindex="-1"><div class="markdown-body"><div><div data-block="0"><p id="first">Alpha<button id="toggle">TOGGLE UI</button></p></div><aside id="comment">PRIVATE COMMENT<textarea id="comment-input"></textarea></aside><div data-block="1"><p id="last">Beta</p></div></div></div></div><div class="monaco-editor"><textarea id="native" class="inputarea"></textarea><input id="find"></div></div><input id="outside">')
  await page.evaluate("globalThis.__name = (target) => target")
  await page.evaluate(({ hookCode, helperCode, options }) => {
    const w = window as any, root = document.getElementById("root")!, preview = document.getElementById("preview")!, native = document.getElementById("native") as HTMLTextAreaElement
    let source = "Alpha\n\nBeta", mode = options.model ? "split" : "preview", refs: any[] = [], cursor = 0, effectCursor = 0, effects: Array<{ deps: unknown[]; cleanup?: () => void }> = []
    const calls = { reads: 0, writes: [] as string[], webReads: 0, webWrites: [] as string[], edits: [] as unknown[], undo: 0, modes: [] as string[] }
    const clipboard = { text: "NEW", gate: null as null | { promise: Promise<string>; resolve(value: string): void } }
    const listeners = new Set<(state: unknown, previous: unknown) => void>(), tabs = { activeTabId: "a", activationNonce: 0 }
    const editorRef: { current: any } = { current: null }, previewRef = { current: preview }, rootRef = { current: root }, ref: { current: any } = { current: null }
    let handle: any
    const model = (text = source) => ({ text, getValue() { return this.text }, getOffsetAt(position: any) { return this.text.split("\n").slice(0, position.lineNumber - 1).reduce((offset: number, line: string) => offset + line.length + 1, 0) + position.column - 1 }, getPositionAt(offset: number) { const before = this.text.slice(0, offset).split("\n"); return { lineNumber: before.length, column: before.at(-1)!.length + 1 } }, getValueInRange(range: any) { return this.text.slice(this.getOffsetAt({ lineNumber: range.startLineNumber, column: range.startColumn }), this.getOffsetAt({ lineNumber: range.endLineNumber, column: range.endColumn })) } })
    const instance = (text = source) => {
      const data = model(text); let range = { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 6 }
      return { data, getModel: () => data, getSelection: () => ({ ...range, getStartPosition: () => ({ lineNumber: range.startLineNumber, column: range.startColumn }), getEndPosition: () => ({ lineNumber: range.endLineNumber, column: range.endColumn }) }), hasTextFocus: () => false,
        getRawOptions: () => ({ readOnly: false }),
        setSelection: (next: typeof range) => { range = next }, pushUndoStop: () => { calls.undo++ }, executeEdits: (origin: string, edits: any[]) => { calls.edits.push({ origin, edits }); for (const edit of edits) data.text = data.text.slice(0, data.getOffsetAt({ lineNumber: edit.range.startLineNumber, column: edit.range.startColumn })) + edit.text + data.text.slice(data.getOffsetAt({ lineNumber: edit.range.endLineNumber, column: edit.range.endColumn })); return true }, revealRangeInCenterIfOutsideViewport() {}, focus: () => native.focus() }
    }
    function render(patch: any = {}) {
      if (patch.value !== undefined) source = patch.value
      if (patch.readOnly !== undefined) options.readOnly = patch.readOnly
      if (patch.mode !== undefined) mode = patch.mode
      cursor = 0; effectCursor = 0
      handle = hook.useEditorCommands({ ref, value: source, readOnly: options.readOnly, mode, editingMode: options.editingMode === undefined ? "edit" : options.editingMode,
        setMode(next: string) { calls.modes.push(next); if (options.editingMode === null) return; mode = next; editorRef.current = instance(); render(); handle(editorRef.current) }, editorRef, previewRef, rootRef })
    }
    const react = { useRef(initial: unknown) { return refs[cursor++] ?? (refs[cursor - 1] = { current: initial }) }, useMemo(create: () => unknown) { return create() }, useImperativeHandle(target: any, create: () => unknown) { if (typeof target === "function") target(create()); else if (target) target.current = create() }, useEffect(create: () => void | (() => void), deps: unknown[] = []) { const index = effectCursor++, old = effects[index]; if (!old || deps.length !== old.deps.length || deps.some((d, n) => d !== old.deps[n])) { old?.cleanup?.(); const cleanup = create(); effects[index] = { deps, cleanup: typeof cleanup === "function" ? cleanup : undefined } } } }
    const module = { exports: {} as any }, helperModule = { exports: {} as any }
    const require = (name: string) => name === "react" ? react : name === "@/stores/tabs" ? { useTabsStore: { getState: () => tabs, subscribe: (fn: (state: unknown, previous: unknown) => void) => { listeners.add(fn); return () => listeners.delete(fn) } } } : name === "@/lib/desktop/command-runtime" ? { registerDesktopCommandTarget: () => () => {} } : (() => { throw Error(`Unexpected ${name}`) })()
    new Function("module", "exports", "require", hookCode)(module, module.exports, require); const hook = module.exports
    new Function("module", "exports", "require", helperCode)(helperModule, helperModule.exports, require)
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { readText: async () => { calls.webReads++; return clipboard.text }, writeText: async (text: string) => { calls.webWrites.push(text) } } })
    if (options.desktop !== false) w.desktop = { readClipboardText: async () => { calls.reads++; return clipboard.gate?.promise ?? clipboard.text }, writeClipboardText: async (text: string) => { calls.writes.push(text) } }
    if (options.model) editorRef.current = instance()
    render()
    let target: any
    const disposeTarget = helperModule.exports.installPreviewTextCommands({ preview: () => preview, handle: () => ref.current, registerTarget: (next: any) => { target = next; return () => { target = null } } })
    function select(start = 0, end = 4) { const range = document.createRange(); range.setStart(document.getElementById("first")!.firstChild!, start); range.setEnd(document.getElementById("last")!.firstChild!, end); window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range); preview.focus() }
    select()
    w.f = { calls, ref, render, editorRef, instance, previewRef, rootRef, preview, select, command: (id: string) => { ref.current.captureSelection(); return ref.current.executeCommand(id) }, target: () => target, tabs, navigate() { const previous = { ...tabs }; tabs.activationNonce++; for (const listener of listeners) listener(tabs, previous) }, clipboard,
      gate() { let resolve!: (value: string) => void; const promise = new Promise<string>(r => { resolve = r }); clipboard.gate = { promise, resolve } }, dispose() { disposeTarget(); for (const effect of effects) effect.cleanup?.() } }
  }, { hookCode, helperCode, options })
  return page
}
async function scenario(options: Parameters<typeof fixture>[0], run: (page: Page) => Promise<void>) { const page = await fixture(options); try { await run(page) } finally { await page.evaluate(() => (window as any).f.dispose()); await page.close() } }
test("preview-only readonly selectAll completes in DOM without mounting Monaco or changing mode", async () => scenario({ readOnly: true, editingMode: null }, async page => {
  const result = await page.evaluate(async () => { const f = (window as any).f; const pending = f.ref.current.executeCommand("selectAll").then(() => "done", (e: Error) => e.message); const done = await Promise.race([pending, new Promise(resolve => setTimeout(() => resolve("pending"), 30))]); return { done, modes: f.calls.modes, selection: window.getSelection()!.toString() } })
  assert.equal(result.done, "done"); assert.deepEqual(result.modes, []); assert.match(result.selection, /Alpha/)
}))
test("copy selects only rendered manuscript words across comment UI, and uses the desktop write bridge", async () => scenario({}, async page => {
  const calls = await page.evaluate(async () => { const f = (window as any).f; await f.command("copy"); return f.calls })
  assert.deepEqual(calls.writes, ["Alpha\n\nBeta"]); assert.deepEqual(calls.webWrites, []); assert.deepEqual(calls.edits, [])
}))
test("desktop pastePlain uses read bridge, existing Monaco executeEdits and paired undo boundaries", async () => scenario({ model: true }, async page => {
  const calls = await page.evaluate(async () => { const f = (window as any).f; await f.command("pastePlain"); return f.calls })
  assert.equal(calls.reads, 1); assert.equal(calls.webReads, 0); assert.equal(calls.undo, 2); assert.equal(calls.edits.length, 1)
  assert.equal((calls.edits[0] as any).origin, "manuscript-menu"); assert.equal((calls.edits[0] as any).edits[0].text, "NEW")
}))
test("readonly and preview-only mutations reject before clipboard IO or mode changes", async () => {
  for (const options of [{ readOnly: true }, { editingMode: null }]) await scenario(options as any, async page => {
    const result = await page.evaluate(async () => { const f = (window as any).f; const errors = []; for (const id of ["cut", "paste", "pastePlain"]) { f.ref.current.captureSelection(); errors.push(await Promise.race([f.ref.current.executeCommand(id).then(() => "done", (e: Error) => e.message), new Promise(resolve => setTimeout(() => resolve("pending"), 30))])) } return { errors, calls: f.calls } })
    assert.ok(result.errors.every(error => error !== "done" && error !== "pending")); assert.equal(result.calls.reads, 0); assert.equal(result.calls.webReads, 0); assert.deepEqual(result.calls.writes, []); assert.deepEqual(result.calls.modes, [])
  })
})
test("async paste rejects focus A to B to A, preserving the current manuscript", async () => scenario({ model: true }, async page => {
  const result = await page.evaluate(async () => { const f = (window as any).f; f.gate(); const pending = f.command("paste").then(() => true, () => false); document.getElementById("outside")!.focus(); f.preview.focus(); f.clipboard.gate.resolve("LATE"); return { ok: await pending, edits: f.calls.edits } })
  assert.equal(result.ok, false); assert.deepEqual(result.edits, [])
}))
test("async paste rejects source A to B to A and Tab activation A to B to A", async () => {
  for (const change of ["value", "tab"]) await scenario({ model: true }, async page => {
    const result = await page.evaluate(async change => { const f = (window as any).f; f.gate(); const pending = f.command("paste").then(() => true, () => false); if (change === "value") { f.render({ value: "temporary source" }); f.render({ value: "Alpha\n\nBeta" }) } else { f.navigate(); f.navigate() } f.clipboard.gate.resolve("LATE"); return { ok: await pending, edits: f.calls.edits } }, change)
    assert.equal(result.ok, false); assert.deepEqual(result.edits, [])
  })
})
test("same-text model replacement while clipboard is pending cannot receive old edits", async () => scenario({ model: true }, async page => {
  const result = await page.evaluate(async () => { const f = (window as any).f; f.gate(); const pending = f.command("paste").then(() => true, () => false); f.editorRef.current = f.instance(); f.clipboard.gate.resolve("LATE"); return { ok: await pending, edits: f.calls.edits } })
  assert.equal(result.ok, false); assert.deepEqual(result.edits, [])
}))
test("preview command target rejects comment/find inputs and Monaco surface while accepting manuscript nodes only", async () => scenario({}, async page => {
  const result = await page.evaluate(() => { const target = (window as any).f.target(); return { exists: !!target, body: target?.accepts(document.getElementById("first")), comment: target?.accepts(document.getElementById("comment-input")), bubble: target?.accepts(document.getElementById("comment")), find: target?.accepts(document.getElementById("find")), native: target?.accepts(document.getElementById("native")), ids: Object.keys(target?.commands ?? {}) } })
  assert.equal(result.exists, true); assert.equal(result.body, true); assert.equal(result.comment, false); assert.equal(result.bubble, false); assert.equal(result.find, false); assert.equal(result.native, false)
  assert.deepEqual(result.ids.sort(), ["text.copy", "text.cut", "text.paste", "text.pastePlain", "text.selectAll"].sort())
}))
test("Web fallback still uses navigator clipboard when the desktop bridge is absent", async () => scenario({ desktop: false }, async page => {
  const calls = await page.evaluate(async () => { const f = (window as any).f; await f.command("copy"); return f.calls })
  assert.equal(calls.webWrites.length, 1); assert.deepEqual(calls.writes, [])
}))
test("a changed DOM selection during the final animation frame cannot receive the captured edit", async () => scenario({ model: true }, async page => {
  const result = await page.evaluate(async () => {
    const f = (window as any).f, frames: FrameRequestCallback[] = [], old = window.requestAnimationFrame
    window.requestAnimationFrame = callback => { frames.push(callback); return frames.length }
    const pending = f.command("paste").then(() => true, () => false)
    for (let n = 0; n < 10; n++) await Promise.resolve()
    f.select(2, 2)
    frames.shift()!(0); const ok = await pending; window.requestAnimationFrame = old
    return { ok, edits: f.calls.edits }
  })
  assert.equal(result.ok, false); assert.deepEqual(result.edits, [])
}))
test("actual Monaco readonly rejects mutations before clipboard IO and a rejected edit is not reported successful", async () => {
  await scenario({ model: true }, async page => {
    const result = await page.evaluate(async () => { const f = (window as any).f; f.editorRef.current.getRawOptions = () => ({ readOnly: true }); return { ok: await f.command("cut").then(() => true, () => false), calls: f.calls } })
    assert.equal(result.ok, false); assert.deepEqual(result.calls.writes, []); assert.deepEqual(result.calls.edits, [])
  })
  await scenario({ model: true }, async page => {
    const result = await page.evaluate(async () => { const f = (window as any).f; f.editorRef.current.executeEdits = () => false; return await f.command("paste").then(() => true, () => false) })
    assert.equal(result, false)
  })
})
test("editable preview transitions once to a newly mounted editor and keeps its undo/autosave edit path", async () => scenario({}, async page => {
  const calls = await page.evaluate(async () => { const f = (window as any).f; await f.command("paste"); return f.calls })
  assert.deepEqual(calls.modes, ["edit"]); assert.equal(calls.reads, 1); assert.equal(calls.undo, 2); assert.equal(calls.edits.length, 1)
}))
test("readonly full-body DOM selection copies without comment words and without an editor transition", async () => scenario({ readOnly: true, editingMode: null }, async page => {
  const calls = await page.evaluate(async () => { const f = (window as any).f; await f.ref.current.executeCommand("selectAll"); await f.command("copy"); return f.calls })
  assert.deepEqual(calls.writes, ["Alpha\n\nBeta"]); assert.deepEqual(calls.modes, []); assert.deepEqual(calls.edits, [])
}))
test("mutable cut writes only manuscript text and deletes through the existing paired undo edit path", async () => scenario({ model: true }, async page => {
  const result = await page.evaluate(async () => { const f = (window as any).f; await f.command("cut"); return { calls: f.calls, source: f.editorRef.current.data.text } })
  assert.deepEqual(result.calls.writes, ["Alpha\n\nBeta"]); assert.equal(result.calls.undo, 2); assert.equal(result.calls.edits.length, 1); assert.equal(result.source, "")
}))
test("disposing a preview while clipboard reading is pending does not apply its old operation", async () => scenario({ model: true }, async page => {
  const result = await page.evaluate(async () => { const f = (window as any).f; f.gate(); const pending = f.command("paste").then(() => true, () => false); f.dispose(); f.clipboard.gate.resolve("LATE"); return { ok: await pending, edits: f.calls.edits } })
  assert.equal(result.ok, false); assert.deepEqual(result.edits, [])
}))
test("desktop clipboard failures use local errors and do not instruct browser permissions or edit text", async () => scenario({ model: true }, async page => {
  const result = await page.evaluate(async () => {
    const w = window as any, f = w.f
    w.desktop.writeClipboardText = async () => { throw Error("private platform detail") }
    w.desktop.readClipboardText = async () => { throw Error("private platform detail") }
    const errors = []
    for (const id of ["cut", "pastePlain"]) errors.push(await f.command(id).then(() => "done", (error: Error) => error.message))
    return { errors, edits: f.calls.edits }
  })
  assert.deepEqual(result.errors, ["无法写入本地剪贴板，请重试", "无法读取本地剪贴板，请重试"]); assert.deepEqual(result.edits, [])
}))
