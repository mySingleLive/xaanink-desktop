import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { buildSync } from "esbuild"
import ts from "typescript"
import { chromium, type Browser, type Page } from "playwright-core"

// Actual React paste/input callbacks from ChatPanel, real Chromium CE undo,
// original chip helpers and real desktop guard. Clipboard IO stays in memory.
const panel = ts.createSourceFile("ChatPanel.tsx", readFileSync("src/components/layout/ChatPanel.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let paste = "", copy = "", cut = "(e) => {}", sync = ""
function walk(node: ts.Node) {
  if (ts.isJsxAttribute(node) && node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression) {
    if (node.name.getText(panel) === "onPaste") paste = node.initializer.expression.getText(panel)
    if (node.name.getText(panel) === "onCopy") copy = node.initializer.expression.getText(panel)
    if (node.name.getText(panel) === "onCut") cut = node.initializer.expression.getText(panel)
  }
  if (ts.isVariableDeclaration(node) && node.name.getText(panel) === "syncFromEditor" && node.initializer) sync = node.initializer.getText(panel)
  ts.forEachChild(node, walk)
}
walk(panel)
assert(paste && copy && sync, "must execute the original ChatPanel callbacks")
const bundle = buildSync({ stdin: { resolveDir: process.cwd(), loader: "ts", sourcefile: "composer-clipboard-harness.ts", contents: `
import React from 'react'; import {createRoot} from 'react-dom/client'; import {flushSync} from 'react-dom';
import * as native from './src/lib/desktop/native-text-edits';
import {insertDraftAtCaret,renderDraftIntoEditor,editorToText,selectedEditorText,deleteDraftSelection} from './src/components/chat/composer-editor';
const consumeDesktopComposerPaste=native['consumeDesktopComposerPaste'];
globalThis.mountComposer=(options={})=>{
 let canSend=true, draft=options.initial??'before ', changes=[], errors=[];
 const textareaRef={current:null},lastSyncedRef={current:draft};
 const setDraft=text=>{draft=text;changes.push(text)},updateMention=()=>{},chipHydrate=()=>{if(options.throwHydrate)throw undefined;return undefined};
 const toast={error:text=>errors.push(text)};
 const syncFromEditor=${sync}, onPaste=${paste}, onCopy=${copy}, onCut=${cut};
 const host=document.getElementById('app'),reactRoot=createRoot(host);
 flushSync(()=>reactRoot.render(React.createElement('div',{contentEditable:true,suppressContentEditableWarning:true,role:'textbox',tabIndex:0,className:'chat-composer-editable',onPaste:options.noHandler?undefined:onPaste,onCopy,onCut,onInput:syncFromEditor,ref:element=>{textareaRef.current=element}})));
 const composer=textareaRef.current;renderDraftIntoEditor(composer,draft,chipHydrate);
 const calls={reads:0,writes:[],commands:[]};let gate=null,writeGate=null;
 const original=document.execCommand.bind(document);
 document.execCommand=(command,ui,value)=>{calls.commands.push([command,value]);if(command==='copy'||command==='cut')throw Error('real OS clipboard is forbidden in this harness');if(options.failInsert&&command==='insertHTML')return false;return original(command,ui,value)};
 const read=()=>{calls.reads++;if(options.failRead)return Promise.reject(Error('private clipboard detail'));return gate?.promise??Promise.resolve(options.clipboard??'@[角色/青岚](character:7)')};
 if(options.desktop!==false)window.desktop={writeClipboardText:async text=>{if(options.failWrite)throw Error('write failed');calls.writes.push(text);await writeGate?.promise},readClipboardText:read};
 const adapter=native.nativeTextEdits(document,read);
 function selectAll(){composer.focus();const range=document.createRange();range.selectNodeContents(composer);document.getSelection().removeAllRanges();document.getSelection().addRange(range)}
 function caretEnd(){composer.focus();const range=document.createRange();range.selectNodeContents(composer);range.collapse(false);document.getSelection().removeAllRanges();document.getSelection().addRange(range)}
 caretEnd();
 return {composer,calls,adapter,selectAll,caretEnd,source:()=>editorToText(composer),draft:()=>draft,errors,changes,
  nativePaste(text){const data=new DataTransfer();data.setData('text/plain',text);data.setData('text/html','<img src=x onerror="globalThis.injected=true">');composer.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}))},
  nativeCut(){const data=new DataTransfer();composer.dispatchEvent(new ClipboardEvent('cut',{bubbles:true,cancelable:true,clipboardData:data}));return data.getData('text/plain')},
  nativeCopy(){const data=new DataTransfer();composer.dispatchEvent(new ClipboardEvent('copy',{bubbles:true,cancelable:true,clipboardData:data}));return data.getData('text/plain')},
  async run(id){await adapter.run(id,composer)},gate(){let resolve;const promise=new Promise(r=>{resolve=r});gate={promise,resolve};return gate},writeGate(){let resolve;const promise=new Promise(r=>{resolve=r});writeGate={promise,resolve};return writeGate},
  readonly(){canSend=false;composer.contentEditable='false'},dispose(){adapter.dispose();reactRoot.unmount()},
 };
};` }, bundle: true, platform: "browser", format: "iife", write: false, tsconfig: "tsconfig.json" }).outputFiles[0].text
let browser: Browser
test.before(async () => { const executablePath = process.env.XAANINK_TEST_CHROMIUM; browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) }) })
test.after(async () => { await browser?.close() })
async function fixture(options: Record<string, unknown> = {}) {
  const page = await browser.newPage(); await page.route("**/*", route => route.abort())
  await page.setContent('<style>.chat-composer-editable{white-space:pre-wrap}.composer-chip{display:inline-flex}</style><div id="app"></div><input id="outside">')
  await page.evaluate("globalThis.__name = (target) => target")
  await page.addScriptTag({ content: bundle })
  await page.evaluate(options => { (window as any).f = (window as any).mountComposer(options) }, options)
  return page
}
async function scenario(options: Record<string, unknown>, run: (page: Page) => Promise<void>) { const page = await fixture(options); try { await run(page) } finally { await page.evaluate(() => (window as any).f.dispose()); await page.close() } }
test("custom paste and plain paste hydrate structured references through the actual React onPaste callback", async () => {
  for (const id of ["text.paste", "text.pastePlain"]) await scenario({}, async page => {
    const result = await page.evaluate(async id => { const f = (window as any).f; await f.run(id); return { source: f.source(), draft: f.draft(), chip: f.composer.querySelector('.composer-chip')?.dataset.insert, commands: f.calls.commands } }, id)
    assert.equal(result.source, "before @[角色/青岚](character:7)"); assert.equal(result.draft, result.source); assert.equal(result.chip, "@[角色/青岚](character:7)")
    assert.equal(result.commands.filter(([id]: string[]) => id === "insertHTML").length, 1); assert.equal(result.commands.some(([id]: string[]) => id === "insertText"), false)
  })
})
test("custom pasted chips undo and redo in the real Chromium editable history, synchronizing the original draft callback", async () => scenario({}, async page => {
  const result = await page.evaluate(async () => { const f = (window as any).f; await f.run('text.paste'); await f.run('text.undo'); const undo = { source: f.source(), draft: f.draft() }; await f.run('text.redo'); return { undo, redo: f.source(), draft: f.draft(), chips: f.composer.querySelectorAll('.composer-chip').length } })
  assert.deepEqual(result.undo, { source: "before ", draft: "before " }); assert.equal(result.redo, "before @[角色/青岚](character:7)"); assert.equal(result.draft, result.redo); assert.equal(result.chips, 1)
}))
test("the native paste callback uses the same safe desktop insertion and undo without clipboard HTML", async () => scenario({}, async page => {
  const result = await page.evaluate(async () => { const f = (window as any).f; f.nativePaste('@[角色/青岚](character:7)'); const pasted = f.source(); await f.run('text.undo'); return { pasted, source: f.source(), draft: f.draft(), chips: f.composer.querySelectorAll('.composer-chip').length, injected: !!(window as any).injected } })
  assert.equal(result.pasted, "before @[角色/青岚](character:7)"); assert.equal(result.source, "before "); assert.equal(result.draft, result.source); assert.equal(result.chips, 0); assert.equal(result.injected, false)
}))
test("clipboard markup is inserted as literal text, never interpreted as executable HTML", async () => scenario({ clipboard: '<img src=x onerror="globalThis.injected=true"> @[角色/<script>alert(1)</script>](id:7)' }, async page => {
  const result = await page.evaluate(async () => { const f = (window as any).f; await f.run('text.paste'); return { source: f.source(), imgs: f.composer.querySelectorAll('img,script').length, injected: !!(window as any).injected } })
  assert.equal(result.imgs, 0); assert.equal(result.injected, false); assert.match(result.source, /<img src=x/)
}))
for (const change of ["focus-return", "selection", "html", "readonly", "dispose"] as const) test(`validated composer paste rejects ${change} before dispatch or insertion`, async () => scenario({}, async page => {
  const result = await page.evaluate(async change => { const f = (window as any).f, gate = f.gate(); const pending = f.run('text.pastePlain').then(() => true, () => false)
    if(change==='focus-return'){document.getElementById('outside')!.focus();f.composer.focus()}
    if(change==='selection')f.selectAll()
    if(change==='html')f.composer.appendChild(document.createTextNode(' changed'))
    if(change==='readonly')f.readonly()
    if(change==='dispose')f.adapter.dispose()
    gate.resolve('@[角色/迟到](character:8)'); const ok = await pending;return {ok, chips:f.composer.querySelectorAll('.composer-chip').length, inserts:f.calls.commands.filter(([id]:string[])=>id==='insertHTML'||id==='insertText')}
  }, change)
  assert.equal(result.ok,false);assert.equal(result.chips,0);assert.deepEqual(result.inserts,[])
}))
test("desktop custom copy and cut preserve stable reference text and cut has real undo/redo", async () => scenario({ initial: '@[角色/青岚](character:7) tail' }, async page => {
  const result = await page.evaluate(async () => {const f=(window as any).f;f.selectAll();await f.run('text.copy');await f.run('text.cut');const cut=f.source();await f.run('text.undo');const undo={source:f.source(),draft:f.draft(),chips:f.composer.querySelectorAll('.composer-chip').length};await f.run('text.redo');return {writes:f.calls.writes,cut,undo,redo:f.source(),draft:f.draft()}})
  assert.deepEqual(result.writes,['@[角色/青岚](character:7) tail','@[角色/青岚](character:7) tail']);assert.equal(result.cut,'');assert.deepEqual(result.undo,{source:'@[角色/青岚](character:7) tail',draft:'@[角色/青岚](character:7) tail',chips:1});assert.equal(result.redo,'');assert.equal(result.draft,'')
}))
test("a failed clipboard write cannot delete selected composer content", async () => scenario({ initial:'@[角色/青岚](character:7)',failWrite:true },async page=>{
  const result=await page.evaluate(async()=>{const f=(window as any).f;f.selectAll();return {ok:await f.run('text.cut').then(()=>true,()=>false),source:f.source(),commands:f.calls.commands}})
  assert.equal(result.ok,false);assert.equal(result.source,'@[角色/青岚](character:7)');assert.deepEqual(result.commands,[])
}))
test("a rejected safe HTML insertion is a failure without an insertText fallback",async()=>scenario({failInsert:true},async page=>{
  const result=await page.evaluate(async()=>{const f=(window as any).f;return{ok:await f.run('text.paste').then(()=>true,()=>false),source:f.source(),draft:f.draft()}})
  assert.equal(result.ok,false);assert.equal(result.source,'before ');assert.equal(result.draft,'before ')
}))
test("Web native paste keeps its existing Range insertion behavior without desktop undo interception",async()=>scenario({desktop:false},async page=>{
  const result=await page.evaluate(()=>{const f=(window as any).f;f.nativePaste('@[角色/青岚](character:7)');return{source:f.source(),chips:f.composer.querySelectorAll('.composer-chip').length,commands:f.calls.commands}})
  assert.equal(result.source,'before @[角色/青岚](character:7)');assert.equal(result.chips,1);assert.deepEqual(result.commands,[])
}))
test("native desktop cut callback writes stable token data and can undo and redo an empty draft",async()=>scenario({initial:'@[角色/青岚](character:7)'},async page=>{
  const result=await page.evaluate(async()=>{const f=(window as any).f;f.selectAll();const token=f.nativeCut(),cut=f.source();await f.run('text.undo');const undo={source:f.source(),draft:f.draft()};await f.run('text.redo');return{token,cut,undo,redo:f.source(),draft:f.draft()}})
  assert.equal(result.token,'@[角色/青岚](character:7)');assert.equal(result.cut,'');assert.deepEqual(result.undo,{source:'@[角色/青岚](character:7)',draft:'@[角色/青岚](character:7)'});assert.equal(result.redo,'');assert.equal(result.draft,'')
}))
test("multiline plain text with references survives native insertion, undo and redo",async()=>scenario({clipboard:'第一行\n@[正文/第二章](chapter:9)\n第三行'},async page=>{
  const result=await page.evaluate(async()=>{const f=(window as any).f;await f.run('text.pastePlain');const pasted=f.source();await f.run('text.undo');const undo=f.source();await f.run('text.redo');return{pasted,undo,redo:f.source(),draft:f.draft()}})
  assert.equal(result.pasted,'before 第一行\n@[正文/第二章](chapter:9)\n第三行');assert.equal(result.undo,'before ');assert.equal(result.redo,result.pasted);assert.equal(result.draft,result.pasted)
}))
test("a lone intended pasted newline remains a newline while empty cut placeholders serialize as empty",async()=>scenario({initial:'',clipboard:'\n'},async page=>{
  const result=await page.evaluate(async()=>{const f=(window as any).f;await f.run('text.paste');const pasted=f.source();await f.run('text.undo');const undo=f.source();await f.run('text.redo');return{pasted,undo,redo:f.source(),draft:f.draft()}})
  assert.equal(result.pasted,'\n');assert.equal(result.undo,'');assert.equal(result.redo,'\n');assert.equal(result.draft,'\n')
}))
test("clipboard read failure produces a local error without changing the composer or history",async()=>scenario({failRead:true},async page=>{
  const result=await page.evaluate(async()=>{const f=(window as any).f;return{error:await f.run('text.paste').then(()=>'',(error:Error)=>error.message),source:f.source(),commands:f.calls.commands}})
  assert.equal(result.error,'无法读取本地剪贴板，请重试');assert.equal(result.source,'before ');assert.deepEqual(result.commands,[])
}))
test("a clipboard write arriving after focus A to B to A cannot delete the original chip",async()=>scenario({initial:'@[角色/青岚](character:7)'},async page=>{
  const result=await page.evaluate(async()=>{const f=(window as any).f;f.selectAll();const gate=f.writeGate(),pending=f.run('text.cut').then(()=>true,()=>false);document.getElementById('outside')!.focus();f.composer.focus();gate.resolve();return{ok:await pending,source:f.source(),commands:f.calls.commands}})
  assert.equal(result.ok,false);assert.equal(result.source,'@[角色/青岚](character:7)');assert.deepEqual(result.commands,[])
}))
test("in-place draft text A to B to A during clipboard reading cannot revive an old paste",async()=>scenario({},async page=>{
  const result=await page.evaluate(async()=>{const f=(window as any).f,gate=f.gate();const pending=f.run('text.paste').then(()=>true,()=>false);const node=f.composer.firstChild!;node.nodeValue='temporary';node.nodeValue='before ';gate.resolve('@[角色/迟到](character:8)');return{ok:await pending,source:f.source(),commands:f.calls.commands}})
  assert.equal(result.ok,false);assert.equal(result.source,'before ');assert.deepEqual(result.commands,[])
}))
test("two concurrent menu paste intents only allow the most recent validated operation",async()=>scenario({},async page=>{
  const result=await page.evaluate(async()=>{const f=(window as any).f,first=f.gate();const older=f.run('text.paste').then(()=>true,()=>false),second=f.gate();const newer=f.run('text.pastePlain').then(()=>true,()=>false);first.resolve('OLDER');const old=await older;second.resolve('@[角色/青岚](character:7)');return{old,newer:await newer,source:f.source(),chips:f.composer.querySelectorAll('.composer-chip').length}})
  assert.equal(result.old,false);assert.equal(result.newer,true);assert.equal(result.source,'before @[角色/青岚](character:7)');assert.equal(result.chips,1)
}))
test("a missing composer paste handler fails closed instead of inserting unhydrated plain text",async()=>scenario({noHandler:true},async page=>{
  const result=await page.evaluate(async()=>{const f=(window as any).f;return{error:await f.run('text.paste').then(()=>'',(error:Error)=>error.message),source:f.source(),commands:f.calls.commands}})
  assert.equal(result.error,'消息输入框尚未就绪，未粘贴内容');assert.equal(result.source,'before ');assert.deepEqual(result.commands,[])
}))
test("empty clipboard is a no-op and oversized or nonstring clipboard payloads reject before insertion",async()=>{
  for(const clipboard of ['', 'x'.repeat(1024*1024+1), 7])await scenario({clipboard},async page=>{
    const result=await page.evaluate(async()=>{const f=(window as any).f;return{ok:await f.run('text.paste').then(()=>true,()=>false),source:f.source(),commands:f.calls.commands}})
    assert.equal(result.ok,clipboard==='');assert.equal(result.source,'before ');assert.deepEqual(result.commands,[])
  })
})
test("the original native copy handler preserves reference identity without changing the draft",async()=>scenario({initial:'@[角色/青岚](character:7) tail'},async page=>{
  const result=await page.evaluate(()=>{const f=(window as any).f;f.selectAll();return{copied:f.nativeCopy(),source:f.source(),commands:f.calls.commands}})
  assert.equal(result.copied,'@[角色/青岚](character:7) tail');assert.equal(result.source,result.copied);assert.deepEqual(result.commands,[])
}))
test("even a consumer throwing an undefined value reports failure without inserting content",async()=>scenario({throwHydrate:true},async page=>{
  const result=await page.evaluate(async()=>{const f=(window as any).f;return{ok:await f.run('text.paste').then(()=>true,()=>false),source:f.source(),commands:f.calls.commands}})
  assert.equal(result.ok,false);assert.equal(result.source,'before ');assert.deepEqual(result.commands,[])
}))
