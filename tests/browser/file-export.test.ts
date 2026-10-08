import assert from "node:assert/strict"
import { test } from "node:test"
import { readFile, mkdtemp, rm, readdir } from "node:fs/promises"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { build } from "esbuild"
import postcss from "postcss"
import tailwindcss from "@tailwindcss/postcss"
import { chromium, type Browser, type Page } from "playwright-core"
import JSZip from "jszip"
import { PDFDocument, PDFDict, PDFName, PDFRawStream } from "pdf-lib"
import sharp from "sharp"
import { FileExports } from "../../desktop/main/file-export"
import type { FileExportRequest } from "../../desktop/shared/file-export"

// Actual original converters, React/BaseUI menus and Chromium canvas/font/PDF
// parser. Only the Electron IPC/picker and source API are controlled; the main
// service writes real isolated FS. This is not an OS SaveDialog acceptance.
const css = (async () => { const path = resolve("src/app/globals.css"); return (await postcss([tailwindcss()]).process(await readFile(path, "utf8"), { from: path })).css })()
const bundle = build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: String.raw`
import React from 'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';import{Toaster}from'sonner';
import{createManuscriptExport,downloadManuscript,manuscriptFilename}from'./src/lib/manuscript-export';import{createCollectionExport}from'./src/lib/collection-export';
import{TemplateManagementDialog}from'./src/components/desktop/TemplateManagementDialog';import{OutlineTreeMenu}from'./src/components/layout/OutlineTreeMenu';
import{ChapterContentPanel}from'./src/components/content/ChapterContentPanel';
import{getDocument,GlobalWorkerOptions}from'pdfjs-dist/build/pdf.mjs';
GlobalWorkerOptions.workerSrc='/pdf.worker.mjs';
window.mountExport16=(mode='formats')=>{
 const originalFetch=window.fetch.bind(window),calls=[],results=[];
 const source='# 正文小标题\n\n中文草稿 **加粗** 与 _斜体_。\n\n[外部链接](https://must-not-fetch.invalid) ![不下载正文图片](https://must-not-fetch.invalid/p.png)\n\n<script>never_execute()</script>\n\n正文终点。';
 const metadata={title:'本地书名',author:'本地笔名',synopsis:'长简介。'.repeat(90),coverUrl:'/_desktop/assets/work-a/cover.png'};
 const chapterSource='# 本地章稿\n\n正在显示的 **中文源文**。章稿终点。',chapter={id:'c1',volumeId:'v1',index:1,title:'第一章',outline:'大纲',content:chapterSource,wordCount:20,status:'DRAFT',version:1,volume:{id:'v1',novelId:'novel-a',index:1,title:'第一卷',summary:'卷简介'}};
 const collection={...metadata,kind:'content',volumes:[{id:'v2',index:2,title:'第二卷',summary:'',chapters:[{id:'c2',index:2,title:'第二章',text:'第二章终点。'}]},{id:'v1',index:1,title:'第一卷',summary:'',chapters:[{id:'c1',index:1,title:'第一章',text:'长正文。'.repeat(500)+'第一章终点。'}]}]};
 const templateDocument={format:'xuanxiang-local-templates',schemaVersion:1,prompts:[{key:'user.local',name:'作者模板',content:'保留 {{subject}}',variables:['subject'],enabled:true,version:1,source:'user'}],wizardTemplates:[]};
 window.fetch=async(input,init={})=>{const path=String(input);if(!path.startsWith('/api/'))return originalFetch(input,init);calls.push({path,method:init.method||'GET'});if(path==='/api/templates/export')return Response.json({document:templateDocument});if(path==='/api/admin/prompts')return Response.json({prompts:[],revision:1});if(path==='/api/novels/novel-a/chapters/c1')return Response.json({chapter});if(path.endsWith('/candidates'))return Response.json({candidates:[]});if(path.includes('/comments?'))return Response.json({threads:[]});if(path.includes('/score-report?'))return Response.json({report:{targetType:'CHAPTER_CONTENT',targetId:'c1',targetLabel:'第一章',contentKind:'prose',supportsReaderPanel:true,score:null,scoredAt:null,stale:false,reviewing:false,contentEmpty:false,dimensions:[],agents:[],history:[]}});if(path.endsWith('/foreshadows'))return Response.json({foreshadows:[]});if(path.includes('/manuscript?kind='))return Response.json(collection);throw Error('unexpected local source API '+path)};
 window.desktop={exportFile:input=>window.mainExport16({...input,bytes:Array.from(input.bytes)}),cancelFileExport:id=>window.mainCancel16(id)};
 const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}}),root=createRoot(document.getElementById('app'));let open=true,chapterVisible=true;
 const render=()=>flushSync(()=>root.render(<QueryClientProvider client={client}>{mode==='templates'?<TemplateManagementDialog open={open} onOpenChange={value=>{open=value;render()}}/>:mode==='collection'?<OutlineTreeMenu novel={{id:'novel-a',title:'本地书名'}} kind='content'/>:mode==='chapter'?chapterVisible?<div style={{height:650}}><ChapterContentPanel novelId='novel-a' refId='c1'/></div>:null:<p>隔离导出函数夹具</p>}<Toaster/></QueryClientProvider>));render();
 return{calls,results,source,chapterSource,collection,setChapterVisible(value){chapterVisible=value;render()},setOpen(value){open=value;render()},unmount(){root.unmount();client.clear()},async single(format){const blob=await createManuscriptExport(format,'第一章',source,undefined,format==='docx'||format==='pdf'?metadata:undefined);const saved=await downloadManuscript(blob,manuscriptFilename('第一章',format));results.push(saved);return saved},async book(format){const{blob,title}=await createCollectionExport(format,collection);return downloadManuscript(blob,manuscriptFilename(title,format))},async unsupported(){return createManuscriptExport('pdf','不支持符号','🛸')},async pdfText(bytes){const task=getDocument({data:new Uint8Array(bytes)}),pdf=await task.promise;let text='';for(let index=1;index<=pdf.numPages;index++)text+=(await(await pdf.getPage(index)).getTextContent()).items.map(item=>item.str||'').join('');await task.destroy();return text}};
};` }, loader: { ".css": "empty" }, bundle: true, platform: "browser", format: "iife", write: false, tsconfig: "tsconfig.json", logOverride: { "empty-import-meta": "silent" } }).then(result => result.outputFiles![0].text)
let browser: Browser
async function waitFor(check: () => boolean) { const deadline = Date.now() + 8000; while (!check()) { if (Date.now() >= deadline) throw Error("Controlled save request did not arrive"); await new Promise(resolve => setTimeout(resolve, 10)) } }
test.before(async () => { browser = await chromium.launch({ headless: true, executablePath: process.env.XAANINK_TEST_CHROMIUM }) })
test.after(async () => { await browser?.close() })
async function scenario(mode: string, run: (page: Page, root: string, control: { gate: PromiseWithResolvers<string | null>; paths: string[]; cancelled: string[]; service: FileExports; hold: boolean; cancel: boolean }) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "xuanxiang-browser-export16-")), page = await browser.newPage(), errors: string[] = [], requests: string[] = [], downloads: string[] = []
  page.setDefaultTimeout(8000); page.on("pageerror", error => errors.push(error.message)); page.on("download", download => downloads.push(download.suggestedFilename()))
  const control = { gate: Promise.withResolvers<string | null>(), paths: [] as string[], cancelled: [] as string[], service: null as unknown as FileExports, hold: false, cancel: false }
  control.service = new FileExports({ assertOwner: () => {}, guardTarget: async () => {}, chooseSave: async (_owner, input) => { const path = join(root, input.filename); control.paths.push(path); return control.hold ? control.gate.promise : control.cancel ? null : path } })
  try {
    const font = await readFile("public/fonts/noto-sans-sc/NotoSansSC-Regular.ttf.gz"), worker = await readFile("node_modules/pdfjs-dist/build/pdf.worker.mjs", "utf8"), cover = await sharp({ create: { width: 8, height: 12, channels: 3, background: "#cba" } }).png().toBuffer()
    await page.route("**/*", async route => { const path = new URL(route.request().url()).pathname; requests.push(path); if (path === "/fonts/noto-sans-sc/NotoSansSC-Regular.ttf.gz") return route.fulfill({ body: font }); if (path === "/pdf.worker.mjs") return route.fulfill({ body: worker, contentType: "text/javascript" }); if (path === "/_desktop/assets/work-a/cover.png") return route.fulfill({ body: cover, contentType: "image/png" }); if (route.request().isNavigationRequest()) return route.fulfill({ body: '<div id="app"></div>', contentType: "text/html" }); return route.abort() })
    await page.exposeFunction("mainExport16", async (input: Omit<FileExportRequest, "bytes"> & { bytes: number[] }) => control.service.save("controlled-window:nonce", { ...input, bytes: Uint8Array.from(input.bytes) }))
    await page.exposeFunction("mainCancel16", async (id: string) => { control.cancelled.push(id); control.service.cancel("controlled-window:nonce", id) })
    await page.goto("http://127.0.0.1:1/export16"); await page.addStyleTag({ content: await css }); await page.addScriptTag({ content: await bundle }); await page.evaluate(mode => { (window as any).f = (window as any).mountExport16(mode) }, mode)
    await run(page, root, control); assert.deepEqual(errors, []); assert.deepEqual(downloads, []); assert.ok(requests.every(path => path === "/export16" || path.startsWith("/fonts/") || path.startsWith("/_desktop/assets/") || path === "/pdf.worker.mjs"))
  } finally { control.gate.resolve(null); await control.service.flush(); await page.close(); await rm(root, { recursive: true, force: true }) }
}
test("EXB16-01 all four original single-chapter converters save parseable exact documents without browser downloads or source-image requests", () => scenario("formats", async (page, root) => {
  for (const format of ["txt", "md", "docx", "pdf"]) assert.equal(await page.evaluate(format => (window as any).f.single(format), format), true)
  const source = await page.evaluate(() => (window as any).f.source), txt = await readFile(join(root, "第一章.txt")), md = await readFile(join(root, "第一章.md"), "utf8")
  assert.deepEqual([...txt.subarray(0, 3)], [239, 187, 191]); assert.match(txt.toString(), /中文草稿 加粗 与 斜体/); assert.equal(md, source)
  const docx = await JSZip.loadAsync(await readFile(join(root, "第一章.docx"))); const xml = await docx.file("word/document.xml")!.async("string")
  assert.match(xml, /本地书名/); assert.match(xml, /正文终点/); const images = Object.keys(docx.files).filter(path => path.startsWith("word/media/") && !docx.files[path].dir), sizes = await Promise.all(images.map(async path => sharp(await docx.file(path)!.async("nodebuffer")).metadata())); assert.ok(sizes.some(size => size.width === 8 && size.height === 12)); assert.match(xml, /<a:blip /); assert.match(await docx.file("docProps/core.xml")!.async("string"), /本地笔名/)
  const bytes = await readFile(join(root, "第一章.pdf")), pdf = await PDFDocument.load(bytes); assert.equal(pdf.getTitle(), "本地书名"); assert.ok(pdf.getPageCount() >= 3)
  assert.ok(pdf.context.enumerateIndirectObjects().some(([, object]) => object instanceof PDFDict && pdf.context.lookup(object.get(PDFName.of("FontFile2"))) instanceof PDFRawStream))
  const text = await page.evaluate(bytes => (window as any).f.pdfText(bytes), [...bytes]); assert.match(text, /中文草稿/); assert.match(text, /正文终点/); assert.match(text, /本地笔名/)
}))
test("EXB16-02 whole-book exports retain original volume/chapter ordering and multi-page Chinese text", () => scenario("formats", async (page, root) => {
  for (const format of ["txt", "md", "docx", "pdf"]) assert.equal(await page.evaluate(format => (window as any).f.book(format), format), true)
  const paths = await readdir(root), txt = await readFile(join(root, paths.find(path => path.endsWith(".txt"))!), "utf8")
  assert.ok(txt.indexOf("第一章终点") < txt.indexOf("第二章终点")); const bytes = await readFile(join(root, paths.find(path => path.endsWith(".pdf"))!)), pdf = await PDFDocument.load(bytes); assert.ok(pdf.getPageCount() > 3)
  const text = await page.evaluate(bytes => (window as any).f.pdfText(bytes), [...bytes]); assert.ok(text.indexOf("第一章终点") < text.indexOf("第二章终点"))
}))
test("EXB16-03 actual template manager waits for native-channel completion, cancellation creates no JSON and closing invalidates a late path", () => scenario("templates", async (page, root, control) => {
  control.cancel = true; const button = page.getByRole("button", { name: "导出", exact: true }); await button.click(); await waitFor(() => control.paths.length === 1); await control.service.flush(); await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === '导出' && !button.disabled)); assert.deepEqual(await readdir(root), [])
  control.cancel = false; control.hold = true; await button.click(); await waitFor(() => control.paths.length >= 2); assert.equal(await button.isDisabled(), true)
  await page.evaluate(() => (window as any).f.setOpen(false)); control.gate.resolve(join(root, "late.json")); await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 30))); assert.deepEqual(await readdir(root), [])
}))
test("EXB16-04 actual template manager uses the same confirmed main save channel and exports no model credentials", () => scenario("templates", async (page, root, control) => {
  await page.getByRole("button", { name: "导出", exact: true }).click(); await waitFor(() => control.paths.length > 0); await control.service.flush()
  const document = JSON.parse(await readFile(join(root, "玄印写作模板与提示词.json"), "utf8")); assert.equal(document.format, "xaanink-local-templates"); assert.equal(document.prompts[0].content, "保留 {{subject}}"); assert.doesNotMatch(JSON.stringify(document), /apiKey|encryptedKey|endpoint/)
}))
test("EXB16-05 the original collection menu exports its local source through the awaited native channel", () => scenario("collection", async (page, root, control) => {
  await page.getByRole("button", { name: "正文导航功能菜单", exact: true }).click(); await page.getByRole("menuitem", { name: "导出整书正文", exact: true }).hover(); await page.getByRole("menuitem", { name: "Markdown (.md)", exact: true }).click()
  await waitFor(() => control.paths.length > 0); await control.service.flush(); const path = (await readdir(root)).find(path => path.endsWith(".md"))!; assert.match(await readFile(join(root, path), "utf8"), /第一章终点/); await page.getByText("导出文件已保存", { exact: true }).waitFor()
}))
test("EXB16-06 unsupported font symbols fail before any SaveDialog request or truncated file", () => scenario("formats", async (page, root, control) => {
  assert.match(await page.evaluate(() => (window as any).f.unsupported().then(() => "unexpected", (error: Error) => error.message)), /字体暂不支持/); assert.deepEqual(control.paths, []); assert.deepEqual(await readdir(root), [])
}))
test("EXB16-07 actual chapter menu awaits saving and unmount cancels the pending picker without saving or approving content", () => scenario("chapter", async (page, root, control) => {
  const choose = async () => { await page.getByRole("button", { name: "正文功能菜单", exact: true }).click(); await page.getByRole("menuitem", { name: "导出", exact: true }).hover(); await page.getByRole("menuitem", { name: "Markdown (.md)", exact: true }).click() }
  control.hold = true; await choose(); await waitFor(() => control.paths.length === 1); assert.deepEqual(await readdir(root), []); assert.equal(await page.getByText("导出文件已保存", { exact: true }).count(), 0)
  await page.evaluate(() => (window as any).f.setChapterVisible(false)); await waitFor(() => control.cancelled.length === 1); control.gate.resolve(join(root, "late.md")); await control.service.flush(); assert.deepEqual(await readdir(root), [])
  control.hold = false; await page.evaluate(() => (window as any).f.setChapterVisible(true)); await choose(); await waitFor(() => control.paths.length === 2); await control.service.flush(); assert.equal(await readFile(control.paths[1], "utf8"), await page.evaluate(() => (window as any).f.chapterSource)); await page.getByText("导出文件已保存", { exact: true }).waitFor()
  const calls = await page.evaluate(() => (window as any).f.calls); assert.ok(calls.every((call: { method: string }) => call.method === "GET"))
}))
