import {build} from 'esbuild'
import {chromium} from 'playwright-core'
import {readFile,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {commandCatalogSources} from './command-catalog-sources.mjs'
// Build-time only: assemble the installed editor in two isolated browser
// contexts. This enumerates platform registrations, not native OS acceptance.
const bundle=await build({stdin:{contents:`import {initializeMonacoCommandCatalog} from './src/lib/desktop/monaco-commands';import {desktopCommandCatalog} from './src/lib/desktop/command-runtime';globalThis.buildCatalog=async platform=>{const release=await initializeMonacoCommandCatalog(platform);try{return desktopCommandCatalog(platform)}finally{release()}};`,resolveDir:process.cwd(),loader:'ts'},bundle:true,format:'iife',platform:'browser',write:false,loader:{'.css':'empty','.ttf':'dataurl'},logLevel:'error'})
const sourceHashes=Object.fromEntries(await Promise.all(commandCatalogSources.map(async file=>[file,createHash('sha256').update(await readFile(file)).digest('hex')])))
const browser=await chromium.launch({headless:true,...(process.env.XAANINK_TEST_CHROMIUM?{executablePath:process.env.XAANINK_TEST_CHROMIUM}:{})})
const platforms={}
try{
 for(const [platform,os] of [['darwin','MacIntel'],['win32','Win32']]){
  const context=await browser.newContext({userAgent:platform==='darwin'?'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/149.0.0.0 Safari/537.36':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149.0.0.0 Safari/537.36'})
  try{
   await context.addInitScript(os=>Object.defineProperty(navigator,'platform',{value:os}),os)
   const page=await context.newPage()
   await page.route('**/*',route=>route.request().isNavigationRequest()?route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset=utf-8><title>Installed command registry</title>'}):route.abort())
   await page.goto('https://local.invalid/catalog');await page.addScriptTag({content:bundle.outputFiles[0].text})
   const commands=await page.evaluate(platform=>globalThis.buildCatalog(platform),platform)
   if(commands.length<200||new Set(commands.map(row=>row.id)).size!==commands.length)throw Error('Incomplete command catalog')
   platforms[platform]={resolved:true,commands,sha256:createHash('sha256').update(JSON.stringify(commands)).digest('hex')}
  }finally{await context.close()}
 }
 const version=JSON.parse(await readFile('node_modules/monaco-editor/package.json','utf8')).version
 await writeFile('desktop/shared/command-catalogs.generated.json',JSON.stringify({schemaVersion:1,monacoVersion:version,sourceHashes,platforms},null,2)+'\n')
 console.log(JSON.stringify({monacoVersion:version,commands:Object.fromEntries(Object.entries(platforms).map(([key,value])=>[key,value.commands.length]))}))
}finally{await browser.close()}
