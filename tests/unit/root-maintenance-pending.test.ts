import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
import {transformSync} from 'esbuild'
import {validMaintenancePendingItem,maintenancePendingLabel} from '../../desktop/shared/root-maintenance'
const file=ts.createSourceFile('runner.ts',readFileSync('desktop/main/root-maintenance-runner.ts','utf8'),ts.ScriptTarget.Latest,true);let method=''
function walk(node:ts.Node){if(ts.isMethodDeclaration(node)&&node.name.getText(file)==='showCompletion')method=node.getText(file).replace('private async showCompletion','async function');ts.forEachChild(node,walk)}walk(file)
const source={root:{path:'/source'},revision:1},target={path:'/target'},root={root:target,revision:2},pending=['state.json','inbox/database/base/1/123','NEW_ROOT_CHANGED']
const completion={source,target,executionNonce:'migration',outcome:{status:'cleanup-pending',migrationId:'migration',root,pendingCount:pending.length}}
const record={source,target,migrationId:'migration',result:{status:'cleanup-pending',migrationId:'migration',root,pending}}
// This extracted-method fixture controls authority and closure seals. The review
// file separately exercises the real seal with durable journals and receipts.
async function run(input:unknown=record){
 const states:any[]=[],calls:string[]=[]
 const ctx={
  options:{bootstrap:'/bootstrap',defaultRoot:'/source',requests:{flush:async()=>{calls.push('flush')}}},
  guard:async()=>{calls.push('guard')},
  completionSeal:async(value:unknown,pointer:unknown)=>{assert.strictEqual(value,completion);assert.strictEqual(pointer,root);calls.push('seal');return{currentRootPath:null,assertCurrent(){calls.push('assertCurrent')}}},
  manager:(id:string)=>{assert.equal(id,completion.executionNonce);return{recordedMigration:async(nonce:string)=>{assert.equal(nonce,id);calls.push('record');return input}}},
  publish:(state:unknown)=>{calls.push('publish');states.push(state)},
 }
 const fn=new Function('DataRootManager','same','failure','validMaintenancePendingItem',transformSync(`return ${method}`,{loader:'ts'}).code)(class{constructor(bootstrap:string,defaultRoot:string){assert.equal(bootstrap,ctx.options.bootstrap);assert.equal(defaultRoot,ctx.options.defaultRoot)}async resolve(){calls.push('resolve');return{state:'existing',pointer:root}}},(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b),(code:string)=>{throw Error(code)},validMaintenancePendingItem)
 await fn.call(ctx,completion)
 assert.deepEqual(calls,['guard','flush','resolve','seal','guard','record','guard','assertCurrent','publish'],'The real method must validate authority before reading optional details and recheck its seal before publishing continue')
 assert.equal(states.length,1);return states[0]
}
test('actual runner exposes all exact leftovers only from the matching durable migration record',async()=>{const state=await run();assert.deepEqual(state.pendingItems,pending);assert.equal(state.pendingCount,3);assert.equal(state.canContinue,true);state.pendingItems.push('view mutation');assert.equal(record.result.pending.length,3)})
test('unavailable or unrelated journal details never masquerade as a complete empty list',async()=>{for(const wrong of [null,{...record,migrationId:'other'},{...record,source:{root:{path:'/foreign'}}},{...record,result:{...record.result,pending:['one']}},{...record,result:{...record.result,status:'rolled-back'}},{...record,result:{...record.result,pending:['state.json','inbox/database/base/1/123','unsafe\npath']}}]){const state=await run(wrong);assert.equal(state.pendingItems,null);assert.equal(state.pendingCount,3);assert.equal(state.canContinue,true)}})

test('pending paths are read-only safe relative labels, never absolute or traversal targets',()=>{for(const value of ['state.json','inbox/database/base/1/123','.xuanxiang-migration-id/state.json','目录/正文.json'])assert.equal(validMaintenancePendingItem(value),true);for(const value of ['',null,7,'/root/file','C:/root/file','../private','folder/../file','folder//file','folder/./file','line\nfile','back\\file','a'.repeat(4097)])assert.equal(validMaintenancePendingItem(value),false);assert.equal(maintenancePendingLabel('constructor'),'constructor');assert.equal(maintenancePendingLabel('NEW_ROOT_CHANGED'),'新目录已有后续修改，旧副本已保留。')})
