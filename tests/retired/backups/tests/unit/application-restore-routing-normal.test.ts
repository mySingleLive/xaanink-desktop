import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
import {transformSync} from 'esbuild'

// Execute the actual first synchronous main branch. Read-only preflight and
// window launch are controlled, with no producer/request/native grant issued.
const source=ts.createSourceFile('main.ts',readFileSync('desktop/main/index.ts','utf8'),ts.ScriptTarget.Latest,true)
const branch=source.statements.find(node=>ts.isIfStatement(node)&&node.expression.getText(source).includes('requestSingleInstanceLock'))!
assert.ok(branch)
for(const state of [
 {label:'execute-ready',mode:'execute-ready',unknown:false,expected:'recovery'},
 {label:'unknown-layout',mode:'normal',unknown:true,expected:'recovery'},
 {label:'protected',mode:'protected',unknown:false,expected:'ordinary'},
 {label:'protected-with-unknown-layout',mode:'protected',unknown:true,expected:'recovery'},
]as const)test(`AR36-routing ${state.label} keeps actual startup priority before ordinary root maintenance`,async()=>{
 const trace:string[]=[],work=Promise.withResolvers<void>(),bootstrap={path:'/controlled/bootstrap'},fail=()=>{throw Error('must not route into root maintenance')}
 const dependencies={app:{requestSingleInstanceLock:()=>true,hasSingleInstanceLock:()=>true,quit:fail,exit:fail},bootstrapPath:bootstrap.path,isolatedRoot:undefined,
  applicationRestorePreflight:(path:string,locked:()=>void)=>{assert.equal(path,bootstrap.path);locked();trace.push('application-preflight');return{bootstrap,startup:{mode:state.mode}}},
  rootRelocationPreflight:(path:string)=>{assert.equal(path,bootstrap.path);trace.push('relocation-preflight');return{mode:'none'}},
  inspectApplicationRestoreLayouts:(identity:unknown)=>{assert.equal(identity,bootstrap);trace.push('layout-inspect');return{unknown:state.unknown,operationIds:[]}},
  launchApplicationRestoreWindow:(path:string,selected:unknown,options:{reason:string;onLocate?:unknown})=>{assert.equal(path,bootstrap.path);assert.equal(selected,undefined);assert.equal(options.reason,'handoff');assert.equal(options.onLocate,undefined);trace.push('recovery');return work.promise},
  launch:()=>{trace.push('ordinary');return work.promise},launchRootRelocation:fail,launchRootMaintenance:fail,rootMaintenanceRequired:fail,join:fail,homedir:fail,dialog:{showErrorBox:fail},
 }
 new Function(...Object.keys(dependencies),transformSync(branch.getText(source),{loader:'ts'}).code)(...Object.values(dependencies))
 assert.deepEqual(trace,['application-preflight','relocation-preflight','layout-inspect',state.expected])
 work.resolve();await new Promise(resolve=>setImmediate(resolve))
})
