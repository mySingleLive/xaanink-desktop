import type {RecoveryItem} from './draft-recovery'
import {draftSnapshotSchema} from '@desktop/shared/drafts'
const labels:Record<string,string>={title:'标题',name:'名称',content:'正文',outline:'大纲',summary:'摘要',description:'描述',prompt:'图像提示词',backstory:'背景',entryMethod:'进入方式',coordinates:'位置',exteriorDescription:'外部描述',interiorDescription:'内部描述',text:'正文',synopsis:'简介',sellingPoints:'卖点',referenceCases:'参考案例',targetAudience:'目标读者',age:'年龄',gender:'性别',occupation:'职业',bio:'人物小传',personality:'性格',height:'身高',weight:'体重',build:'体型',faceShape:'脸型',appearance:'外观',clothing:'衣着',tastes:'喜好',habits:'习惯',catchphrase:'口头禅',dialogueStyle:'说话风格',sampleDialogue:'对话示例',desires:'渴望',fears:'恐惧',abilities:'能力',background:'背景',growthArc:'成长弧线',acquisition:'获取方式',rules:'规则',condition:'进阶条件',term:'概念',explanation:'说明',trigger:'触发条件',ability:'能力',limitation:'限制',style:'文风',relations:'关系'}
const object=(value:unknown):Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{}
const values=(value:unknown)=>Object.values(object(value))
const rows=(value:unknown)=>Array.isArray(value)?value:[]
/** A read-only, human-readable projection. Full recovery records stay unchanged
 * and remain available in the explicit recovery export. No request is replayed. */
export function recoveryPreview(item:RecoveryItem):{text:string;meaningful:boolean;empty:boolean;truncated:boolean}{
 const blocks:string[]=[],seen=new Set<string>();let used=0,truncated=false,empty=false
 const add=(title:string,value:unknown)=>{
  if(typeof value!=='string'||!value.trim())return
  const key=title?`${title}\n${value}`:value;if(seen.has(key))return
  seen.add(key)
  const left=100000-used-(blocks.length?2:0);if(left<=0){truncated=true;return}
  const excerpt=key.slice(0,left);if(excerpt.length<key.length)truncated=true
  used+=excerpt.length+(blocks.length?2:0);blocks.push(excerpt)
 }
 const fields=(value:unknown,title='')=>{
  if(typeof value==='string'){add(title,value);return}
  const visited=new WeakSet<object>(),queue=[value]
  for(let index=0;index<queue.length;index++){
   const data=object(queue[index]);if(visited.has(data))continue;visited.add(data)
   for(const [key,label] of Object.entries(labels))add(title?`${title} · ${label}`:label,data[key])
   // Only original domain content containers are traversed, never request,
   // operation, image jobs, pending execution or arbitrary object properties.
   if(data.content&&typeof data.content==='object')queue.push(data.content)
   for(const key of ['effects','levels','pathways','children','concepts','factions','abilities'])for(const child of rows(data[key])){if(typeof child==='string')add(title,child);else if(child&&typeof child==='object')queue.push(child)}
  }
 }
 const applications=new WeakSet<object>();let projected=0
 const project=(source:string,path:string,input:unknown,depth=0)=>{
 if(depth>64||++projected>200000){truncated=true;return}
 let raw=input
 if((source==='chat'||source==='comments')&&path==='owned-cache'&&typeof raw==='string'&&raw.length<=4*1024*1024){try{raw=JSON.parse(raw)}catch{/* Keep unreadable cache only in the complete export. */}}
 const data=object(raw)
 if(typeof raw==='string'&&path!=='owned-cache')add('',raw)
 if(source==='application'){
  if(applications.has(data))return
  applications.add(data)
  const snapshot=draftSnapshotSchema.safeParse(data)
  if(!snapshot.success)return
  for(const row of snapshot.data.autosaves)project('autosaves',row.id,row.draft,depth+1)
  for(const key of ['staged','scene','chat','workspace','comments'] as const)if(snapshot.data.sources[key]!==undefined)project(key,'source',snapshot.data.sources[key],depth+1)
  const recovery=object(snapshot.data.sources.recovery)
  if(recovery.version===1)for(const row of rows(recovery.items)){const old=object(row);if(typeof old.source==='string'&&typeof old.path==='string')project(old.source,old.path,old.value,depth+1)}
 }else if(source==='autosaves'){
  const attempts=[data.pending,data.failed,data.inFlight,data.latest].filter(value=>value!==null&&value!==undefined)
  if(depth===0)empty=['idle','saved'].includes(String(data.status))&&['pending','failed','inFlight','latest'].every(key=>data[key]===null)&&Object.keys(data).every(key=>['revision','status','paused','pending','failed','inFlight','latest'].includes(key))
  if(typeof data.draft==='string')add('',data.draft)
  for(const attempt of attempts)fields(object(attempt).value)
 }else if(source==='staged'){
  const batches=Array.isArray(data.changes)?[data]:values(data.batches)
  for(const batch of batches){const row=object(batch),title=typeof row.label==='string'?row.label:'';for(const change of rows(row.changes))fields(object(object(change).request).body,title)}
 }else if(source==='chat'){
  const entries=[data,data.active,...values(object(data.saved).drafts),...values(data.drafts)]
  for(const entry of entries){const row=object(entry);add('对话草稿',row.draft);for(const [index,queued] of rows(row.queuedMessages).entries())add(`待发送内容 ${index+1}`,object(queued).text)}
 }else if(source==='scene'){
  if(data.value)fields(data.value);else fields(data)
  for(const draft of values(data.drafts))fields(object(draft).value)
  for(const draft of values(data.imageDrafts))fields(draft)
 }else if(source==='comments'){
  const comments=[data,...rows(raw),...rows(data.rows),...rows(data.drafts)]
  for(const comment of comments){const row=object(comment);add('引用原文',object(row.anchor).quote);add('评论草稿',row.content)}
 }else if(source==='workspace'){
  if(path.startsWith('tab:'))add('已打开的标签页',data.title)
  for(const tab of rows(data.tabs))add('已打开的标签页',object(tab).title)
 }
 }
 project(item.source,item.path,item.value)
 const meaningful=blocks.length>0
 return{text:meaningful?blocks.join('\n\n').slice(0,100000):'这条记录的完整内容已保留，可通过导出恢复草稿查看。',meaningful,empty:empty&&!meaningful,truncated}
}
