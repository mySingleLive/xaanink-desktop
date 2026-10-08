import {app,BrowserWindow,dialog,Menu} from 'electron'
import {prepareSessionDirectory} from './session-directory'
import {prepareInboxLeaseRecovery,type InboxLeaseRecoverySession} from './inbox-lease-recovery'

/** Native cold mode. Never starts the ordinary worker, model vault or renderer. */
export async function launchInboxLeaseRecovery(bootstrap:string,assertNoOrdinaryHost:()=>void){
 const profile=prepareSessionDirectory(bootstrap)
 app.setPath('sessionData',profile)
 let busy=true,exiting=false,prepared:InboxLeaseRecoverySession|undefined
 const assertColdHost=()=>{
  if(exiting||!app.hasSingleInstanceLock()||app.getPath('sessionData')!==profile||BrowserWindow.getAllWindows().length)throw Error('INBOX_HOST_NOT_COLD')
  assertNoOrdinaryHost()
 }
 const exit=(code:number)=>{exiting=true;prepared?.cancel();app.exit(code)}
 app.on('before-quit',event=>{if(busy)event.preventDefault();else exiting=true})
 await app.whenReady()
 if(process.platform==='darwin')Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'玄印',submenu:[{label:'退出玄印',click:()=>{if(!busy)exit(0)}}]},...['文件','编辑','视图','窗口','帮助'].map(label=>({label,submenu:[]}))]))
 try{
  prepared=await prepareInboxLeaseRecovery(bootstrap,{assertColdHost})
  busy=false
  const answer=await dialog.showMessageBox({type:'warning',title:'修复本地写入锁',message:'上次应用未正常关闭',detail:'本地收件箱仍保留已结束进程的写入锁。修复只处理这把锁，不更改作品、设置和草稿。\n\n目录：'+prepared.preview.work.path,buttons:['退出','修复并退出'],defaultId:0,cancelId:0,noLink:true})
  if(answer.response!==1){prepared.cancel();exit(0);return}
  assertColdHost();busy=true
  const result=await prepared.recover(true)
  if(result.status==='recovered')prepared.assertRecovered()
  busy=false
  await dialog.showMessageBox({type:result.status==='recovered'?'info':'warning',title:'本地写入锁',message:result.status==='recovered'?'写入锁已修复':'写入锁仍有待处理步骤',detail:result.status==='recovered'?'请重新打开玄印写作继续创作。':'原数据和修复记录已保留，请重新打开应用继续处理。',buttons:['退出'],defaultId:0,cancelId:0,noLink:true})
  if(result.status==='recovered')prepared.assertRecovered()
  exit(result.status==='recovered'?0:1)
 }catch{
  busy=false
  if(exiting)return
  await dialog.showMessageBox({type:'error',title:'无法安全修复写入锁',message:'本地写入锁未能安全处理',detail:'原文件已保留。可能有应用仍在运行，或目录、锁记录已发生变化。请通过项目问题反馈寻求处理。',buttons:['退出'],defaultId:0,cancelId:0,noLink:true})
  exit(1)
 }
}
