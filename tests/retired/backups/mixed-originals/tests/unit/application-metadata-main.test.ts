import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
import {transformSync} from 'esbuild'
import {z} from 'zod'
import {ApplicationMetadataGate} from '../../desktop/main/application-metadata-gate'
import {withApplicationMetadataSnapshot} from '../../desktop/service/application-metadata-capture'
const main=ts.createSourceFile('main.ts',readFileSync('desktop/main/index.ts','utf8'),ts.ScriptTarget.Latest,true)
const find=(source:ts.SourceFile,predicate:(node:ts.Node)=>boolean)=>{const results:ts.Node[]=[];const walk=(node:ts.Node)=>{if(predicate(node))results.push(node);ts.forEachChild(node,walk)};walk(source);assert.equal(results.length,1);return results[0]}
const evaluate=(code:string,deps:Record<string,unknown>)=>new Function(...Object.keys(deps),transformSync(`return (${code})`,{loader:'ts'}).code)(...Object.values(deps))
test('actual main reverse RPC validates every capture request and exact lease, before unrelated model dispatch',async()=>{
 const gate=new ApplicationMetadataGate(),node=find(main,n=>ts.isNewExpression(n)&&n.expression.getText(main)==='RpcPeer') as ts.NewExpression,dispatch=evaluate(node.arguments![1].getText(main),{z,applicationMetadata:gate,modelService:undefined})
 for(const value of [{},null,'token'])await assert.rejects(dispatch('application.capture.acquire',value))
 const id=await dispatch('application.capture.acquire');let saved=false;const waiting=gate.write(async()=>{saved=true});await new Promise(resolve=>setImmediate(resolve));assert.equal(saved,false)
 await assert.rejects(dispatch('application.capture.release',{id}));await assert.rejects(dispatch('application.capture.release','df53d3ea-1437-440a-b21c-60c134347e39'));assert.equal(saved,false)
 assert.equal(await dispatch('application.capture.release',id),true);await waiting;assert.equal(saved,true)
})
test('actual main writer options reach state, draft, and global avatar constructors, and disconnect revokes waiting capture',async()=>{
 const gate=new ApplicationMetadataGate(),declaration=find(main,n=>ts.isVariableDeclaration(n)&&n.name.getText(main)==='metadataWrites') as ts.VariableDeclaration,metadataWrites=evaluate(declaration.initializer!.getText(main),{applicationMetadata:gate})
 const collected:unknown[]=[]
 class ModelRepository{constructor(_path:unknown,_storage:unknown,_gateway:unknown,options:unknown){collected.push(options)}}
 class AvatarAssetService{constructor(options:{withWrite:unknown}){collected.push({withWrite:options.withWrite})}}
 class DraftJournal{constructor(_path:unknown,options:unknown){collected.push(options)}}
 const deps={ModelRepository,AvatarAssetService,DraftJournal,join:()=>'/fixture',dataRoot:'/fixture',safeStorage:{},gateway:{},metadataWrites}
 for(const name of ['ModelRepository','AvatarAssetService','DraftJournal'])evaluate(find(main,n=>ts.isNewExpression(n)&&n.expression.getText(main)===name).getText(main),deps)
 assert.deepEqual(collected,[metadataWrites,metadataWrites,metadataWrites])
 const id=await gate.acquire();let written=false;const pending=metadataWrites.withWrite(async()=>{written=true});await new Promise(resolve=>setImmediate(resolve));assert.equal(written,false)
 const disconnected=find(main,n=>ts.isVariableDeclaration(n)&&n.name.getText(main)==='disconnected') as ts.VariableDeclaration
 evaluate(disconnected.initializer!.getText(main),{applicationMetadata:gate,conversationDirectories:{revokeAll(){}},service:{dispose(){}},modelService:undefined,send(){},responseOwners:new Map()})();await pending;assert.equal(written,true);assert.throws(()=>gate.release(id))
})
test('actual worker passes the metadata snapshot transport into Workspaces without adding a renderer operation',async()=>{
 const source=ts.createSourceFile('worker.ts',readFileSync('desktop/service/index.ts','utf8'),ts.ScriptTarget.Latest,true),node=find(source,n=>ts.isNewExpression(n)&&n.expression.getText(source)==='Workspaces');let options:{withMetadataSnapshot:<T>(run:()=>Promise<T>)=>Promise<T>}|undefined
 class Workspaces{constructor(_root:unknown,_migrations:unknown,value:typeof options){options=value}}
 const gate=new ApplicationMetadataGate(),calls:string[]=[],peer={call:async<T>(method:string,value?:unknown)=>{calls.push(method);if(method.endsWith('acquire'))return await gate.acquire() as T;gate.release(String(value));return true as T}}
 evaluate(node.getText(source),{Workspaces,root:'/fixture',workerData:{migrations:'/fixture'},withApplicationMetadataSnapshot,main:peer});assert.ok(options);assert.equal(await options.withMetadataSnapshot(async()=>19),19);assert.deepEqual(calls,['application.capture.acquire','application.capture.release'])
 const preload=readFileSync('desktop/preload/index.ts','utf8');assert.equal(preload.includes('application.capture.'),false)
})
