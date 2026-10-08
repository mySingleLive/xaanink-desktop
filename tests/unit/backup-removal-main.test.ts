import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
import {transformSync} from 'esbuild'
import {BusinessGate} from '../../desktop/main/business-gate'
const removed=['desktop:work-backup','desktop:application-backups','desktop:work-restore','desktop:application-restore','desktop:restore-draft-ack','desktop:application-draft-confirm']
function registered(){
 const source=ts.createSourceFile('index.ts',readFileSync('desktop/main/index.ts','utf8'),ts.ScriptTarget.Latest,true)
 const functions=['businessHandle','registerIpc'].map(name=>source.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name)!.getText(source)).join('\n')
 const handlers=new Map<string,Function>()
 new Function('ipcMain','businessGate',transformSync(functions,{loader:'ts'}).code+'\nregisterIpc()')({handle:(name:string,handler:Function)=>handlers.set(name,handler)},new BusinessGate())
 return handlers
}
test('ordinary main does not register any backup or restore capability',()=>{
 const handlers=registered()
 for(const channel of removed)assert.equal(handlers.has(channel),false,channel)
 for(const channel of ['desktop:bootstrap','desktop:request','desktop:settings','desktop:migrate-root','desktop:work-lease','desktop:draft-persist','desktop:draft-read','desktop:draft-export','desktop:draft-ready','desktop:close-reply','desktop:clipboard-write'])assert.equal(handlers.has(channel),true,channel)
})
test('actual preload exposes normal draft/migration APIs without backup capabilities',()=>{
 let exposed:Record<string,unknown>|undefined;const calls:string[]=[]
 const stub={contextBridge:{exposeInMainWorld:(_name:string,bridge:Record<string,unknown>)=>{exposed=bridge}},ipcRenderer:{on(){},invoke:(channel:string)=>{calls.push(channel);return Promise.resolve()},removeListener(){}}}
 new Function('require',transformSync(readFileSync('desktop/preload/index.ts','utf8'),{loader:'ts',format:'cjs'}).code)((name:string)=>{assert.equal(name,'electron');return stub})
 assert.ok(exposed)
 for(const name of ['workBackup','applicationBackups','restoreWork','restoreApplication','acknowledgeWorkRestore','confirmApplicationRestoreDraft'])assert.equal(name in exposed,false,name)
 for(const name of ['persistDraft','readDraft','exportDraft','migrateRoot','repairWorkLease'])assert.equal(typeof exposed[name],'function',name)
})
