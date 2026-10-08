import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFileSync} from 'node:fs'
import {randomUUID} from 'node:crypto'
import {join} from 'node:path'
import ts from 'typescript'
import {transformSync} from 'esbuild'
import {BusinessGate} from '../../desktop/main/business-gate'
import {desktopMenu,electronAccelerator} from '../../desktop/shared/command-registry'
import {localImageRequest} from '../../desktop/shared/local-images'
import commands from '../../desktop/shared/commands.json'

const source=ts.createSourceFile('main.ts',readFileSync('desktop/main/index.ts','utf8'),ts.ScriptTarget.Latest,true)
const declaration=(name:string)=>{const row=source.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name);assert.ok(row);return row.getText(source)}
const evaluate=(code:string,deps:Record<string,unknown>)=>new Function(...Object.keys(deps),transformSync(code,{loader:'ts'}).code)(...Object.values(deps))

// Actual main registrations/route bodies, controlled Electron transport. These
// cases prove refusal before ordinary callbacks; no native app or PG runs.
test('AR107-R01 every actual registered ordinary business IPC refuses before owner/schema/service work during application protection',async()=>{
 const handlers=new Map<string,(...args:unknown[])=>Promise<unknown>>(),channels:string[]=[],gate=new BusinessGate()
 const ipcMain={handle(channel:string,handler:(...args:unknown[])=>Promise<unknown>){assert.equal(handlers.has(channel),false);handlers.set(channel,handler)}}
 const body=`${declaration('businessHandle')};${declaration('registerIpc')};registerIpc()`
 evaluate(body,{ipcMain,businessGate:gate,applicationBlocked:()=>true})
 const visit=(node:ts.Node)=>{if(ts.isCallExpression(node)&&node.expression.getText(source)==='businessHandle')channels.push(JSON.parse(node.arguments[0].getText(source)));ts.forEachChild(node,visit)};visit(source)
 assert.ok(channels.includes('desktop:settings'));assert.ok(channels.includes('desktop:model-test'));assert.ok(channels.includes('desktop:request'));assert.ok(channels.includes('desktop:application-backups'))
 for(const channel of channels.filter(channel=>channel!=='desktop:bootstrap'))await assert.rejects(handlers.get(channel)!({}),/APPLICATION_RESTORE_PROTECTED/,channel)
 assert.equal(new Set(channels).size,channels.length);assert.equal(gate.closed,false)
})

test('AR107-R02 protected avatar and work/scene image routes refuse before asset reads or ordinary service calls',async()=>{
 let callback='';const visit=(node:ts.Node)=>{if(ts.isCallExpression(node)&&node.expression.getText(source)==='protocol.handle')callback=node.arguments[1].getText(source);ts.forEachChild(node,visit)};visit(source);assert.ok(callback)
 let reads=0;const forbidden=()=>{reads++;throw Error('forbidden ordinary asset read')}
 const handler=evaluate(`return (${callback})`,{applicationBlocked:()=>true,localImageRequest,avatarAssets:{readAsset:forbidden},service:{call:forbidden},businessGate:{run:forbidden},join,app:{getAppPath:()=>'/controlled'},staticUiResponse:()=>new Response('controlled-static-ui')}) as (request:Request)=>Promise<Response>
 const id=randomUUID()
 for(const url of [`xaanink://asset/global/${id}`,`xaanink://app/_desktop/assets/${id}/${id}.png`,`xaanink://app/api/novels/inbox/scenes/fixture/images/${id}/asset`]){
  assert.equal((await handler(new Request(url))).status,403)
  assert.equal((await handler(new Request(url,{method:'HEAD'}))).status,403)
 }
 assert.equal(reads,0)
 assert.equal(await (await handler(new Request('xaanink://app/'))).text(),'controlled-static-ui')
})

for(const platform of ['darwin','win32']as const)test(`AR107-R03 protected ${platform} native menu keeps safe window commands and cannot admit ordinary menu actions`,async()=>{
 const sent:string[]=[],popup:unknown[]=[],window={};let forbidden=0
 const body=`${declaration('applicationCommandAllowed')};${declaration('menuTemplate')};${declaration('executeCommand')};return{menu:menuTemplate,run:executeCommand}`
 const host=evaluate(body,{applicationBlocked:()=>true,closingFlow:null,businessGate:{closed:false,run(){forbidden++;throw Error('forbidden business admission')}},process:{platform},menuShortcuts:{},desktopMenu,electronAccelerator,commands,window,Menu:{buildFromTemplate:(items:unknown)=>({popup:()=>popup.push(items)})},send:(value:{id:string})=>sent.push(value.id),dialog:{showErrorBox(){throw Error('unexpected native error')}},app:{}}) as {menu():{id:string;label:string;submenu:{id:string;enabled:boolean}[]}[];run(id:string):Promise<void>}
 const menu=host.menu();assert.deepEqual(menu.map(group=>group.label),platform==='darwin'?['玄印','文件','编辑','视图','窗口','帮助']:['文件','编辑','视图','窗口','帮助'])
 const items=menu.flatMap(group=>group.submenu)
 for(const id of ['app.about','app.quit','window.minimize'])assert.equal(items.find(item=>item.id===id)?.enabled,true)
 for(const id of ['file.open','file.new','app.settings','text.copy'])assert.equal(items.find(item=>item.id===id)?.enabled,false)
 for(const id of ['file.open','file.new','app.settings','text.copy','ai.send'])await host.run(id)
 assert.deepEqual(sent,[]);assert.equal(forbidden,0)
 await host.run('app.menu');assert.equal(popup.length,1)
})
