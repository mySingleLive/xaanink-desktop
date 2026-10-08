import assert from "node:assert/strict"
import { test } from "node:test"
import { ShortcutDispatcher } from "../../desktop/core/shortcut-dispatch"
import type { ShortcutCommand } from "../../desktop/core/shortcuts"

test("KEY46-01: DOM-shaped nonenumerable keyboard fields still resolve the confirmed binding", () => {
  const event = new Event("keydown", { cancelable: true })
  // Native KeyboardEvent properties are not spreadable own enumerable data.
  // Use that public shape without pretending this is a physical OS event.
  Object.defineProperties(event, Object.fromEntries(Object.entries({ key: "s", code: "KeyS", metaKey: true, ctrlKey: false, altKey: false, shiftKey: false, repeat: false, isComposing: false, keyCode: 83 }).map(([key, value]) => [key, { value }])))
  const command: ShortcutCommand = { id: "save", label: "Save", scope: "global", defaults: ["Cmd+S"], locked: false }
  const result = new ShortcutDispatcher().key(event as unknown as Parameters<ShortcutDispatcher["key"]>[0], { platform: "darwin", scope: "input", focus: "field", commands: [command], overrides: {} })
  assert.deepEqual(result, { kind: "run", id: "save" })
})
