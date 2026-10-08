import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFileSync} from 'node:fs'
import {mkdtemp,readFile,rm,realpath} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import ts from 'typescript'
import {transformSync} from 'esbuild'
import {FileExports} from '../../desktop/main/file-export'
import {BusinessGate} from '../../desktop/main/business-gate'
import {ApplicationMetadataGate} from '../../desktop/main/application-metadata-gate'
const source=ts.createSourceFile('index.ts',readFileSync('desktop/main/index.ts','utf8'),ts.ScriptTarget.Latest,true)
function declaration(name:string){const node=source.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name);assert.ok(node);return node.getText(source)}
let closeData='',release=''
function walk(node:ts.Node){if(ts.isNewExpression(node)&&node.expression.getText(source)==='CloseCoordinator'){const object=node.arguments![0];assert.ok(ts.isObjectLiteralExpression(object));const property=object.properties.find(property=>property.name?.getText(source)==='closeData');assert.ok(property&&ts.isPropertyAssignment(property));closeData=property.initializer.getText(source)}if(ts.isVariableDeclaration(node)&&node.name.getText(source)==='releaseOwner')release=node.initializer!.getText(source);ts.forEachChild(node,walk)}walk(source)
function compile<T>(text:string,deps:Record<string,unknown>):T{return new Function(...Object.keys(deps),transformSync(`return ${text}`,{loader:'ts'}).code)(...Object.values(deps)) as T}
async function fixture(run:(root:string)=>Promise<void>){const root=await realpath(await mkdtemp(join(tmpdir(),'xuanxiang-export-main-review83-')));try{await run(root)}finally{await rm(root,{recursive:true,force:true})}}

test('EXP83-05 actual trusted main guard rejects a same-origin child or stale frame even when sender id matches',()=>{
 const frame={url:'xaanink://app/'},contents={id:8,mainFrame:frame},guard=compile<(event:unknown)=>void>(declaration('trusted').replace(/^function trusted/,'function'),{window:{webContents:contents}})
 guard({sender:contents,senderFrame:frame})
 for(const event of [{sender:contents,senderFrame:{url:'xaanink://app/'}},{sender:{...contents},senderFrame:frame},{sender:contents,senderFrame:{url:'https://app/'}}])assert.throws(()=>guard(event),/不受信/)
})

test('EXP83-06 actual closeData must await a real post-rename file write before worker close',()=>fixture(async root=>{
 const entered=Promise.withResolvers<void>(),releaseIO=Promise.withResolvers<void>(),sourceRequest={id:randomUUID(),format:'md' as const,filename:'正文.md',bytes:new TextEncoder().encode('关闭期间的完整正文')},target=join(root,'正文.md'),events:string[]=[],gate=new BusinessGate()
 const exports=new FileExports({assertOwner:()=>{},chooseSave:async()=>target,guardTarget:async()=>{},beforeDirectorySync:async()=>{entered.resolve();await releaseIO.promise}})
 const saving=gate.run(()=>exports.save('8:session',sourceRequest));await entered.promise
 const close=compile<()=>Promise<void>>(closeData,{window:{webContents:{id:8}},recoveryExports:{cancelWindow(){},flush:async()=>{}},fileExports:exports,configurationFiles:{cancelWindow(){},flush:async()=>{}},modelConfiguration:{cancelOwner(){}},avatarAssets:{cancelOwner(){}},businessGate:gate,conversationDirectories:{revokeAll(){},flush:async()=>{}},responseOwners:new Map(),repository:{read:async()=>{}},service:{call:async(name:string)=>events.push(name)},businessClosed:false,draftJournal:{read:async()=>null},applicationMetadata:new ApplicationMetadataGate(),migrationHandoff:null})
 const closing=close()
 try{await new Promise(setImmediate);assert.equal(gate.closed,true);assert.deepEqual(events,[]);assert.equal(await readFile(target,'utf8'),'关闭期间的完整正文');releaseIO.resolve();const result=await saving;await closing;assert.equal(result.status,'failed');if(result.status==='failed')assert.equal(result.code,'EXPORT_DURABILITY_UNCONFIRMED');assert.deepEqual(events,['close'])}
 finally{releaseIO.resolve();await saving;await closing;await exports.flush()}
}))

test('EXP83-07 actual releaseOwner cancels only the window prefix, including physical pending work',()=>fixture(async root=>{
 const gate=Promise.withResolvers<string|null>(),entered=Promise.withResolvers<void>();let choices=0
 const exports=new FileExports({assertOwner:()=>{},chooseSave:async()=>{if(++choices===2)entered.resolve();return gate.promise},guardTarget:async()=>{}}),request=()=>({id:randomUUID(),format:'md' as const,filename:'正文.md',bytes:new TextEncoder().encode('正文')})
 const eight=exports.save('8:old-session',request()),eighty=exports.save('80:other-session',request());await entered.promise
 const dispose=compile<()=>void>(release,{ownerId:8,conversationDirectories:{revokeOwner(){}},closeChannel:{cancel(){}},recoveryExports:{cancelWindow(){},flush:async()=>{}},fileExports:exports,configurationFiles:{cancelWindow(){}},draftSession:null,workLease:null,authority:{revokeOwner(){}},modelConfiguration:{cancelOwner(){}},avatarAssets:{cancelOwner(){}},responseOwners:new Map()})
 try{dispose();assert.equal((await eight).status,'cancelled');let otherFinished=false;void eighty.then(()=>{otherFinished=true});await new Promise(setImmediate);assert.equal(otherFinished,false);gate.resolve(join(root,'正文.md'));assert.equal((await eighty).status,'saved');assert.equal(await readFile(join(root,'正文.md'),'utf8'),'正文')}
 finally{gate.resolve(null);await Promise.all([eight,eighty]);await exports.flush()}
}))
