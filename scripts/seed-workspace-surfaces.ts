// Synthetic preconditions in an explicitly supplied fresh test directory.
import assert from 'node:assert/strict'
import { mkdir, realpath, stat, writeFile } from 'node:fs/promises'
import { join, resolve, basename } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { Workspaces } from '../desktop/service/workspaces'
import { prisma } from '../src/lib/db'
import { DraftJournal } from '../desktop/main/draft-journal'
import { workspaceTabSchema } from '../src/lib/desktop/workspace-draft-source'
import { pendingQuestionSchema } from '../src/lib/chat-protocol'

async function main() {
const directory=await realpath(resolve(process.argv[2]))
assert(basename(directory).startsWith('xaanink-surfaces-'),'Isolated test directory required')
const root=join(directory,'data'),path=join(directory,'work')
await mkdir(path,{recursive:true})
const info=await stat(path,{bigint:true}),works=new Workspaces(root,resolve('prisma/migrations'))
const hash=(value:string)=>createHash('sha256').update(value).digest('hex')
try {
  await works.initialize()
  const work=await works.create({path,device:String(info.dev),inode:String(info.ino)},{title:'分栏验证作品',requestId:randomUUID()})
  const ids=await works.run(work.id,async()=>{
    const novelId=work.novelId
    const volume=await prisma.volume.create({data:{novelId,title:'验证卷',index:1,summary:''}})
    const content='# 正文验证\n\n第一段正文，用于测试布局与编辑。\n\n---\n\n第二段正文。'
    const chapter=await prisma.chapter.create({data:{volumeId:volume.id,index:1,title:'验证章',outline:'验证章纲',content,status:'WRITTEN'}})
    const scene=await prisma.scene.create({data:{novelId,name:'验证场景',description:'独立目录中的合成地点。'}})
    const scenario=await prisma.scenarioLab.create({data:{novelId,title:'验证试验场',premise:'独立测试开场。'}})
    const candidate=await prisma.contentCandidate.create({data:{novelId,userId:'local-author',chapterId:chapter.id,operationId:randomUUID(),baseVersion:chapter.version,baseHash:hash(content),baseContent:content,content:'# 候选正文\n\n独立候选稿。',contentHash:hash('# 候选正文\n\n独立候选稿。'),source:'writer',status:'ready',checks:[]}})
    const conversation=await prisma.conversation.create({data:{novelId,userId:'local-author',title:'分栏验证会话'}})
    const turnId=randomUUID(),attemptId=randomUUID(),userMessageId=randomUUID(),assistantMessageId=randomUUID()
    await prisma.message.createMany({data:[{id:userMessageId,conversationId:conversation.id,turnId,role:'USER',content:'独立界面验证消息。'},{id:assistantMessageId,conversationId:conversation.id,turnId,attemptId,role:'ASSISTANT',content:'请选择下一项任务。',parts:[{type:'text',text:'请选择下一项任务。'}]}]})
    const payload=pendingQuestionSchema.parse({questions:[{question:'下一步',options:['选择任务']}],storyNavigation:{schemaVersion:2,accepted:true,title:'界面测试前置',score:null,threshold:80,targets:[{key:'theme:'+novelId,hash:'test-precondition',version:1}],choices:[],shortcuts:[],entities:[]}})
    await prisma.chatTurn.create({data:{id:turnId,userId:'local-author',conversationId:conversation.id,userMessageId,clientRequestId:randomUUID(),status:'waiting_user',latestAttemptId:attemptId,interaction:{kind:'question',id:randomUUID(),revision:1,payload,state:'pending'}}})
    await prisma.chatAttempt.create({data:{id:attemptId,turnId,attemptNo:1,assistantMessageId,executionEpoch:0,status:'waiting_user',stage:'waiting_user',endedAt:new Date()}})
    return {novelId,chapterId:chapter.id,sceneId:scene.id,scenarioId:scenario.id,candidateId:candidate.id,conversationId:conversation.id}
  })
  const tabs=[
    {id:'novel:'+ids.novelId,type:'novel',novelId:ids.novelId,title:'普通内容验证'},
    {id:'worldline:'+ids.novelId,type:'worldline',novelId:ids.novelId,title:'规划验证'},
    {id:'scene:'+ids.sceneId,type:'scene',novelId:ids.novelId,refId:ids.sceneId,title:'场景验证'},
    {id:'scenario:'+ids.scenarioId,type:'scenario',novelId:ids.novelId,refId:ids.scenarioId,title:'试验场验证'},
    {id:'chapter-candidate:'+ids.candidateId,type:'chapter-candidate',novelId:ids.novelId,refId:ids.candidateId,chapterId:ids.chapterId,title:'候选稿验证'},
    {id:'chapter-content:'+ids.chapterId,type:'chapter-content',novelId:ids.novelId,refId:ids.chapterId,title:'正文验证'},
  ].map(tab=>workspaceTabSchema.parse(tab))
  const active={draftId:randomUUID(),conversationId:ids.conversationId,novelId:ids.novelId,draft:'',pendingNovelTitle:null,novelCreationRequestId:null,modelChoice:{modelId:null,effort:null},queuedMessages:[],wasRunning:false,awaitingQuestion:true}
  const journal=new DraftJournal(root),release=journal.activate('surface-fixture')
  try { await journal.persist('surface-fixture',{version:1,revision:1,createdAt:new Date().toISOString(),autosaves:[],issues:[],sources:{workspace:{version:1,tabs,activeTabId:tabs[0].id,subTabs:{},layout:{version:1,narrowPane:'chat',contentVisible:true,sidebarVisible:true,chatVisible:true,sizes:{sidebar:25,chat:35,content:40},lastContentSize:40,lastSidebarSize:25,lastChatSize:35}},chat:{accountId:'local-author',active,saved:null}}}) }finally{release()}
  await writeFile(join(directory,'fixture.json'),JSON.stringify(ids,null,2)+'\n')
  console.log('Isolated surface fixture prepared with six real panel records and one waiting conversation; zero models.')
} finally {await works.close()}
}
void main().catch(error=>{console.error(error);process.exitCode=1})
