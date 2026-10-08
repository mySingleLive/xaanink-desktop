import assert from "node:assert/strict"
import { test } from "node:test"
import type { editor } from "monaco-editor"
import { CommandTargets } from "../../src/lib/desktop/command-targets"
import { editorCommentCommand } from "../../src/lib/desktop/editor-comment-command"

test("COMMENT48-01: comment and find controls inside Monaco cannot create a manuscript comment from its retained selection", async () => {
  const dom = { isConnected: true, getClientRects: () => [{}], contains: (node: unknown) => nodes.includes(node as HTMLElement) } as unknown as HTMLElement
  const control = (native: boolean) => ({
    closest(selector: string) { return selector === '.monaco-editor' ? dom : selector === 'input,textarea,[contenteditable="true"]' ? this : null },
    matches(selector: string) { return native && selector.split(',').includes('.inputarea') },
  } as unknown as HTMLElement)
  const inputarea = control(true), commentTextarea = control(false), findInput = control(false), nodes = [inputarea, commentTextarea, findInput]
  const opened: unknown[] = []
  const model = { getValue: () => "正文", getOffsetAt: (position: { column: number }) => position.column - 1 }
  const instance = { getDomNode: () => dom, getRawOptions: () => ({ readOnly: false }), getModel: () => model,
    getSelection: () => ({ isEmpty: () => false, getStartPosition: () => ({ lineNumber: 1, column: 1 }), getEndPosition: () => ({ lineNumber: 1, column: 3 }) }) }
  const hub = new CommandTargets<HTMLElement | null>()
  hub.register(editorCommentCommand(instance as unknown as editor.IStandaloneCodeEditor, () => true, snapshot => opened.push(snapshot)))
  assert.equal(await hub.execute("md.comment", commentTextarea), false, "a separate comment draft owns its control")
  assert.equal(await hub.execute("md.comment", findInput), false, "the find query does not own the retained manuscript selection")
  assert.equal(opened.length, 0)
  assert.equal(await hub.execute("md.comment", inputarea), true)
  assert.equal((opened[0] as { quote: string }).quote, "正文")
})
test("COMMENT48-02: hidden mounted manuscript cannot open a new comment from its retained selection", async () => {
  let visible = true
  const dom = { isConnected: true, getClientRects: () => visible ? [{}] : [], contains: (node: unknown) => node === target } as unknown as HTMLElement
  const target = { closest: (selector: string) => selector === '.monaco-editor' ? dom : null, matches: () => false } as unknown as HTMLElement
  const model = { getValue: () => "正文", getOffsetAt: (position: { column: number }) => position.column - 1 }, opened: unknown[] = []
  const instance = { getDomNode: () => dom, getRawOptions: () => ({ readOnly: false }), getModel: () => model,
    getSelection: () => ({ isEmpty: () => false, getStartPosition: () => ({ lineNumber: 1, column: 1 }), getEndPosition: () => ({ lineNumber: 1, column: 3 }) }) }
  const hub = new CommandTargets<HTMLElement | null>()
  hub.register(editorCommentCommand(instance as unknown as editor.IStandaloneCodeEditor, () => true, snapshot => opened.push(snapshot)))
  const captured = hub.capture("md.comment", target); assert.ok(captured)
  visible = false
  assert.equal(await captured(), false)
  assert.equal(await hub.execute("md.comment", target), false)
  assert.equal(opened.length, 0)
  visible = true
  assert.equal(await hub.execute("md.comment", target), true)
  assert.equal(opened.length, 1)
})
