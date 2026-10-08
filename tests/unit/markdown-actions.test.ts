import assert from "node:assert/strict"
import { test } from "node:test"
import type { editor, IRange } from "monaco-editor"
import { markdownFormats, markdownFormatEdits, installMarkdownActions } from "../../src/lib/desktop/markdown-actions"
import {renderMarkdown} from "../../src/lib/markdown"
function model(source: string) {
  return { getValue: () => source, getOffsetAt: (p: { lineNumber: number; column: number }) => source.split("\n").slice(0, p.lineNumber - 1).reduce((n, line) => n + line.length + 1, 0) + p.column - 1,
    getPositionAt: (offset: number) => { const lines = source.slice(0, offset).split("\n"); return { lineNumber: lines.length, column: lines.at(-1)!.length + 1 } } }
}
const range = (start: number, end: number, line = 1): IRange => ({ startLineNumber: line, startColumn: start, endLineNumber: line, endColumn: end })
function apply(source: string, edits: ReturnType<typeof markdownFormatEdits>) { for (const edit of [...edits].sort((a, b) => b.startOffset - a.startOffset)) source = source.slice(0, edit.startOffset) + edit.text + source.slice(edit.endOffset); return source }
test("MARKDOWN-01: every declared static format has a concrete transformation, while unknown IDs reject", () => {
  const expected: Record<string, string> = {
    "md.bold": "**文字**", "md.italic": "*文字*", "md.strikethrough": "~~文字~~", "md.link": "[文字](https://example.com)", "md.image": "![文字](图片地址)",
    "md.quote": "> 文字", "md.orderedList": "1. 文字", "md.unorderedList": "- 文字", "md.taskList": "- [ ] 文字", "md.inlineCode": "`文字`", "md.codeBlock": "```\n文字\n```",
    "md.table": "| 列 1 | 列 2 |\n| --- | --- |\n| 文字 | 内容 |", "md.horizontalRule": "文字\n\n---\n", "md.escapeMarkup": "文字",
    ...Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`md.heading${i + 1}`, `${"#".repeat(i + 1)} 文字`])),
  }
  assert.equal(markdownFormats.length, 20)
  for (const [id] of markdownFormats) assert.equal(apply("文字", markdownFormatEdits(model("文字"), [range(1, 3)], id)), expected[id], id)
  assert.throws(() => markdownFormatEdits(model("a"), [range(1, 2)], "md.unknown"), /MARKDOWN_COMMAND_UNAVAILABLE/)
})
test("MARKDOWN-02: multiple selections produce one set of disjoint edits without replacing unselected manuscript", () => {
  const source = "甲乙，丙丁。"
  const edits = markdownFormatEdits(model(source), [range(1, 3), range(4, 6)], "md.bold")
  assert.equal(apply(source, edits), "**甲乙**，**丙丁**。")
  assert.deepEqual(edits.map(e => [e.selectionOffset, e.selectionLength]), [[2, 2], [2, 2]])
  assert.throws(() => markdownFormatEdits(model(source), [range(1, 4), range(3, 6)], "md.bold"), /MARKDOWN_SELECTION_OVERLAP/)
})
test("MARKDOWN-03: block formats cover complete selected lines once, with safe list numbering and heading replacement", () => {
  const source = "alpha\nbeta\ngamma"
  const selections = [range(3, 4, 1), range(2, 3, 1)]
  assert.equal(apply(source, markdownFormatEdits(model(source), selections, "md.quote")), "> alpha\nbeta\ngamma")
  const twoLines: IRange = { startLineNumber: 1, startColumn: 1, endLineNumber: 3, endColumn: 1 }
  assert.equal(apply(source, markdownFormatEdits(model(source), [twoLines], "md.orderedList")), "1. alpha\n2. beta\ngamma")
  assert.equal(apply("### 原标题", markdownFormatEdits(model("### 原标题"), [range(1, 2)], "md.heading1")), "# 原标题")
})
test("MARKDOWN-04: toggle wrappers, empty-cursor placeholders, backticks and escaping preserve author text", () => {
  assert.equal(apply("**原文**", markdownFormatEdits(model("**原文**"), [range(1, 7)], "md.bold")), "原文")
  const empty = markdownFormatEdits(model("前后"), [range(2, 2)], "md.italic")
  assert.equal(apply("前后", empty), "前*文字*后"); assert.equal(empty[0].selectionOffset, 1); assert.equal(empty[0].selectionLength, 2)
  assert.equal(apply("a`b", markdownFormatEdits(model("a`b"), [range(1, 4)], "md.inlineCode")), "``a`b``")
  assert.equal(apply("*原文*[x]", markdownFormatEdits(model("*原文*[x]"), [range(1, 8)], "md.escapeMarkup")), "\\*原文\\*\\[x\\]")
})
test("MARKDOWN-05: action installation uses one native executeEdits between undo stops; readonly blocks and disposal removes actions", () => {
  let source = "甲乙", readonly = false, stops = 0, writes = 0, installed = 0, selected: unknown
  const actions = new Map<string, editor.IActionDescriptor>()
  const m = { getValue: () => source, getOffsetAt: (p: { lineNumber: number; column: number }) => model(source).getOffsetAt(p), getPositionAt: (offset: number) => model(source).getPositionAt(offset) }
  const instance = {
    addAction(action: editor.IActionDescriptor) { actions.set(action.id, action); installed++; return { dispose() { actions.delete(action.id); installed-- } } },
    getRawOptions: () => ({ readOnly: readonly }), getModel: () => m, getSelections: () => [range(1, 3)], pushUndoStop: () => { stops++; return true },
    executeEdits(_source: string, edits: ReturnType<typeof markdownFormatEdits>, endState?: (inverse: unknown[]) => unknown) { writes++; source = apply(source, edits); selected = endState?.([]); return true },
  } as unknown as editor.IStandaloneCodeEditor
  const dispose = installMarkdownActions(instance)
  assert.equal(installed, 20)
  const bold = actions.get("md.bold")!; assert.equal(bold.precondition, "!editorReadonly")
  readonly = true; bold.run(instance); assert.equal(source, "甲乙"); assert.equal(writes, 0)
  readonly = false; bold.run(instance); assert.equal(source, "**甲乙**"); assert.equal(writes, 1); assert.equal(stops, 2)
  assert.equal(typeof (selected as { getDirection(): unknown }[])[0].getDirection, "function", "cursor states use the installed native Selection class")
  assert.deepEqual(JSON.parse(JSON.stringify(selected)), [{ startLineNumber: 1, startColumn: 3, endLineNumber: 1, endColumn: 5, selectionStartLineNumber: 1, selectionStartColumn: 3, positionLineNumber: 1, positionColumn: 5 }])
  dispose(); dispose(); assert.equal(installed, 0)
})
test("MARKDOWN-06: first empty line and Windows CRLF boundaries never consume the next unselected paragraph", () => {
  assert.equal(apply("\n下一段", markdownFormatEdits(model("\n下一段"), [range(1, 1)], "md.heading1")), "# 文字\n下一段")
  const source = "第一行\r\n第二行\r\n第三行"
  const selected: IRange = { startLineNumber: 1, startColumn: 1, endLineNumber: 3, endColumn: 1 }
  assert.equal(apply(source, markdownFormatEdits(model(source), [selected], "md.quote")), "> 第一行\r\n> 第二行\r\n第三行")
})
test("MARKDOWN-07: an existing fenced block toggles to its original content", () => {
  const source = "```\n原文\n```"
  const selected: IRange = { startLineNumber: 1, startColumn: 1, endLineNumber: 3, endColumn: 4 }
  assert.equal(apply(source, markdownFormatEdits(model(source), [selected], "md.codeBlock")), "原文")
})
test("MARKDOWN-08: inline-code syntax spaces preserve bare ticks and one-sided author spaces through the actual preview",()=>{
  for(const source of ["`","``"," foo","foo ","  "]){
    const edits=markdownFormatEdits(model(source),[range(1,source.length+1)],"md.inlineCode"),formatted=apply(source,edits)
    assert.equal(renderMarkdown(formatted),`<p><code>${source}</code></p>\n`)
    assert.equal(edits[0].text.slice(edits[0].selectionOffset,edits[0].selectionOffset+edits[0].selectionLength),source)
    assert.equal(apply(formatted,markdownFormatEdits(model(formatted),[range(1,formatted.length+1)],"md.inlineCode")),source)
  }
})
