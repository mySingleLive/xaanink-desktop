import assert from "node:assert/strict"
import { test } from "node:test"
import { buildMonacoCommandCatalog, createMonacoCommandTarget, monacoBinding, monacoRuntimeFromRegistries, registerMonacoEditorCommands, type MonacoAction, type MonacoEditorTarget, type MonacoRuntime, type MonacoRuntimeRegistries } from "../../src/lib/desktop/monaco-commands"
import { CommandTargets } from "../../src/lib/desktop/command-targets"
import { markdownFormats } from "../../src/lib/desktop/markdown-actions"
import { ShortcutDispatcher } from "../../desktop/core/shortcut-dispatch"
// Installed Monaco's real decoding implementation, including >2-stroke arrays.
// @ts-expect-error Monaco publishes this internal JavaScript without .d.ts.
import { decodeKeybinding } from "monaco-editor/base/common/keybindings.js"
// @ts-expect-error Version-pinned internal JavaScript.
import { KeyCodeUtils } from "monaco-editor/base/common/keyCodes.js"
// @ts-expect-error Version-pinned internal JavaScript.
import { KeybindingsRegistry } from "monaco-editor/platform/keybinding/common/keybindingsRegistry.js"
// @ts-expect-error Version-pinned internal JavaScript.
import { OS } from "monaco-editor/base/common/platform.js"
const expr = (text: string) => ({ serialize: () => text })
function runtime(): MonacoRuntime {
  return { version: "0.56.0", actions: [], bindings: [], keyName: KeyCodeUtils.toUserSettingsUS, command: () => ({}), contextMatches: (_editor, value) => value?.serialize() !== "false" }
}
function editor() {
  const child = {} as HTMLElement, outside = {} as HTMLElement, model = {}
  let connected = true, readonly = false, supported = true, run = 0, focus = 0
  const dom = { getClientRects:()=>[{}], get isConnected() { return connected }, contains: (target: HTMLElement | null) => target === child } as unknown as HTMLElement
  Object.assign(child,{closest:(selector:string)=>selector.includes(".monaco-editor")?dom:null,matches:()=>false})
  Object.assign(outside,{closest:()=>null,matches:()=>false})
  const action: MonacoAction = { id: "editor.action.fixture", label: "Fixture", isSupported: () => supported, run: async () => { run++ } }
  const triggers: { id: string; args: unknown }[] = []
  const value: MonacoEditorTarget = { getDomNode: () => dom, getModel: () => connected ? model : null, getRawOptions: () => ({ readOnly: readonly }), getSupportedActions: () => supported ? [action] : [], getAction: id => id === action.id ? action : null, focus: () => { focus++ }, trigger: (_source, id, args) => { triggers.push({ id, args }) } }
  return { value, child, outside, action, triggers, run: () => run, focus: () => focus, readonly: (v: boolean) => { readonly = v }, supported: (v: boolean) => { supported = v }, disconnect: () => { connected = false } }
}
test("MONACO-01: runtime catalog includes all registrations beyond the former static limit and unbound actions", () => {
  const r = runtime(); r.actions = Array.from({ length: 180 }, (_, i) => ({ id: `editor.action.extra-${i}`, label: `Extra ${i}` }))
  r.bindings = [{ command: "cursorLeft", keybinding: decodeKeybinding(15, 2) }]
  const commands = buildMonacoCommandCatalog(r, "darwin")
  assert.equal(commands.length, 181)
  assert.deepEqual(commands.find(c => c.monacoId === "editor.action.extra-179")?.defaults, [])
  assert.ok(commands.some(c => c.monacoId === "cursorLeft"))
})
test("MONACO-02: aliases share desktop editing IDs without duplicate raw rows", () => {
  const r = runtime(); r.actions = [{ id: "actions.find", label: "Find" }, { id: "editor.action.startFindReplaceAction", label: "Replace" }]
  r.bindings = [{ command: "undo", keybinding: decodeKeybinding(2048 | 56, 2) }, { command: "editor.action.selectAll", keybinding: decodeKeybinding(2048 | 31, 2) }]
  assert.deepEqual(buildMonacoCommandCatalog(r, "darwin").map(c => c.id).sort(), ["md.find", "md.replace", "text.selectAll", "text.undo"].sort())
})
test("MONACO-03: installed decode preserves three-stroke chords, secondary bindings, physical punctuation and OS modifiers", () => {
  const r = runtime()
  const encoded = [2048 | 41, 2048 | 33, 256 | 512 | 104]
  assert.equal(monacoBinding(decodeKeybinding(encoded, 2), r, "darwin"), "Cmd+K Cmd+C Ctrl+Alt+Numpad6")
  assert.equal(monacoBinding(decodeKeybinding(encoded, 1), r, "win32"), "Ctrl+K Ctrl+C Win+Alt+Numpad6")
  assert.equal(monacoBinding(decodeKeybinding(2048 | 1024 | 86, 2), r, "darwin"), "Cmd+Shift+Equal")
  assert.equal(monacoBinding(decodeKeybinding(90, 2), r, "darwin"), "Slash")
})
test("MONACO-04: same-key conditional defaults retain both predicates and never collapse different command arguments", () => {
  const r = runtime(); const keybinding = decodeKeybinding(3, 2)
  r.bindings = [
    { command: "editor.action.acceptSuggestion", keybinding, when: expr("suggestWidgetVisible"), weight1: 100 },
    { command: "editor.action.insertLineAfter", keybinding, when: expr("!suggestWidgetVisible"), weight1: 50 },
    { command: "cursorMove", keybinding: decodeKeybinding(16, 2), commandArgs: { to: "up" }, when: expr("editorTextFocus") },
    { command: "cursorMove", keybinding: decodeKeybinding(18, 2), commandArgs: { to: "down" }, when: expr("editorTextFocus") },
  ]
  const rows = buildMonacoCommandCatalog(r, "darwin")
  assert.equal(rows.length, 4)
  assert.deepEqual(rows.filter(c => c.defaults.includes("Enter")).map(c => c.monacoBindings[0].when).sort(), ["!suggestWidgetVisible", "suggestWidgetVisible"])
  const cursor = rows.filter(c => c.monacoId === "cursorMove"); assert.equal(new Set(cursor.map(c => c.id)).size, 2)
  assert.deepEqual(cursor.map(c => c.monacoArgs), [{ to: "up" }, { to: "down" }])
})
test("MONACO-05: supported instance actions extend the assembled catalog, with repeated bindings de-duplicated only per command", () => {
  const r = runtime(), e = editor(); r.actions = [{ id: e.action.id, label: "Fixture" }]
  r.bindings = Array.from({ length: 3 }, () => ({ command: e.action.id, keybinding: decodeKeybinding(2048 | 36, 2), when: expr("editorTextFocus") }))
  const rows = buildMonacoCommandCatalog(r, "darwin", [e.action, { ...e.action, id: "user.extra" }])
  assert.equal(rows.length, 2); assert.deepEqual(rows.find(c => c.monacoId === e.action.id)?.defaults, ["Cmd+F"])
})
test("MONACO-06: captured focus routes one target only; another editor or removed editor never receives execution", async () => {
  const r = runtime(), a = editor(), b = editor(); r.actions = [{ id: a.action.id, label: "Fixture" }]
  const rows = buildMonacoCommandCatalog(r, "darwin"), hub = new CommandTargets<HTMLElement | null>()
  hub.register(createMonacoCommandTarget(a.value, r, rows)); hub.register(createMonacoCommandTarget(b.value, r, rows))
  const id = rows[0]?.id ?? "monaco.editor.action.fixture"
  assert.equal(await hub.execute(id, a.outside), false)
  assert.equal(await hub.execute(id, a.child), true); assert.equal(a.run(), 1); assert.equal(b.run(), 0)
  const captured = hub.capture(id, a.child); assert.ok(captured); a.disconnect()
  assert.equal(await captured(), false); assert.equal(a.run(), 1)
})
test("MONACO-07: action support and editor-command preconditions are rechecked; native undo and readOnly are preserved", async () => {
  const r = runtime(), e = editor(); r.actions = [{ id: e.action.id, label: "Fixture" }]
  r.bindings = [{ command: "undo", keybinding: decodeKeybinding(2048 | 56, 2) }]
  const rows = buildMonacoCommandCatalog(r, "darwin"), hub = new CommandTargets<HTMLElement | null>(); hub.register(createMonacoCommandTarget(e.value, r, rows))
  e.supported(false); assert.equal(await hub.execute("monaco." + e.action.id, e.child), false)
  e.supported(true); assert.equal(await hub.execute("monaco." + e.action.id, e.child), true)
  e.readonly(true); assert.equal(await hub.execute("text.undo", e.child), false); assert.equal(e.triggers.length, 0)
  e.readonly(false); assert.equal(await hub.execute("text.undo", e.child), true); assert.deepEqual(e.triggers.map(c => c.id), ["undo"])
  r.command = () => ({ precondition: expr("false") }); assert.equal(await hub.execute("text.undo", e.child), false)
})
test("MONACO-08: parameterized registrations execute only their own immutable arguments", async () => {
  const r = runtime(), e = editor(); const args = { to: "up", value: 1 }
  r.bindings = [{ command: "cursorMove", keybinding: decodeKeybinding(16, 2), commandArgs: args }]
  const rows = buildMonacoCommandCatalog(r, "darwin"); args.to = "down"
  const hub = new CommandTargets<HTMLElement | null>(); hub.register(createMonacoCommandTarget(e.value, r, rows))
  assert.equal(await hub.execute(rows[0]?.id ?? "missing", e.child), true)
  assert.deepEqual(e.triggers[0], { id: "cursorMove", args: { to: "up", value: 1 } })
})
test("MONACO-09: incompatible private runtime versions fail closed instead of pretending the catalog is complete", () => {
  const r = runtime(); r.version = "0.57.0"
  assert.throws(() => buildMonacoCommandCatalog(r, "darwin"), /MONACO_RUNTIME_VERSION_UNSUPPORTED/)
})
test("MONACO-10: installed registration API supplies primary and secondary bindings with serialized conditions", () => {
  const registration = KeybindingsRegistry.registerKeybindingRule({ id: "unit.monaco.registry", primary: 2048 | 41, secondary: [(2048 | 41) | ((2048 | 33) << 16)], weight: 100, when: expr("editorTextFocus") })
  try {
    const source: MonacoRuntimeRegistries = { version: "0.56.0", os: OS, keys: KeybindingsRegistry, keyName: KeyCodeUtils.toUserSettingsUS, editors: { getEditorActions: () => [{ id: "unit.unbound", label: "Unbound" }], getEditorCommand: () => null }, commands: { getCommand: () => ({}) }, contextKeyToken: "unitContext" }
    const platform = OS === 2 ? "darwin" : "win32"
    const r = monacoRuntimeFromRegistries(source, platform), rows = buildMonacoCommandCatalog(r, platform)
    const item = rows.find(c => c.monacoId === "unit.monaco.registry")!
    const mod = platform === "darwin" ? "Cmd" : "Ctrl"
    assert.deepEqual(item.defaults, [`${mod}+K ${mod}+C`, `${mod}+K`])
    assert.deepEqual(item.monacoBindings.map(x => x.when), ["editorTextFocus", "editorTextFocus"])
    assert.ok(rows.some(c => c.monacoId === "unit.unbound"))
  } finally { registration.dispose() }
})
test("MONACO-11: private context adapter is version guarded and a missing scoped context never enables a command", () => {
  const e = editor(), token = {}
  const source: MonacoRuntimeRegistries = { version: "0.56.0", os: 2, keys: { getDefaultKeybindings: () => [] }, keyName: KeyCodeUtils.toUserSettingsUS, editors: { getEditorActions: () => [], getEditorCommand: () => null }, commands: { getCommand: () => ({}) }, contextKeyToken: token }
  const r = monacoRuntimeFromRegistries(source, "darwin")
  assert.equal(r.contextMatches(e.value, expr("editorWritable")), false)
  const scoped = Object.assign(e.value, { invokeWithinContext: (run: (accessor: { get(t: unknown): unknown }) => unknown) => run({ get: value => { assert.equal(value, token); return { contextMatchesRules: (rule: { serialize(): string }) => rule.serialize() === "editorWritable" } } }) })
  assert.equal(r.contextMatches(scoped, expr("editorWritable")), true)
  assert.throws(() => monacoRuntimeFromRegistries({ ...source, os: 1 }, "darwin"), /MONACO_RUNTIME_PLATFORM_MISMATCH/)
  assert.throws(() => monacoRuntimeFromRegistries({ ...source, version: "0.57.0" }, "darwin"), /MONACO_RUNTIME_VERSION_UNSUPPORTED/)
})
test("MONACO-12: editor registration publishes its supported actions, refreshes on focus and disposes every owner/subscription", async () => {
  const r = runtime(), e = editor(), hub = new CommandTargets<HTMLElement | null>()
  let published = 0, owners = 0, listening = 0
  let focus: () => void = () => {}
  e.value.onDidFocusEditorText = callback => { focus = callback; listening++; return { dispose() { listening-- } } }
  const dispose = registerMonacoEditorCommands(e.value, r, "darwin", {
    publish: (_owner, rows) => { assert.ok(rows.some(row => row.monacoId === e.action.id)); published++; owners++; return () => { owners-- } },
    register: target => hub.register(target),
  })
  assert.equal(owners, 1); assert.equal(listening, 1)
  focus(); assert.equal(published, 2); assert.equal(owners, 1)
  assert.equal(await hub.execute("monaco." + e.action.id, e.child), true)
  dispose(); dispose(); assert.equal(owners, 0); assert.equal(listening, 0)
  assert.equal(await hub.execute("monaco." + e.action.id, e.child), false)
})
test("MONACO-13: a parameterized action checks its own arguments and condition rather than a sibling default", async () => {
  const r = runtime(), e = editor(); r.actions = [{ id: e.action.id, label: "Fixture" }]
  r.bindings = [
    { command: e.action.id, keybinding: decodeKeybinding(16, 2), commandArgs: { selection: true }, when: expr("false") },
    { command: e.action.id, keybinding: decodeKeybinding(18, 2), when: expr("true") },
  ]
  const rows = buildMonacoCommandCatalog(r, "darwin"), hub = new CommandTargets<HTMLElement | null>(); hub.register(createMonacoCommandTarget(e.value, r, rows))
  const variant = rows.find(row => row.monacoArgs !== undefined)!
  assert.equal(await hub.execute(variant.id, e.child), false)
  assert.equal(e.triggers.length, 0)
  assert.equal(await hub.execute("monaco." + e.action.id, e.child), true)
  assert.equal(e.run(), 1)
})
test("MONACO-14: explicit null command arguments remain distinct from no arguments", async () => {
  const r = runtime(), e = editor()
  r.bindings = [
    { command: "cursorMove", keybinding: decodeKeybinding(16, 2), commandArgs: null, when: expr("false") },
    { command: "cursorMove", keybinding: decodeKeybinding(18, 2), when: expr("true") },
  ]
  const rows = buildMonacoCommandCatalog(r, "darwin"), hub = new CommandTargets<HTMLElement | null>(); hub.register(createMonacoCommandTarget(e.value, r, rows))
  const variant = rows.find(row => row.monacoArgs === null)!
  assert.equal(await hub.execute(variant.id, e.child), false)
  assert.equal(await hub.execute("monaco.cursorMove", e.child), true)
})
test("MONACO-15: app Markdown actions keep one shared md ID and an unknown static Markdown command stays unavailable", async () => {
  const r = runtime(), e = editor(); r.actions = markdownFormats.map(([id, label]) => ({ id, label })); r.command = () => null
  const rows = buildMonacoCommandCatalog(r, "darwin")
  assert.deepEqual(rows.map(row => row.id), markdownFormats.map(([id]) => id))
  const hub = new CommandTargets<HTMLElement | null>(); hub.register(createMonacoCommandTarget(e.value, r, rows))
  assert.equal(await hub.execute("md.unknown", e.child), false)
  assert.equal(await hub.execute("md.comment", e.child), false, "comment creation requires the app's real comment target handler")
})
test("MONACO-16: removed native defaults and chord prefixes are blocked while new bindings resolve to the same native action", () => {
  const r = runtime(); r.actions = [{ id: "editor.action.fixture", label: "Fixture" }]
  r.bindings = [{ command: "editor.action.fixture", keybinding: decodeKeybinding([2048 | 41, 2048 | 33], 2), when: expr("editorTextFocus") }]
  const rows = buildMonacoCommandCatalog(r, "darwin"), id = rows[0].id
  const key = (letter: string) => ({ key: letter, code: "Key" + letter, ctrlKey: false, metaKey: true, shiftKey: false, altKey: false, repeat: false, isComposing: false, keyCode: 0 })
  const context = { commands: rows, overrides: { [id]: ["Cmd+M"] }, platform: "darwin" as const, scope: "markdown" as const, focus: {} }
  assert.deepEqual(new ShortcutDispatcher().key(key("K"), context), { kind: "blocked" })
  assert.deepEqual(new ShortcutDispatcher().key(key("M"), context), { kind: "run", id })
  assert.deepEqual(new ShortcutDispatcher().key(key("K"), { ...context, overrides: { [id]: [] } }), { kind: "blocked" })
})
test("MONACO-17: a core command precondition never replaces its parameter registration's narrower when", async () => {
  const r = runtime(), e = editor(); r.command = () => ({ precondition: expr("true") })
  r.bindings = [{ command: "cursorMove", keybinding: decodeKeybinding(16, 2), commandArgs: { to: "up" }, when: expr("false") }]
  const rows = buildMonacoCommandCatalog(r, "darwin"), hub = new CommandTargets<HTMLElement | null>(); hub.register(createMonacoCommandTarget(e.value, r, rows))
  assert.equal(await hub.execute(rows[0].id, e.child), false)
  assert.equal(e.triggers.length, 0)
})
test("MONACO-18: public instance IDs normalize custom actions back to the descriptor lookup ID without stripping unrelated colon IDs",async()=>{
  const r=runtime(),e=editor(),hub=new CommandTargets<HTMLElement|null>(),instanceId="vs.editor.ICodeEditor:7",descriptor="user.extra"
  e.action.id=`${instanceId}:${descriptor}`
  e.value.getId=()=>instanceId
  e.value.getAction=id=>id===descriptor?e.action:null
  let published:string[]=[]
  const remove=registerMonacoEditorCommands(e.value,r,"darwin",{publish:(_owner,rows)=>{published=rows.map(row=>row.monacoId);return()=>{}},register:target=>hub.register(target)})
  try{assert.deepEqual(published,[descriptor]);assert.equal(await hub.execute("monaco.user.extra",e.child),true);assert.equal(e.run(),1)}finally{remove()}
  const unrelated={...e.action,id:"extension:literal:command"}
  assert.equal(buildMonacoCommandCatalog(r,"darwin",[unrelated],instanceId)[0].monacoId,unrelated.id)
})
test("MONACO-19: a ViewZone comment textarea and find input never route text or Markdown commands to the manuscript",()=>{
  const r=runtime(),e=editor()
  r.actions=[{id:e.action.id,label:"Fixture"}]
  const dom=e.value.getDomNode()!,contained=new Set<unknown>()
  Object.assign(dom,{contains:(target:unknown)=>contained.has(target)})
  function control(native:boolean,tagName:"INPUT"|"TEXTAREA"){
    const node={tagName,isConnected:true,
      matches:(selector:string)=>native&&(selector.includes(".inputarea")||selector.includes(".native-edit-context"))||selector.split(",").some(part=>part.trim().toUpperCase()===tagName),
      closest:(selector:string)=>native&&(selector.includes(".inputarea")||selector.includes(".native-edit-context"))?node:selector.includes(".monaco-editor")||selector.includes(".desktop-markdown-editor")?dom:selector.split(",").some(part=>part.trim().toUpperCase()===tagName)?node:null,
    }
    contained.add(node);return node as unknown as HTMLElement
  }
  const inputarea=control(true,"TEXTAREA"),comment=control(false,"TEXTAREA"),find=control(false,"INPUT")
  const target=createMonacoCommandTarget(e.value,r,buildMonacoCommandCatalog(r,"darwin"))
  assert.equal(target.accepts(inputarea),true,"native inputarea keeps manuscript ownership")
  assert.equal(target.accepts(comment),false,"ViewZone comment is an ordinary text owner")
  assert.equal(target.accepts(find),false,"find field must not copy or undo the manuscript")
})
