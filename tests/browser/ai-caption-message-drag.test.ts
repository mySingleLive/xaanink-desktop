import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"
import ts from "typescript"
import { build } from "esbuild"
import postcss from "postcss"
import tailwindcss from "@tailwindcss/postcss"
import { chromium, type Browser, type Page } from "playwright-core"

// Execute the real caption, message host/viewport JSX and ThinkingRow. Only the
// message data and unrelated AI/backend lifecycle are isolated. The input is
// an isolated interaction probe, not full composer or native-window acceptance.
const source = ts.createSourceFile("ChatPanel.tsx", readFileSync("src/components/layout/ChatPanel.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let caption = "", host = "", scroller = "", root = "", thinking = "", timer = ""
function inspect(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "ThinkingRow") thinking = node.getText(source)
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === "PENDING_TIMER_THRESHOLD_SEC") timer = `const ${node.getText(source)};`
  if (ts.isJsxElement(node)) {
    const opening = node.openingElement, text = opening.getText(source)
    if (text.includes('className="chatpane ')) root = text
    if (text.includes('className="desktop-drag flex h-11')) caption = node.getText(source)
    if (text.includes('messages.length === 0 ? "hidden"')) host = text
    if (text.includes("ref={scrollRef}")) scroller = text
  }
  ts.forEachChild(node, inspect)
}
inspect(source)
assert(root && caption && host && scroller && thinking && timer, "Original caption/message JSX and ThinkingRow must be available")
const cssPath = resolve("src/app/globals.css")
const stylesheet = postcss([tailwindcss()]).process(readFileSync(cssPath, "utf8"), { from: cssPath }).then(result => result.css + "\n" + readFileSync("src/app/desktop.css", "utf8"))
const bundle = build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
import React,{useState,useEffect,useRef} from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {Brain,ChevronDown,ChevronRight,MessageSquare,PanelLeft,PanelRight} from 'lucide-react';
import {Collapse} from './src/components/chat/Collapse';import {formatDuration} from './src/lib/duration';import {cn} from './src/lib/utils';
import {MentionPopup} from './src/components/chat/MentionPopup';
${timer}
${thinking}
window.mountMessageCaption=()=>{
 const calls=[];let resize,appearance,restores,floating;const messages=Array.from({length:20},(_,i)=>({id:'synthetic-'+i}));
 const currentConversation={title:'合成滚动验收会话标题，验证图标和第一个字附近的原生命中'};
 const canSend=true,progressVisible=false,PROGRESS_GUTTER_CLASS='';
 function App(){const [width,setWidth]=useState(600),[zoom,setZoom]=useState(1),[showRestores,setRestores]=useState(false),[showFloating,setFloating]=useState(false);resize=setWidth;appearance=setZoom;restores=setRestores;floating=setFloating;
 const scrollRef=useRef(null),handleScroll=()=>{},handleMessageAreaClick=()=>{};
 const desktopBootstrap={platform:'win32',settings:{appearance:{zoom}}};const sidebarHidden=showRestores,contentHidden=showRestores;
 const onShowSidebar=()=>calls.push('sidebar'),onShowContent=()=>calls.push('content');
 return <div id='fixture-chat' style={{width,height:500,marginLeft:200}}>${root}${caption}${host}${scroller}
 <div className='mx-auto flex w-full max-w-[960px] flex-col gap-4'>{messages.map((m,i)=><div key={m.id} data-thinking-message={i}><ThinkingRow thinking={{active:false,text:'独立思考内容',durationSec:2}}/><p>{'合成消息用于换行和纵向滚动。'.repeat(12)}</p></div>)}</div>
 </div></div><div data-composer className='shrink-0'><div contentEditable suppressContentEditableWarning aria-label='隔离输入区'>合成草稿</div><button onClick={()=>calls.push('composer')}>隔离操作</button>
 {showFloating&&<><div style={{position:'fixed',left:220,top:300,width:300}}><MentionPopup groups={[{key:'character',label:'合成角色',items:Array.from({length:20},(_,i)=>({key:'probe-'+i,kind:'character',name:'合成引用 '+i,insert:'合成引用 '+i}))}]} activeIndex={0} onActiveChange={()=>{}} onSelect={item=>{calls.push('mention:'+item.key);setFloating(false)}}/></div><div role='tooltip' data-floating-probe className='fixed' style={{left:550,top:12,width:150,height:60}}><button onClick={()=>calls.push('floating')}>隔离浮层动作</button></div></>}
 </div></div></div>;
 }
 const reactRoot=createRoot(document.getElementById('app'));flushSync(()=>reactRoot.render(<App/>));
 window.messageCaption={calls,resize:w=>flushSync(()=>resize(w)),appearance:z=>{document.documentElement.style.setProperty('--desktop-caption-zoom',String(z));flushSync(()=>appearance(z))},restores:v=>flushSync(()=>restores(v)),floating:v=>flushSync(()=>floating(v)),unmount:()=>reactRoot.unmount()};
};` }, bundle: true, platform: "browser", format: "iife", write: false, tsconfig: "tsconfig.json" }).then(r => r.outputFiles![0].text)

let browser: Browser
test.before(async () => { browser = await chromium.launch({ headless: true, ...(process.env.XAANINK_TEST_CHROMIUM ? { executablePath: process.env.XAANINK_TEST_CHROMIUM } : {}) }) })
test.after(async () => { await browser?.close() })
async function frames(page: Page) { await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))) }
async function scenario(run: (page: Page) => Promise<void>) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 650 } }), errors: string[] = []
  page.on("pageerror", e => errors.push(e.message))
  try {
    await page.route("**/*", route => route.abort()); await page.setContent('<div id="app"></div>')
    await page.addStyleTag({ content: await stylesheet }); await page.addScriptTag({ content: await bundle })
    await page.evaluate(() => (window as any).mountMessageCaption()); await frames(page)
    await run(page); assert.deepEqual(errors, [])
  } finally { await page.close() }
}

test("AIDRAG-05 vertically clipped real ThinkingRow buttons do not exclude the caption icon or first character", () => scenario(async page => {
  for (const zoom of [.75, 1, 1.25, 1.5, 2]) for (const width of [600, 320, 720]) {
    await page.evaluate(({ zoom, width }) => { (window as any).messageCaption.appearance(zoom); (window as any).messageCaption.resize(width) }, { zoom, width }); await frames(page)
    await page.evaluate(() => {
      const scroll = document.querySelector<HTMLElement>('.chatpane .overflow-y-auto')!, button = document.querySelector<HTMLElement>('[data-thinking-message="10"] button')!
      scroll.scrollTop += button.getBoundingClientRect().top - 8
    }); await frames(page)
    const g = await page.evaluate(() => {
      const caption = document.querySelector('.chatpane > .desktop-drag')!, title = caption.getBoundingClientRect(), icon = caption.querySelector('svg')!.getBoundingClientRect(), text = caption.querySelector('span')!
      const firstCharacter = document.createRange(); firstCharacter.setStart(text.firstChild!, 0); firstCharacter.setEnd(text.firstChild!, 1)
      const character = firstCharacter.getBoundingClientRect()
      const button = document.querySelector('[data-thinking-message="10"] button')!, b = button.getBoundingClientRect(), scroll = document.querySelector('.chatpane .overflow-y-auto')!
      const exclusions = [...document.querySelectorAll('.chatpane *')].filter(el => {
        const r = el.getBoundingClientRect()
        return getComputedStyle(el).getPropertyValue('-webkit-app-region') === 'no-drag' && r.width > 0 && r.height > 0 && r.left < title.right && r.right > title.left && r.top < title.bottom && r.bottom > title.top
      }).map(el => ({ tag: el.tagName, className: String(el.className) }))
      const hit = document.elementFromPoint(icon.left + icon.width / 2, icon.top + icon.height / 2)
      const body = scroll.parentElement!, bodyRect = body.getBoundingClientRect()
      return { scrollTop: scroll.scrollTop, buttonOverTitle: b.top < title.bottom && b.bottom > title.top, buttonOverIcon: b.left < icon.right && b.right > icon.left, buttonOverFirstCharacter: b.left < character.right && b.right > character.left, visualHitIsCaption: hit?.closest('.desktop-drag') === caption, bodyBelowCaption: bodyRect.top >= title.bottom && bodyRect.width > 0 && bodyRect.height > 0, exclusions, bodyRegion: getComputedStyle(body).getPropertyValue('-webkit-app-region'), buttonRegion: getComputedStyle(button).getPropertyValue('-webkit-app-region'), descendantRegions: [...body.querySelectorAll('*')].map(el => getComputedStyle(el).getPropertyValue('-webkit-app-region')) }
    })
    assert(g.scrollTop > 0); assert(g.buttonOverTitle); assert(g.buttonOverIcon, "Real hidden message control must exercise the reported icon position")
    assert(g.buttonOverFirstCharacter); assert(g.visualHitIsCaption); assert(g.bodyBelowCaption)
    assert.deepEqual(g.exclusions, [], `Clipped body control invaded caption at width ${width}, zoom ${zoom}`)
    assert.equal(g.bodyRegion, 'no-drag'); assert.equal(g.buttonRegion, 'none')
    assert(g.descendantRegions.every(region => region === 'none'))
  }
}))

test("AIDRAG-06 body controls remain interactive and caption restore buttons retain their exclusions", () => scenario(async page => {
  const thinking = page.locator('[data-thinking-message="0"] button')
  await thinking.click(); await page.getByText('独立思考内容', { exact: true }).first().waitFor({ state: 'visible' })
  await thinking.click(); await page.getByText('独立思考内容', { exact: true }).first().waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: '隔离操作', exact: true }).click()
  await page.evaluate(() => (window as any).messageCaption.restores(true)); await frames(page)
  for (const name of ['显示左侧导航栏', '显示内容面板']) {
    const button = page.getByRole('button', { name, exact: true })
    assert.equal(await button.evaluate(el => getComputedStyle(el).getPropertyValue('-webkit-app-region')), 'no-drag'); await button.click()
  }
  assert.deepEqual(await page.evaluate(() => (window as any).messageCaption.calls), ['composer', 'sidebar', 'content'])
  const regions = await page.locator('[data-composer], [data-composer] button, [data-composer] [contenteditable]').evaluateAll(els => els.map(el => getComputedStyle(el).getPropertyValue('-webkit-app-region')))
  assert.deepEqual(regions, ['no-drag', 'none', 'none'])
}))

test("AIDRAG-07 visible floating roots retain exclusions while their clipped options do not register separately", () => scenario(async page => {
  await page.evaluate(() => (window as any).messageCaption.floating(true)); await frames(page)
  const list = page.getByRole('listbox', { name: '引用资源', exact: true })
  const g = await list.evaluate(el => {
    const r = el.getBoundingClientRect(), title = document.querySelector('.chatpane > .desktop-drag')!.getBoundingClientRect()
    return { crossesCaption: r.top < title.bottom && r.bottom > title.top, region: getComputedStyle(el).getPropertyValue('-webkit-app-region'), children: [...el.querySelectorAll('*')].map(child => getComputedStyle(child).getPropertyValue('-webkit-app-region')) }
  })
  assert(g.crossesCaption, 'Fixture must exercise the real MentionPopup above its composer')
  assert.equal(g.region, 'no-drag'); assert(g.children.every(region => region === 'none'))
  assert.equal(await page.locator('[data-floating-probe]').evaluate(el => getComputedStyle(el).getPropertyValue('-webkit-app-region')), 'no-drag')
  await page.getByRole('button', { name: '隔离浮层动作', exact: true }).click()
  await list.evaluate(el => { el.scrollTop = el.scrollHeight }); await frames(page)
  assert(await list.evaluate(el => el.scrollTop > 0 && el.querySelector('button')!.getBoundingClientRect().top < document.querySelector('.chatpane > .desktop-drag')!.getBoundingClientRect().top))
  await page.getByRole('option', { name: '合成引用 19', exact: true }).click()
  assert.deepEqual(await page.evaluate(() => (window as any).messageCaption.calls), ['floating', 'mention:probe-19'])
  assert.equal(await list.count(), 0); assert.equal(await page.locator('[data-floating-probe]').count(), 0)
  assert.equal(await page.locator('.chatpane > .desktop-drag').evaluate(el => getComputedStyle(el).getPropertyValue('-webkit-app-region')), 'drag')
}))
