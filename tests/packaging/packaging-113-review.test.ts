import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,cp,mkdir,rm,lstat,writeFile} from 'node:fs/promises'
import {join,resolve,dirname} from 'node:path'
import {tmpdir} from 'node:os'
import {createRequire} from 'node:module'

const project=resolve(import.meta.dirname,'../..')
const require=createRequire(import.meta.url)
const entries=['dist/main/index.cjs','dist/service/index.cjs','dist/preload/index.cjs','dist/preload/maintenance.cjs','dist/preload/root-relocation.cjs']
function actualProjectFilter(){
 const config=require(join(project,'electron-builder.config.cjs')),{getMainFileMatchers}=require('app-builder-lib/out/fileMatcher.js'),debugLogger={isEnabled:false}
 const packager={info:{config,projectDir:project,buildResourcesDir:'build',isPrepackedAppAsar:false,debugLogger}}
 const matchers=getMainFileMatchers(project,'/tmp/packaging-review113-output',(value:string)=>value.replaceAll('${arch}','arm64'),config.mac,packager,join(project,'release'),false)
 return(path:string,directory=false)=>matchers.some((matcher:any)=>matcher.createFilter()(path,{isDirectory:()=>directory}))
}

async function resourcesFixture(){
 const base=await mkdtemp(join(tmpdir(),'xuanxiang-packaging-review113-')),source=join(base,'source-inputs'),packaged=join(base,'packaged-root')
 const allowed=actualProjectFilter()
 for(const root of[source,packaged]){
  await mkdir(root)
  for(const path of[...entries,'out','prisma/migrations','runtime-licenses','LICENSE','THIRD_PARTY_NOTICES.md','package.json']){
   await mkdir(dirname(join(root,path)),{recursive:true});await cp(join(project,path),join(root,path),{recursive:true,...(root===packaged?{filter:async(path:string)=>allowed(path,(await lstat(path)).isDirectory())}:{})})
  }
 }
 await cp(join(project,'public'),join(source,'public'),{recursive:true})
 console.log('Retained independent packaging fixture:',base)
 return{base,source,packaged}
}

for(const path of['out/index.html','out/fonts/noto-sans-sc/NotoSansSC-Regular.ttf.gz'])test(`PK113-R01 resource guard rejects required ${path} even when both build input and package omitted it`,{timeout:60000},async()=>{
 const{verifyProjectResources}=await import('../../scripts/inspect-packaged-app.mjs')
 const f=await resourcesFixture()
 await verifyProjectResources(f.source,f.packaged)
 await rm(join(f.source,path));await rm(join(f.packaged,path))
 await assert.rejects(verifyProjectResources(f.source,f.packaged),/缺失|missing|required|运行资源/)
})

test('PK113-R02 installed builder excludes project database files within the exported UI subtree',()=>{
 const filter=actualProjectFilter(),allowed=(path:string)=>filter(join(project,path))
 assert.equal(allowed('out/index.html'),true)
 assert.equal(allowed('out/fonts/noto-sans-sc/NotoSansSC-Regular.ttf.gz'),true)
 for(const path of['out/author.sqlite3','out/data/author.db','out/data/database/PG_VERSION'])assert.equal(allowed(path),false,`project database must not be included: ${path}`)
})

test('PK113-R03 actual installed Windows dispatch edits product resources while code signing stays disabled',async()=>{
 const config=require(join(project,'electron-builder.config.cjs')),{WinPackager}=require('app-builder-lib'),{Arch}=require('builder-util')
 const fixture=await mkdtemp(join(tmpdir(),'xuanxiang-packaging-win-dispatch113-')),file=join(fixture,'玄印写作.exe'),edited:string[]=[]
 await writeFile(file,'isolated dispatch sentinel, not a runnable PE')
 console.log('Retained independent Windows dispatch fixture:',fixture)
 const host={platformSpecificBuildOptions:config.win,forceCodeSigning:config.forceCodeSigning,appInfo:{productFilename:'玄印写作'},signAndEditResources:async(path:string)=>{edited.push(path)},shouldSignFile:()=>false,signIf:async()=>{throw Error('Windows signing must remain disabled')}}
 // The installed builder executes the actual conditional, filesystem listing
 // and dispatch. Only the native PE editor endpoint is a recorded port.
 await WinPackager.prototype.signApp.call(host,{appOutDir:fixture,outDir:fixture,arch:Arch.x64},false)
 assert.deepEqual(edited,[file],'product icon/version resource editing must not be bypassed')
 assert.equal(config.win.signExecutable,false)
})
