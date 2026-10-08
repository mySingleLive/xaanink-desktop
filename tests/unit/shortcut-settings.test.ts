import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { transformSync } from "esbuild"
import * as shortcuts from "../../desktop/core/shortcuts"
import catalog from "../../desktop/shared/commands.json"
import * as commandRegistry from "../../desktop/shared/command-registry"
import * as commandRuntime from "../../src/lib/desktop/command-runtime"

// Execute the real TSX event/state logic without launching or rebuilding the App.
// The hooks and primitive element surface are controlled doubles: these tests do
// not prove Base UI focus traps, Chromium keyboard defaults, or OS interception.
type Props = Record<string, unknown>
interface Element { type: string; props: Props }
interface Hook { value?: unknown; deps?: unknown[]; cleanup?: (() => void) | void }
type Bindings = Record<string, string[]>
type Listener = (event: KeyEvent) => void
interface KeyEvent {
  key: string; code: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean
  isComposing: boolean; repeat: boolean; keyCode: number; target: Surface | null
  defaultPrevented: boolean; stopped: boolean
  preventDefault(): void; stopPropagation(): void; stopImmediatePropagation(): void
}
const source = transformSync(readFileSync(new URL("../../src/components/desktop/ShortcutSettings.tsx", import.meta.url), "utf8"), { loader: "tsx", format: "cjs", jsx: "automatic" }).code
const label = (id: string) => catalog.commands.find(command => command.id === id)!.label
function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(text).join("")
  if (value && typeof value === "object" && "props" in value) return text((value as Element).props.children)
  return typeof value === "string" || typeof value === "number" ? String(value) : ""
}
function sameDeps(a?: unknown[], b?: unknown[]) { return !!a && !!b && a.length === b.length && a.every((value, index) => Object.is(value, b[index])) }
class Surface {
  connected = true
  children: Surface[] = []
  constructor(public element: Element, readonly focusSurface: (surface: Surface) => void, public parent?: Surface, public dialog?: Element) {}
  get props() { return this.element.props }
  get disabled() { return !!this.props.disabled }
  get name() { return String(this.props["aria-label"] ?? text(this.props.children)) }
  focus() { if (this.connected && !this.disabled) this.focusSurface(this) }
  matches(selector: string) {
    const attribute = selector.match(/^\[([^\]]+)\]$/)?.[1]
    return attribute ? attribute in this.props : selector === "button" && ["button", "Button"].includes(this.element.type)
  }
  querySelectorAll<T = Surface>(selector: string): T[] {
    return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll<Surface>(selector)]) as T[]
  }
  querySelector<T = Surface>(selector: string): T | null { return this.querySelectorAll<T>(selector)[0] ?? null }
}
function fixture(options: { darwin?: Bindings; win32?: Bindings; write?: () => Promise<void> } = {}) {
  const hooks: Hook[] = []; let cursor = 0
  const listeners = new Set<Listener>(), effects: Array<() => void> = [], frames: Array<() => void> = []
  let surfaces: Surface[] = [], cache = new Map<string, Surface>(), focused: Surface | null = null
  let dialogs: Surface[] = []
  const calls: unknown[] = [], errors: string[] = []
  const bootstrap = { platform: "darwin", revision: 0, settings: { shortcuts: { darwin: structuredClone(options.darwin ?? {}), win32: structuredClone(options.win32 ?? {}) } } }
  const globals = globalThis as unknown as Record<string, unknown>
  const saved = new Map(["window", "document", "requestAnimationFrame"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  const focusSurface = (surface: Surface) => {
    focused = surface
    ;(surface.props.onFocus as ((event: Props) => void) | undefined)?.({ target: surface })
  }
  globals.window = { addEventListener(_name: string, listener: Listener) { listeners.add(listener) }, removeEventListener(_name: string, listener: Listener) { listeners.delete(listener) } }
  globals.document = { getElementById(id: string) { return surfaces.find(surface => surface.props.id === id) ?? null } }
  globals.requestAnimationFrame = (callback: () => void) => { frames.push(callback); return frames.length }
  const react = {
    useSyncExternalStore(_subscribe:unknown,snapshot:()=>unknown){return snapshot()},
    useState(initial: unknown) {
      const index = cursor++; const hook = hooks[index] ?? (hooks[index] = { value: typeof initial === "function" ? initial() : initial })
      return [hook.value, (value: unknown) => { hook.value = typeof value === "function" ? value(hook.value) : value }]
    },
    useRef(initial: unknown) { const index = cursor++; return (hooks[index] ?? (hooks[index] = { value: { current: initial } })).value },
    useMemo(callback: () => unknown, deps: unknown[]) {
      const index = cursor++; const hook = hooks[index] ?? (hooks[index] = {})
      if (!sameDeps(hook.deps, deps)) { hook.value = callback(); hook.deps = deps }
      return hook.value
    },
    useEffect(callback: () => (() => void) | void, deps: unknown[]) {
      const index = cursor++; const hook = hooks[index] ?? (hooks[index] = {})
      if (!sameDeps(hook.deps, deps)) { hook.deps = deps; effects.push(() => { hook.cleanup?.(); hook.cleanup = callback() }) }
    },
  }
  const primitives = (names: string[]) => Object.fromEntries(names.map(name => [name, name]))
  const requireFixture = (name: string) => {
    if (name === "react") return react
    if (name === "react/jsx-runtime") return { jsx: (type: string, props: Props) => ({ type, props }), jsxs: (type: string, props: Props) => ({ type, props }), Fragment: "Fragment" }
    if (name === "lucide-react") return primitives(["LockKeyhole", "Pencil", "Plus", "Trash2"])
    if (name === "sonner") return { toast: { error: (message: string) => errors.push(message) } }
    if (name === "@/components/ui/dialog") return primitives(["Dialog", "DialogContent", "DialogDescription", "DialogTitle"])
    if (name === "@/components/ui/button") return primitives(["Button"])
    if (name === "@/components/ui/input") return primitives(["Input"])
    if (name === "@desktop/core/shortcuts") return shortcuts
    if (name === "@desktop/shared/commands.json") return catalog
    if (name === "@desktop/shared/command-registry") return commandRegistry
    if (name === "@/lib/desktop/command-runtime") return commandRuntime
    if (name === "@/stores/desktop") return {
      useDesktopStore: (select: (state: unknown) => unknown) => select({ bootstrap }),
      updateDesktopSettings: async (update: (before: typeof bootstrap.settings) => typeof bootstrap.settings) => {
        const next = update(structuredClone(bootstrap.settings)); calls.push(next)
        await options.write?.()
        bootstrap.settings = next; bootstrap.revision++
        return { revision: bootstrap.revision, settings: next, models: [] }
      },
    }
    throw new Error(`Unexpected component dependency: ${name}`)
  }
  const module = { exports: {} as { ShortcutSettings(): unknown } }
  new Function("module", "exports", "require", source)(module, module.exports, requireFixture)
  function render() {
    cursor = 0
    const tree = module.exports.ShortcutSettings(), previousDialogs = dialogs
    for (const surface of cache.values()) surface.connected = false
    const next = new Map<string, Surface>(); surfaces = []; dialogs = []
    function visit(value: unknown, path: string, parent?: Surface, owner?: Element) {
      if (Array.isArray(value)) { value.forEach((child, index) => visit(child, `${path}/${index}`, parent, owner)); return }
      if (!value || typeof value !== "object" || !("props" in value)) return
      const element = value as Element
      if (element.type === "Dialog") { if (element.props.open) visit(element.props.children, path, parent, element); return }
      if (element.type === "Fragment") { visit(element.props.children, path, parent, owner); return }
      const key = String(element.props.id ?? element.props["aria-label"] ?? `${path}/${element.type}`)
      const surface = cache.get(key) ?? new Surface(element, focusSurface)
      surface.element = element; surface.parent = parent; surface.dialog = owner; surface.connected = true; surface.children = []
      next.set(key, surface); surfaces.push(surface); parent?.children.push(surface)
      if (element.type === "DialogContent") dialogs.push(surface)
      const ref = element.props.ref as { current: unknown } | ((surface: Surface) => void) | undefined
      if (typeof ref === "function") ref(surface); else if (ref) ref.current = surface
      visit(element.props.children, `${path}/children`, surface, owner)
    }
    visit(tree, "root"); cache = next
    for (const previous of previousDialogs) if (!previous.connected) {
      const target = previous.props.finalFocus
      const surface = typeof target === "function" ? target() : target && typeof target === "object" ? (target as { current?: Surface }).current : null
      surface?.focus()
    }
    if (focused && !focused.connected) focused = null
    while (effects.length) effects.shift()!()
  }
  function find(name: string) { render(); const surface = surfaces.find(item => ["button", "Button", "Input"].includes(item.element.type) && item.name === name); assert.ok(surface, `Visible control: ${name}`); return surface }
  function click(surface: Surface) { if (surface.disabled) return; surface.focus(); (surface.props.onClick as (() => void) | undefined)?.(); render() }
  function key(key: string, extra: Partial<KeyEvent> = {}) {
    assert.ok(focused, "A visible surface has keyboard focus")
    const event: KeyEvent = { key, code: key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, isComposing: false, repeat: false, keyCode: 0, target: focused, defaultPrevented: false, stopped: false,
      preventDefault() { this.defaultPrevented = true }, stopPropagation() { this.stopped = true }, stopImmediatePropagation() { this.stopped = true }, ...extra }
    for (const listener of listeners) { listener(event); if (event.stopped) break }
    if (!event.stopped) (focused.props.onKeyDownCapture as ((event: Props) => void) | undefined)?.({ nativeEvent: event, preventDefault: () => event.preventDefault(), stopPropagation: () => event.stopPropagation() })
    // Model only the primitive default boundary; real browser behavior is a separate test.
    if (!event.defaultPrevented) {
      if (key === "Enter" && ["Button", "button"].includes(focused.element.type)) click(focused)
      if (key === "Escape") (focused.dialog?.props.onOpenChange as ((open: boolean) => void) | undefined)?.(false)
    }
    render(); return event
  }
  async function settle() { for (let n = 0; n < 8; n++) await Promise.resolve(); render(); while (frames.length) frames.shift()!(); render() }
  function dialog(title: string) { render(); return dialogs.find(surface => surface.children.some(child => child.element.type === "DialogTitle" && text(child.props.children) === title)) }
  render()
  return {
    calls, errors, bootstrap, find, click, key, settle, dialog, render,
    focus: (surface: Surface) => surface.focus(), focused: () => focused?.name,
    open: (id = "file.save") => click(find(`添加 ${label(id)} 的快捷键`)),
    field: () => find("录制快捷键"),
    query(value: string) { (find("快捷键搜索").props.onChange as (event: Props) => void)({ target: { value } }); render() },
    finish() { for (const hook of hooks) hook.cleanup?.(); for (const [name, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globals[name] } },
  }
}

test("shortcut editor: focus return does not rearm; explicit Tab/Escape recording consumes repeats across the dialog", async () => {
  const ui = fixture()
  try {
    ui.open(); ui.key("Escape"); await ui.settle()
    assert.equal(ui.field().props.value, "Escape"); assert.ok(ui.dialog("添加快捷键"))
    ui.click(ui.find("重新录制")); await ui.settle(); ui.key("F24"); await ui.settle()
    assert.equal(ui.focused(), "保存")
    ui.focus(ui.field()); assert.equal(ui.field().props["data-desktop-recording"], undefined)
    assert.equal(ui.key("Tab").defaultPrevented, false); assert.equal(ui.field().props.value, "F24")
    for (const value of ["Tab", "Escape"]) {
      ui.click(ui.find("重新录制")); await ui.settle(); ui.key(value); await ui.settle()
      assert.equal(ui.field().props.value, value); assert.ok(ui.dialog("添加快捷键")); assert.equal(ui.focused(), "保存")
      for (const repeat of ["Enter", "Escape"]) { assert.equal(ui.key(repeat, { repeat: true }).defaultPrevented, true); await ui.settle() }
      assert.ok(ui.dialog("添加快捷键")); assert.equal(ui.calls.length, 0)
    }
    ui.click(ui.find("取消")); assert.equal(ui.dialog("添加快捷键"), undefined)
  } finally { ui.finish() }
})

test("shortcut editor: pending writes lock draft, conflict and dismissal controls and preserve failed input", async () => {
  let reject!: (error: Error) => void
  const ui = fixture({ write: () => new Promise<void>((_resolve, rejectWrite) => { reject = rejectWrite }) })
  try {
    ui.open(); ui.focus(ui.field()); ui.key("F24"); await ui.settle(); ui.click(ui.find("保存"))
    assert.equal(ui.calls.length, 1)
    for (const name of ["录制快捷键", "重新录制", "追加连续组合", "取消", "保存"]) assert.equal(ui.find(name).disabled, true, name)
    ui.click(ui.find("重新录制")); ui.key("Escape"); assert.equal(ui.field().props.value, "F24"); assert.ok(ui.dialog("添加快捷键"))
    reject(new Error("磁盘写入失败")); await ui.settle()
    assert.equal(ui.field().props.value, "F24"); assert.ok(ui.dialog("添加快捷键")); assert.equal(ui.find("保存").disabled, false)
    assert.deepEqual(ui.bootstrap.settings.shortcuts.darwin, {})
  } finally { ui.finish() }
})

test("shortcut editor: failed transfer is visible in the top conflict layer; retry atomically moves every conflict", async () => {
  let fail = true
  const before = { "md.bold": ["F24 F21", "Cmd+B"], "md.italic": ["F24 F22", "Cmd+I"] }
  const ui = fixture({ darwin: before, win32: { "file.save": ["F19"] }, write: async () => { if (fail) throw new Error("磁盘写入失败") } })
  try {
    ui.open(); ui.focus(ui.field()); ui.key("F24"); await ui.settle(); ui.click(ui.find("保存")); await ui.settle()
    const transferName = `删除 ${label("md.bold")}、${label("md.italic")} 命令的按键绑定再保存`
    assert.ok(ui.dialog("快捷键冲突")); ui.click(ui.find(transferName))
    const pendingConflict = ui.dialog("快捷键冲突")!
    for (const button of pendingConflict.querySelectorAll<Surface>("button")) assert.equal(button.disabled, true, button.name)
    assert.equal(pendingConflict.props.showCloseButton, false)
    ui.key("Escape"); assert.ok(ui.dialog("快捷键冲突")); assert.equal(ui.calls.length, 1)
    await ui.settle()
    const conflict = ui.dialog("快捷键冲突")!
    assert.ok(conflict.children.some(child => child.props.role === "alert" && child.name === "磁盘写入失败"))
    assert.deepEqual(ui.bootstrap.settings.shortcuts.darwin, before)
    assert.equal(ui.field().props.value, "F24")
    ui.click(conflict.querySelectorAll<Surface>("button").find(button => button.name === "取消")!)
    assert.equal(ui.dialog("快捷键冲突"), undefined); assert.equal(ui.field().props.value, "F24")
    assert.deepEqual(ui.bootstrap.settings.shortcuts.darwin, before)
    ui.click(ui.find("保存")); await ui.settle()
    fail = false; ui.click(ui.find(transferName)); await ui.settle()
    assert.equal(ui.dialog("快捷键冲突"), undefined); assert.equal(ui.dialog("添加快捷键"), undefined)
    assert.deepEqual(ui.bootstrap.settings.shortcuts.darwin, { "md.bold": ["Cmd+B"], "md.italic": ["Cmd+I"], "file.save": ["Cmd+S", "F24"] })
    assert.deepEqual(ui.bootstrap.settings.shortcuts.win32, { "file.save": ["F19"] })
  } finally { ui.finish() }
})

test("shortcut editor: list focus and platform restore honor confirmed settings", async () => {
  for (const scenario of ["last", "middle", "filtered-delete", "filtered-edit"] as const) {
    const bindings = scenario === "middle" ? ["F20", "F21", "F22"] : ["F24"]
    const ui = fixture({ darwin: { "file.save": bindings } })
    try {
      if (scenario.startsWith("filtered")) ui.query("F24")
      if (scenario === "filtered-edit") {
        ui.click(ui.find(`编辑 ${label("file.save")} 的 F24`)); ui.focus(ui.field()); ui.key("F23"); await ui.settle(); ui.click(ui.find("保存"))
      } else ui.click(ui.find(`删除 ${label("file.save")} 的 ${scenario === "middle" ? "F21" : "F24"}`))
      await ui.settle()
      assert.equal(ui.focused(), scenario.startsWith("filtered") ? "快捷键搜索" : scenario === "middle" ? `编辑 ${label("file.save")} 的 F22` : `添加 ${label("file.save")} 的快捷键`, scenario)
      if (scenario === "last") assert.deepEqual(ui.bootstrap.settings.shortcuts.darwin["file.save"], [])
    } finally { ui.finish() }
  }
  const ui = fixture({ darwin: { "file.save": ["F24"] }, win32: { "file.save": ["F19"] } })
  try {
    ui.click(ui.find("恢复默认"))
    ui.click(ui.dialog("恢复默认快捷键")!.querySelectorAll<Surface>("button").find(button => button.name === "取消")!)
    assert.equal(ui.calls.length, 0); assert.deepEqual(ui.bootstrap.settings.shortcuts.darwin, { "file.save": ["F24"] })
    ui.click(ui.find("恢复默认"))
    ui.click(ui.dialog("恢复默认快捷键")!.querySelectorAll<Surface>("button").find(button => button.name === "恢复默认")!)
    await ui.settle()
    assert.deepEqual(ui.bootstrap.settings.shortcuts.darwin, {}); assert.deepEqual(ui.bootstrap.settings.shortcuts.win32, { "file.save": ["F19"] })
    assert.equal(ui.focused(), "恢复默认")
  } finally { ui.finish() }
})
