import assert from "node:assert/strict"
import { test } from "node:test"
import { readFileSync } from "node:fs"
import { buildSync } from "esbuild"
import ts from "typescript"
import { chromium, type Browser } from "playwright-core"

// Execute the actual React paste/sync callbacks and native guard in an isolated
// Chromium document. No system clipboard, network or Electron is available.
const source = ts.createSourceFile("ChatPanel.tsx", readFileSync("src/components/layout/ChatPanel.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let paste = "", sync = ""
function inspect(node: ts.Node) {
  if (ts.isJsxAttribute(node) && node.name.getText(source) === "onPaste" && node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression) paste = node.initializer.expression.getText(source)
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === "syncFromEditor" && node.initializer) sync = node.initializer.getText(source)
  ts.forEachChild(node, inspect)
}
inspect(source); assert(paste && sync)
const bundle = buildSync({ stdin: { loader: "ts", resolveDir: process.cwd(), contents: `
import React from 'react'; import {createRoot} from 'react-dom/client'; import {flushSync} from 'react-dom';
import {nativeTextEdits,consumeDesktopComposerPaste} from './src/lib/desktop/native-text-edits';
import {renderDraftIntoEditor,insertDraftAtCaret,editorToText} from './src/components/chat/composer-editor';
globalThis.mountReview=()=>{
  let release,insertions=0,draft='@[角色/青岚](character:7) tail';const writes=[];
  const clipboard=new Promise(resolve=>{release=resolve});
  window.desktop={readClipboardText:()=>clipboard,writeClipboardText:async text=>{writes.push(text)}};
  const textareaRef={current:null},lastSyncedRef={current:draft},canSend=true,chipHydrate=()=>undefined,toast={error:()=>{}},updateMention=()=>{},setDraft=text=>{draft=text};
  const syncFromEditor=${sync},onPaste=${paste};
  const root=createRoot(document.getElementById('app'));
  flushSync(()=>root.render(React.createElement('div',{contentEditable:true,suppressContentEditableWarning:true,className:'chat-composer-editable',onInput:syncFromEditor,onPaste,ref:element=>{textareaRef.current=element}})));
  const composer=textareaRef.current;renderDraftIntoEditor(composer,draft,chipHydrate);composer.focus();
  const range=document.createRange();range.selectNodeContents(composer);range.collapse(false);document.getSelection().removeAllRanges();document.getSelection().addRange(range);
  const original=document.execCommand.bind(document);document.execCommand=(id,ui,value)=>{if(id==='copy'||id==='cut')throw Error('OS clipboard forbidden');if(id==='insertHTML')insertions++;return original(id,ui,value)};
  const adapter=nativeTextEdits(document,()=>clipboard);
  const selectAll=()=>{composer.focus();const range=document.createRange();range.selectNodeContents(composer);document.getSelection().removeAllRanges();document.getSelection().addRange(range)};
  return {composer,adapter,writes,selectAll,release:text=>release(text),run:(id='text.paste')=>adapter.run(id,composer),source:()=>editorToText(composer),draft:()=>draft,insertions:()=>insertions,dispose:()=>{adapter.dispose();root.unmount()}};
};` }, bundle: true, platform: "browser", format: "iife", write: false, tsconfig: "tsconfig.json" }).outputFiles[0].text
let browser: Browser
test.before(async () => { const executablePath = process.env.XAANINK_TEST_CHROMIUM; browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) }) })
test.after(async () => { await browser?.close() })
async function scenario(run: (page: import("playwright-core").Page) => Promise<void>) {
  const page = await browser.newPage()
  try {
    await page.route("**/*", route => route.abort())
    await page.setContent('<style>.chat-composer-editable{white-space:pre-wrap}.composer-chip{display:inline-flex}</style><div id="app"></div>')
    await page.evaluate("globalThis.__name=(fn)=>fn")
    await page.addScriptTag({ content: bundle })
    await page.evaluate(() => { (window as any).f = (window as any).mountReview() })
    await run(page)
  } finally { await page.evaluate(() => (window as any).f?.dispose()); await page.close() }
}

test("CMP52-01: reference-token attribute A to B to A cannot revive a delayed composer paste", async () => scenario(async page => {
  const result = await page.evaluate(async () => {
    const f = (window as any).f, pending = f.run().then(() => true, () => false)
    const chip = f.composer.querySelector('.composer-chip') as HTMLElement, original = chip.dataset.insert!
    chip.dataset.insert = '@[角色/另一身份](character:8)'; chip.dataset.insert = original
    f.release('LATE')
    return { accepted: await pending, source: f.source(), draft: f.draft(), insertions: f.insertions() }
  })
  assert.equal(result.accepted, false)
  assert.equal(result.source, '@[角色/青岚](character:7) tail')
  assert.equal(result.draft, result.source)
  assert.equal(result.insertions, 0)
}))

test("CMP52-02: an empty cut placeholder cannot be copied as a newline, while an intentional pasted newline can", async () => scenario(async page => {
  const result = await page.evaluate(async () => {
    const f = (window as any).f
    f.selectAll(); await f.run('text.cut')
    const emptySource = f.source(), children = f.composer.childNodes.length, first = f.composer.firstChild?.nodeName
    f.selectAll(); const emptyAccepted = await f.run('text.copy').then(() => true, () => false)
    const emptyWrites = [...f.writes]
    const paste = f.run(); f.release('\n'); await paste
    f.selectAll(); await f.run('text.copy')
    return { emptySource, children, first, emptyAccepted, emptyWrites, intentionalSource: f.source(), copied: f.writes.at(-1) }
  })
  assert.equal(result.emptySource, '')
  assert.equal(result.children, 1); assert.equal(result.first, 'BR', 'use the real Chromium caret placeholder')
  assert.equal(result.emptyAccepted, false)
  assert.deepEqual(result.emptyWrites, ['@[角色/青岚](character:7) tail'])
  assert.equal(result.intentionalSource, '\n'); assert.equal(result.copied, '\n')
}))
