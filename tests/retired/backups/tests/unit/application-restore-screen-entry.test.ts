import assert from 'node:assert/strict'
import {test} from 'node:test'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {ApplicationRestoreView} from '../../src/components/desktop/ApplicationRestoreScreen'
import type {ApplicationRestoreEntryState} from '../../desktop/shared/application-restore-entry'
const state:ApplicationRestoreEntryState={version:1,revision:1,theme:'paper',platform:'win32',phase:'inspection',operationId:null,sourcePath:'/original/<never execute>',targetPath:null,backup:null,notice:'inspection-required',canChooseBackup:false,canChooseParent:false,canContinue:false,canCancel:false,canRestart:true,canLocate:false}
test('ENTRY36-U01 unknown inspection renders fixed inspect/restart/quit commands and inert escaped paths',{timeout:15000},()=>{
 const html=renderToStaticMarkup(createElement(ApplicationRestoreView,{state,error:null,pending:[],available:true,command(){}}))
 for(const value of['data-restore-command="inspect"','data-restore-command="restart"','data-restore-command="quit"','&lt;never execute&gt;'])assert.ok(html.includes(value),value)
 for(const value of['data-restore-command="continue"','data-restore-command="choose-backup"','data-restore-command="choose-parent"','data-restore-command="locate"','<input','iframe'])assert.equal(html.includes(value),false,value)
})
test('ENTRY36-U02 prepared and running views expose only actual main capability flags; cancel/quit stay usable while continue awaits',{timeout:15000},()=>{
 const prepared={...state,phase:'prepared' as const,notice:'ready' as const,operationId:'77e3a180-e8a1-40a9-a3d2-8b9a7d2bfe89',canContinue:true,canCancel:true,canRestart:false},html=renderToStaticMarkup(createElement(ApplicationRestoreView,{state:prepared,error:null,pending:['continue'],available:true,command(){}}))
 const button=(command:string)=>html.match(new RegExp(`<button[^>]*data-restore-command="${command}"[^>]*>`))![0]
 assert.match(button('continue'),/\sdisabled=/)
 assert.doesNotMatch(button('cancel'),/\sdisabled=/)
 assert.doesNotMatch(button('quit'),/\sdisabled=/)
 assert.equal(html.includes('旧进程'),true)
})
