import assert from "node:assert/strict"
import { test } from "node:test"
import { capturedKey, canonicalKey, validShortcut, bindingConflicts, bindingsFor, editBinding, type ShortcutCommand } from "../../desktop/core/shortcuts"
const commands: ShortcutCommand[] = [
  { id: "file.save", label: "保存", scope: "global", locked: false, defaults: ["Cmd+S"] },
  { id: "md.bold", label: "粗体", scope: "markdown", locked: false, defaults: ["Cmd+B"] },
  { id: "ai.send", label: "发送", scope: "composer", locked: false, defaults: ["Enter"] },
  { id: "md.enter", label: "换行", scope: "markdown", locked: false, defaults: ["Enter"] },
  { id: "app.quit", label: "退出", scope: "global", locked: true, defaults: ["Cmd+Q"] },
]
const key = (value: Partial<KeyboardEvent>) => capturedKey({ key: "a", code: "KeyA", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, isComposing: false, repeat: false, keyCode: 0, ...value })
test("DESK-K02: recording uses physical combinations and ignores modifiers, composition and repeat", () => {
  assert.equal(key({ key: "å", metaKey: true, altKey: true }), "Cmd+Alt+A")
  assert.equal(key({ key: "+", code: "Equal", metaKey: true, shiftKey: true }), "Cmd+Shift+Equal")
  assert.equal(key({ key: "Enter", code: "NumpadEnter" }), "NumpadEnter")
  for (const event of [{ key: "Control" }, { isComposing: true }, { keyCode: 229 }, { repeat: true }, { key: "Dead" }]) assert.equal(key(event), null)
  assert.equal(canonicalKey("Command+Plus"), canonicalKey("Shift+Meta+Equal"))
  assert.notEqual(canonicalKey("Cmd+Plus"), canonicalKey("Cmd+NumpadAdd"))
  for (const invalid of ["", "Ctrl", "Ctrl+Ctrl+A", "Cmd+Shift", "Ctrl+K garbage"]) assert.equal(validShortcut(invalid), false)
  assert.equal(validShortcut("Cmd+K Cmd+C"), true)
})
test("DESK-K03: conflicts include every binding and chord prefix only in overlapping scopes", () => {
  const bindings = { "file.save": ["Cmd+S", "Cmd+K"], "md.bold": ["Cmd+B", "Cmd+Shift+B"] }
  assert.deepEqual(bindingConflicts(commands, bindings, "md.bold", "Cmd+K Cmd+C").map(row => [row.command.id, row.index]), [["file.save", 1]])
  assert.deepEqual(bindingConflicts(commands, bindings, "ai.send", "Enter"), [{ command: commands[2], index: 0, binding: "Enter" }])
  assert.deepEqual(bindingConflicts(commands, bindings, "ai.send", "Enter", 0), [])
  assert.equal(bindingConflicts(commands, bindings, "md.bold", "Cmd+B", 1)[0].index, 0)
})
test("DESK-K04: transfer removes only conflicting bindings atomically; empty stays unbound; locked and duplicate reject", () => {
  const before = { "file.save": ["Cmd+S", "Cmd+K"], "md.bold": ["Cmd+B"] }
  assert.throws(() => editBinding(commands, before, "md.bold", "Cmd+K Cmd+C"), /冲突/)
  const next = editBinding(commands, before, "md.bold", "Cmd+K Cmd+C", undefined, true)
  assert.deepEqual(next, { "file.save": ["Cmd+S"], "md.bold": ["Cmd+B", "Cmd+K Cmd+C"] })
  assert.deepEqual(before["file.save"], ["Cmd+S", "Cmd+K"])
  assert.throws(() => editBinding(commands, before, "md.bold", "Cmd+Q", undefined, true), /系统保留/)
  assert.throws(() => editBinding(commands, before, "md.bold", "Cmd+B", undefined, true), /重复/)
  assert.deepEqual(bindingsFor(commands[0], { "file.save": [] }), [])
  assert.throws(() => editBinding(commands, before, "md.bold", "Cmd+Tab"), /系统保留/)
  assert.throws(() => editBinding(commands, before, "md.bold", "Cmd+K Cmd+Q"), /系统保留/)
  assert.throws(() => editBinding(commands, before, "md.bold", "Cmd+K Cmd+C Cmd+Q"), /系统保留/)
})
