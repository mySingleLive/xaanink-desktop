import {readFileSync} from 'node:fs'
import ts from 'typescript'
import {transformSync} from 'esbuild'
import {BusinessGate} from '../../desktop/main/business-gate'
import {ApplicationMetadataGate} from '../../desktop/main/application-metadata-gate'
import {ConversationDirectoryAuthorizations} from '../../desktop/main/conversation-directory-authorizations'
// Narrow main-IPC fixtures execute the real admission wrapper after its
// extraction, with a real gate. Native dependencies remain controlled by each
// test. This scaffolding is not an Electron lifecycle acceptance test.
const syntax=ts.createSourceFile('main.ts',readFileSync('desktop/main/index.ts','utf8'),ts.ScriptTarget.Latest,true)
const node=syntax.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='businessHandle')
if(!node)throw Error('main businessHandle not found')
const code=transformSync(node.getText(syntax),{loader:'ts'}).code
export function mainFunction(...arguments_:string[]){
 const body=arguments_.pop()!
 const normalDefaults=[['applicationBlocked','()=>false'],['applicationHandoff','null'],['ordinaryWorkerExited','false'],['sessionFlushed','false'],['applicationRequests','null'],['workLease','null'],['recoveryExports','{cancelWindow(){},flush:async()=>{}}'],['fileExports','{cancelWindow(){},flush:async()=>{}}'],['draftJournal','{read:async()=>null}'],['applicationMetadata','new ApplicationMetadataGate()'],['conversationDirectories',"new ConversationDirectoryAuthorizations({choose:async()=>{throw Error('no normal-fixture native authority')},revoke(){}})"]]
 const normal=normalDefaults.filter(([name])=>!arguments_.includes(name)).map(([name,value])=>`let ${name}=${value};`).join('')
 const compiled=new Function(...arguments_,'BusinessGate','ApplicationMetadataGate','ConversationDirectoryAuthorizations',`const businessGate=new BusinessGate();let businessClosed=false;${normal}${code}\n${body}`)
 return(...values:unknown[])=>compiled(...values,BusinessGate,ApplicationMetadataGate,ConversationDirectoryAuthorizations)
}
