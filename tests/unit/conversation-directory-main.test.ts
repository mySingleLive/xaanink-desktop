import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {mkdtemp,realpath,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import ts from 'typescript'
import {transformSync} from 'esbuild'
import {DirectoryAuthority} from '../../desktop/main/directory-authority'

function chooser(globals:Record<string,unknown>){
 const source=ts.createSourceFile('main.ts',readFileSync('desktop/main/index.ts','utf8'),ts.ScriptTarget.Latest,true)
 const declaration=source.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='chooseConversationDirectory')
 assert.ok(declaration,'the actual main directory helper must exist')
 return new Function(...Object.keys(globals),transformSync(declaration.getText(source),{loader:'ts'}).code+'\nreturn chooseConversationDirectory')(...Object.values(globals)) as (input:{title:string;requestId:string},guard:()=>void,owner:string)=>Promise<unknown>
}
function base(){let alive=true;const guard=()=>{if(!alive)throw Error('expired')};return{guard,expire:()=>{alive=false}}}
const input={title:'作者的新作品',requestId:'operation-one'}
test('main rechecks the exact task after settings IO before showing a native picker',async()=>{
 const f=base(),read=Promise.withResolvers<unknown>();let dialogs=0
 const choose=chooser({window:{id:1},repository:{read:()=>read.promise},dialog:{showOpenDialog:async()=>{dialogs++;return{canceled:true,filePaths:[]}}},authority:new DirectoryAuthority(),homedir:()=>'/isolated/home'})
 const result=choose(input,f.guard,'private-capability');f.expire();read.resolve({settings:{general:{defaultParent:''}}})
 await assert.rejects(result,/expired/);assert.equal(dialogs,0)
})
test('main does not turn a late native picker answer into a directory capability',async()=>{
 const f=base(),picked=Promise.withResolvers<unknown>();let issue=0
 const choose=chooser({window:{id:1},repository:{read:async()=>({settings:{general:{defaultParent:''}}})},dialog:{showOpenDialog:()=>picked.promise},authority:{issue:async()=>{issue++},revokeOwner(){}},homedir:()=>'/isolated/home'})
 const result=choose(input,f.guard,'private-capability');await new Promise(setImmediate);f.expire();picked.resolve({canceled:false,filePaths:['/forged/late']})
 await assert.rejects(result,/expired/);assert.equal(issue,0)
})
test('actual DirectoryAuthority receives only a single native directory and cancellation writes no grant',async()=>{
 const path=await realpath(await mkdtemp(join(tmpdir(),'xx-conversation-picker-'))),authority=new DirectoryAuthority(),nativeWindow={id:1};let cancelled=true
 try{
  const choose=chooser({window:nativeWindow,repository:{read:async()=>({settings:{general:{defaultParent:'/preferred'}}})},dialog:{showOpenDialog:async(window:unknown,options:any)=>{assert.equal(window,nativeWindow);assert.equal(options.defaultPath,'/preferred');assert.deepEqual(options.properties,['openDirectory','createDirectory']);return cancelled?{canceled:true,filePaths:[]}:{canceled:false,filePaths:[path]}}},authority,homedir:()=>'/isolated/home'})
  assert.equal(await choose(input,()=>{},'private-capability'),null);cancelled=false
  const proof=await choose(input,()=>{},'private-capability') as {path:string;device:string;inode:string}
  assert.equal(proof.path,path);assert.match(proof.device,/^\d+$/);assert.match(proof.inode,/^\d+$/)
 }finally{await rm(path,{recursive:true,force:true})}
})
test('task revocation during grant creation removes that exact grant before returning',async()=>{
 const path=await realpath(await mkdtemp(join(tmpdir(),'xx-conversation-grant-'))),authority=new DirectoryAuthority(),f=base();let grantId=''
 try{
  const choose=chooser({window:{id:1},repository:{read:async()=>({settings:{general:{defaultParent:''}}})},dialog:{showOpenDialog:async()=>({canceled:false,filePaths:[path]})},authority:{issue:async(...args:Parameters<DirectoryAuthority['issue']>)=>{const grant=await authority.issue(...args);grantId=grant.id;f.expire();return grant},consume:authority.consume.bind(authority),revokeOwner:authority.revokeOwner.bind(authority)},homedir:()=>'/isolated/home'})
  await assert.rejects(choose(input,f.guard,'private-capability'),/expired/)
  assert.ok(grantId);await assert.rejects(authority.consume(grantId,'create-work','private-capability'),/目录授权无效/)
 }finally{await rm(path,{recursive:true,force:true})}
})
