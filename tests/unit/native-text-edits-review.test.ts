import assert from "node:assert/strict"
import { test } from "node:test"
import { nativeTextEdits } from "../../src/lib/desktop/native-text-edits"

// Public document/window focus state with a delayed read, not an OS focus test.
function fixture() {
  let release!: (value: string) => void
  const pending = new Promise<string>(resolve => { release = resolve })
  const document = Object.assign(new EventTarget(), {
    defaultView: new EventTarget(), focused: true, activeElement: null as unknown,
    calls: [] as string[], hasFocus() { return this.focused },
    execCommand(command: string) { this.calls.push(command); return true },
  })
  const input = { ownerDocument: document, isConnected: true, disabled: false, readOnly: false,
    value: "draft", selectionStart: 0, selectionEnd: 0, selectionDirection: "none", matches: () => false }
  document.activeElement = input
  const adapter = nativeTextEdits(document as unknown as Document, () => pending)
  return { document, input, adapter, release, paste: () => adapter.run("text.paste", input as unknown as HTMLInputElement) }
}
test("NATIVE46-01: pending paste is rejected when the application loses focus with the same active input", async () => {
  const f = fixture()
  try {
    const result = f.paste(); f.document.focused = false; f.document.defaultView.dispatchEvent(new Event("blur"))
    f.release("late clipboard")
    await assert.rejects(result, /输入目标|聚焦/)
    assert.deepEqual(f.document.calls, [])
  } finally { f.adapter.dispose() }
})
test("NATIVE46-02: leaving and returning to the window does not revive a stale paste intent", async () => {
  const f = fixture()
  try {
    const result = f.paste(); f.document.focused = false; f.document.defaultView.dispatchEvent(new Event("blur"))
    f.document.focused = true; f.document.defaultView.dispatchEvent(new Event("focus"))
    f.release("late clipboard")
    await assert.rejects(result, /输入目标|聚焦/)
    assert.deepEqual(f.document.calls, [])
  } finally { f.adapter.dispose() }
})
