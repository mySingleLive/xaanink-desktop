import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
import {transformSync} from 'esbuild'
import {z} from 'zod'
import {ApplicationMetadataGate} from '../../desktop/main/application-metadata-gate'
const main=ts.createSourceFile('main.ts',readFileSync('desktop/main/index.ts','utf8'),ts.ScriptTarget.Latest,true)
const find=(source:ts.SourceFile,predicate:(node:ts.Node)=>boolean)=>{const results:ts.Node[]=[];const walk=(node:ts.Node)=>{if(predicate(node))results.push(node);ts.forEachChild(node,walk)};walk(source);assert.equal(results.length,1);return results[0]}
const evaluate=(code:string,deps:Record<string,unknown>)=>new Function(...Object.keys(deps),transformSync(`return (${code})`,{loader:'ts'}).code)(...Object.values(deps))
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
