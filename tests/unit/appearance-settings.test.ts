import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { transformSync } from "esbuild"
import { defaultState } from "../../desktop/core/settings"
import type { Bootstrap, StateSnapshot } from "../../desktop/shared/ipc"
import { updateDesktopSettings, useDesktopStore } from "../../src/stores/desktop"

// Run the real input's hooks/event logic against controlled promises. This does
// not exercise native number-input defaults, Base UI, fonts or Electron zoom.
interface Element { type: string; props: Record<string, unknown> }
interface Hook { value?: unknown; deps?: unknown[] }
const source = transformSync(readFileSync(new URL("../../src/components/desktop/AppearanceNumber.tsx", import.meta.url), "utf8"), { loader: "tsx", format: "cjs", jsx: "automatic" }).code
function deferred() {
  let resolve!: () => void, reject!: (error: Error) => void
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function fixture(options: { value?: number; min?: number; max?: number; step?: number; write?: (value: number) => Promise<unknown> } = {}) {
  const hooks: Hook[] = [], effects: Array<() => void> = [], calls: number[] = []
  let cursor = 0, changed = false, tree: Element, value = options.value ?? 14
  const props = () => ({ label: "字号", value, min: options.min ?? 11, max: options.max ?? 24, step: options.step ?? 1, onValue: (next: number) => { calls.push(next); return options.write?.(next) ?? Promise.resolve() } })
  const react = {
    useState(initial: unknown) {
      const index = cursor++, hook = hooks[index] ?? (hooks[index] = { value: initial })
      return [hook.value, (next: unknown) => { const resolved = typeof next === "function" ? next(hook.value) : next; if (!Object.is(resolved, hook.value)) { hook.value = resolved; changed = true } }]
    },
    useRef(initial: unknown) { const index = cursor++; return (hooks[index] ?? (hooks[index] = { value: { current: initial } })).value },
    useId() { const index = cursor++; return `appearance-test-${index}` },
    useEffect(callback: () => void, deps: unknown[]) {
      const index = cursor++, hook = hooks[index] ?? (hooks[index] = {})
      if (!hook.deps || deps.length !== hook.deps.length || deps.some((item, n) => !Object.is(item, hook.deps![n]))) { hook.deps = deps; effects.push(callback) }
    },
  }
  const module = { exports: {} as { AppearanceNumber(props: unknown): Element } }
  new Function("module", "exports", "require", source)(module, module.exports, (name: string) => {
    if (name === "react") return react
    if (name === "react/jsx-runtime") return { jsx: (type: string, props: Element["props"]) => ({ type, props }), jsxs: (type: string, props: Element["props"]) => ({ type, props }) }
    if (name === "@/components/ui/input") return { Input: "Input" }
    throw new Error(`Unexpected input dependency: ${name}`)
  })
  function render() {
    for (let n = 0; n < 12; n++) {
      cursor = 0; changed = false; tree = module.exports.AppearanceNumber(props())
      while (effects.length) effects.shift()!()
      if (!changed) return
    }
    throw new Error("Component did not settle")
  }
  function elements(value: unknown): Element[] {
    if (Array.isArray(value)) return value.flatMap(elements)
    if (!value || typeof value !== "object" || !("props" in value)) return []
    const element = value as Element
    return [element, ...elements(element.props.children)]
  }
  function input() { render(); return elements(tree).find(element => element.type === "Input")!.props }
  function event(name: string, payload: unknown = {}) { const handler = input()[name] as (event: unknown) => void; handler(payload); render() }
  render()
  return {
    calls, input, render,
    focus() { (input().onFocus as (() => void) | undefined)?.(); render() },
    blur: () => event("onBlur"), change: (next: string) => event("onChange", { target: { value: next } }),
    escape() { let prevented = false, stopped = false; event("onKeyDown", { key: "Escape", preventDefault() { prevented = true }, stopPropagation() { stopped = true } }); assert.ok(prevented && stopped, "Escape belongs to the numeric draft") },
    confirm(next: number) { value = next; render() },
    alert() { render(); return elements(tree).find(element => element.props.role === "alert")?.props.children },
    async settle() { for (let n = 0; n < 6; n++) await Promise.resolve(); render() },
  }
}

test("appearance input: Escape follows a late confirmed write while focus remains in the field", async () => {
  const pending = deferred(), ui = fixture({ write: () => pending.promise })
  ui.focus(); ui.change("24"); assert.deepEqual(ui.calls, [24])
  ui.escape(); assert.equal(ui.input().value, "14")
  // An already dispatched valid write can complete after Escape. The rendered
  // value must then agree with the confirmed setting without requiring blur.
  ui.confirm(24); pending.resolve(); await ui.settle()
  assert.equal(ui.input().value, "24")
  assert.equal(ui.input()["aria-invalid"], false)
})

test("appearance input: empty, out-of-range and fractional integer drafts never dispatch a write", async () => {
  const ui = fixture()
  for (const invalid of ["", "10", "25", "14.5"]) {
    ui.focus(); ui.change(invalid); ui.blur()
    assert.equal(ui.input().value, invalid); assert.equal(ui.input()["aria-invalid"], true); assert.match(String(ui.alert()), /11–24/)
    ui.escape(); assert.equal(ui.input().value, "14"); assert.equal(ui.alert(), undefined)
  }
  assert.deepEqual(ui.calls, [])
  const line = fixture({ value: 1.8, min: 1.2, max: 3, step: .1 })
  line.focus(); line.change("2.1"); await line.settle()
  assert.deepEqual(line.calls, [2.1])
})

test("appearance input: a stale failure cannot overwrite a newer draft", async () => {
  const old = deferred(), latest = deferred(), ui = fixture({ write: value => value === 16 ? old.promise : latest.promise })
  ui.focus(); ui.change("16"); ui.change("18")
  old.reject(new Error("旧写入失败")); await ui.settle()
  assert.equal(ui.input().value, "18"); assert.equal(ui.alert(), undefined)
  ui.confirm(16); assert.equal(ui.input().value, "18", "A confirmed older write cannot replace uncommitted input")
  ui.confirm(18); latest.resolve(); await ui.settle(); ui.blur()
  assert.equal(ui.input().value, "18"); assert.equal(ui.alert(), undefined)
})

test("appearance input: failed valid writes retain their draft for retry and Escape returns to confirmation", async () => {
  let fail = true
  const ui = fixture({ write: async () => { if (fail) throw new Error("磁盘写入失败") } })
  ui.focus(); ui.change("20"); await ui.settle(); ui.confirm(14)
  assert.equal(ui.input().value, "20"); assert.equal(ui.input()["aria-invalid"], true); assert.equal(ui.alert(), "磁盘写入失败")
  ui.escape(); assert.equal(ui.input().value, "14"); assert.equal(ui.alert(), undefined)
  fail = false; ui.change("20"); ui.confirm(20); await ui.settle(); ui.blur()
  assert.deepEqual(ui.calls, [20, 20]); assert.equal(ui.input().value, "20"); assert.equal(ui.alert(), undefined)
})

test("appearance settings: a newer queued successful write clears an earlier failure status", async () => {
  const savedWindow = Object.getOwnPropertyDescriptor(globalThis, "window"), savedStore = useDesktopStore.getState()
  const first = deferred(), dispatched: number[] = []
  let actual: StateSnapshot = { revision: 0, settings: structuredClone(defaultState.settings), models: [] }
  Object.defineProperty(globalThis, "window", { configurable: true, writable: true, value: { desktop: {
    async settings(request: { settings: typeof defaultState.settings }) {
      dispatched.push(request.settings.appearance.uiFontSize)
      if (dispatched.length === 1) await first.promise
      actual = { revision: actual.revision + 1, settings: request.settings, models: [] }; return actual
    },
    async bootstrap() { return actual },
  } } })
  useDesktopStore.setState({ bootstrap: { ...actual, platform: "darwin" } as Bootstrap, saving: 0, error: null })
  try {
    const old = updateDesktopSettings(before => ({ ...before, appearance: { ...before.appearance, uiFontSize: 16 } }))
    const result = old.catch(error => error)
    const next = updateDesktopSettings(before => ({ ...before, appearance: { ...before.appearance, uiFontSize: 18 } }))
    for (let n = 0; n < 6; n++) await Promise.resolve()
    first.reject(new Error("首次写入失败"))
    assert.match(String(await result), /首次写入失败/); await next
    assert.deepEqual(dispatched, [16, 18]); assert.equal(useDesktopStore.getState().bootstrap?.settings.appearance.uiFontSize, 18)
    assert.equal(useDesktopStore.getState().saving, 0)
    assert.equal(useDesktopStore.getState().error, null, "The visible save status must represent the final confirmed operation")
  } finally {
    useDesktopStore.setState(savedStore)
    if (savedWindow) Object.defineProperty(globalThis, "window", savedWindow); else Reflect.deleteProperty(globalThis, "window")
  }
})
