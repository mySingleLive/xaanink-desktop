import assert from "node:assert/strict"
import { test } from "node:test"
import type { editor, IRange } from "monaco-editor"
import { markdownFormatEdits, installMarkdownActions } from "../../src/lib/desktop/markdown-actions"
import { renderMarkdown } from "../../src/lib/markdown"
// @ts-expect-error Version-pinned installed Monaco runtime expression evaluator.
import { ContextKeyExpr } from "monaco-editor/platform/contextkey/common/contextkey.js"

function model(source: string) {
  return { getValue: () => source,
    getOffsetAt: (position: { lineNumber: number; column: number }) => source.split("\n").slice(0, position.lineNumber - 1).reduce((sum, line) => sum + line.length + 1, 0) + position.column - 1,
    getPositionAt: (offset: number) => { const lines = source.slice(0, offset).split("\n"); return { lineNumber: lines.length, column: lines.at(-1)!.length + 1 } },
  }
}
function format(source: string, id: string) {
  const lines = source.split("\n")
  const range: IRange = { startLineNumber: 1, startColumn: 1, endLineNumber: lines.length, endColumn: lines.at(-1)!.length + 1 }
  const edits = markdownFormatEdits(model(source), [range], id)
  let result = source
  for (const edit of [...edits].sort((a, b) => b.startOffset - a.startOffset)) result = result.slice(0, edit.startOffset) + edit.text + result.slice(edit.endOffset)
  return result
}

test("FORMAT48-01: inline code containing edge backticks remains an actual code span in the project's preview renderer", () => {
  for (const source of ["`foo", "foo`", "``foo", "foo``"]) {
    const result = format(source, "md.inlineCode")
    assert.equal(renderMarkdown(result), `<p><code>${source}</code></p>\n`, source)
    assert.equal(format(result, "md.inlineCode"), source, "toggle preserves the author text")
  }
})
test("FORMAT48-02: code-span syntax padding preserves existing leading/trailing spaces and toggles back", () => {
  for (const source of [" foo ", "  foo  ", "   "]) {
    const result = format(source, "md.inlineCode")
    assert.equal(renderMarkdown(result), `<p><code>${source}</code></p>\n`, JSON.stringify(source))
    assert.equal(format(result, "md.inlineCode"), source)
  }
})
test("FORMAT48-03: applying italic to bold text retains strong formatting and adds emphasis", () => {
  const result = format("**原文**", "md.italic")
  const html = renderMarkdown(result)
  assert.match(html, /<strong>/)
  assert.match(html, /<em>/)
  assert.equal(format(result, "md.italic"), "**原文**")
})

test("FORMAT48-04: installed Monaco context keys enable all formats in writable editors and disable readonly", () => {
  const actions: editor.IActionDescriptor[] = []
  const instance = { addAction(action: editor.IActionDescriptor) { actions.push(action); return { dispose() {} } } } as unknown as editor.IStandaloneCodeEditor
  const dispose = installMarkdownActions(instance)
  try {
    assert.equal(actions.length, 20)
    for (const action of actions) {
      const condition = ContextKeyExpr.deserialize(action.precondition)
      assert.ok(condition, `${action.id} declares a concrete precondition`)
      const writable = { getValue: (key: string) => ({ editorReadonly: false, editorHasSelection: true } as Record<string, boolean>)[key] }
      const readonly = { getValue: (key: string) => ({ editorReadonly: true, editorHasSelection: true } as Record<string, boolean>)[key] }
      assert.equal(condition.evaluate(writable), true, `${action.id}: installed editorReadonly=false is writable`)
      assert.equal(condition.evaluate(readonly), false, `${action.id}: installed readonly guard`)
    }
  } finally { dispose() }
})
