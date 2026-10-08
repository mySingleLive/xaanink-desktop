import assert from "node:assert/strict"
import { test } from "node:test"
import { commandContextsOverlap } from "../../desktop/core/shortcut-context"
import { bindingConflicts, type ShortcutCommand } from "../../desktop/core/shortcuts"

const native = (when: string | null) => ({ contexts: {}, monacoArgs: null, monacoBindings: [{ when }] })
test("CONTEXT48-01: inherited object member names cannot prove native contexts mutually exclusive", () => {
  for (const key of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
    assert.equal(commandContextsOverlap(native(key), {}), true, `${key} remains compatible with an unconstrained action`)
    assert.equal(commandContextsOverlap({}, native(key)), true, `${key} compatibility is symmetric`)
    assert.equal(commandContextsOverlap(native(key), native(`!${key}`)), false, "actual opposite boolean assignments remain exclusive")
  }
})
test("CONTEXT48-02: shortcut conflict discovery preserves ambiguous prototype-name contexts", () => {
  const variant = { id: "monaco.fixture", label: "Fixture", defaults: ["F9"], scope: "markdown", locked: false, ...native("constructor") } as ShortcutCommand
  const normal: ShortcutCommand = { id: "md.fixture", label: "Normal", defaults: ["F9"], scope: "markdown", locked: false }
  const conflicts = bindingConflicts([variant, normal], {}, variant.id, "F9", 0)
  assert.deepEqual(conflicts.map(conflict => conflict.command.id), [normal.id], "an overlapping plain action must remain visible before editing or transferring")
  const inverse = bindingConflicts([variant, normal], {}, normal.id, "F9", 0)
  assert.deepEqual(inverse.map(conflict => conflict.command.id), [variant.id], "editing the ordinary action also exposes the guarded native conflict")
})
test("CONTEXT48-03: only provable boolean exclusions relax conflicts; unknown native expressions remain conservative", () => {
  assert.equal(commandContextsOverlap(native("focus && (popup || picker)"), native("!focus || (!popup && !picker)")), false)
  assert.equal(commandContextsOverlap(native("focus && (popup || picker)"), native("focus && picker")), true)
  for (const unsupported of ["language == markdown", "resource =~ /.*\\.md/", "a &&", "(".repeat(129)]) {
    assert.equal(commandContextsOverlap(native(unsupported), native("active")), true)
    assert.equal(commandContextsOverlap(native(unsupported), native("!active")), true)
  }
  const unguarded = { contexts: {}, monacoBindings: [{ when: "!active" }] }
  assert.equal(commandContextsOverlap(unguarded, native("active")), true, "ordinary actions are not restricted to the when of one native binding")
})
