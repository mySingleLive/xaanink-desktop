import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import ts from "typescript"

const source = ts.createSourceFile("ChatPanel.tsx", readFileSync("src/components/layout/ChatPanel.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function className(node: ts.JsxElement): string {
  const attribute = node.openingElement.attributes.properties.find(p => ts.isJsxAttribute(p) && p.name.getText(source) === "className")
  return attribute && ts.isJsxAttribute(attribute) && attribute.initializer && ts.isStringLiteral(attribute.initializer) ? attribute.initializer.text : ""
}
const elements: ts.JsxElement[] = []
function visit(node: ts.Node) { if (ts.isJsxElement(node)) elements.push(node); ts.forEachChild(node, visit) }
visit(source)
const pane = elements.find(node => className(node).startsWith("chatpane "))!

test("DRAG-01 AI title is the first pane row, before workflow/recovery/creation notices", () => {
  const first = pane.children.find(node => !ts.isJsxText(node) && !(ts.isJsxExpression(node) && !node.expression))
  assert(first && ts.isJsxElement(first))
  assert.match(className(first), /\bdesktop-drag\b/)
  assert.match(className(first), /\bh-11\b/)
  const text = pane.getText(source)
  assert(text.indexOf("desktop-drag") < text.indexOf("<StoryWorkflowBar"))
  assert(text.indexOf("desktop-drag") < text.indexOf('recoveryStatus !== "ready"'))
})

test("DRAG-04 AI drag contract is restricted to its title, preserving body/composer and notices", () => {
  assert.doesNotMatch(className(pane), /desktop-drag/)
  const draggable = elements.filter(node => className(node).split(/\s+/).includes("desktop-drag"))
  assert.equal(draggable.length, 1)
  assert.match(className(draggable[0]), /\bh-11\b/)
  assert.doesNotMatch(draggable[0].getText(source), /contentEditable|StoryWorkflowBar|role="status"/)
})
