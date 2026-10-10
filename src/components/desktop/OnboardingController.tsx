"use client"
import {useEffect,useRef,useState} from 'react'
import {ArrowRight,Check,LoaderCircle,X} from 'lucide-react'
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog'
import {Button} from '@/components/ui/button'
import {ProfileEditorDialog} from './ProfileSettings'
import {ModelConfigurationDialog} from './ModelConfigurationDialog'
import {useDesktopStore,createDesktopOnboardingCommit} from '@/stores/desktop'
import {onboardingStartup,type OnboardingRoute} from '@/lib/desktop/onboarding-flow'
import type {OnboardingPayload} from '@desktop/shared/onboarding'
import type {ModelDraft} from '@desktop/main/model-repository'
import type {Settings} from '@desktop/core/settings'
import type {StateSnapshot} from '@desktop/shared/ipc'

type Body=OnboardingPayload extends infer P?P extends OnboardingPayload?Omit<P,'flow'|'operationId'>:never:never
const themes=[{id:'paper',name:'宣纸',caption:'温润明亮'},{id:'ink',name:'玄墨',caption:'沉静深色'},{id:'system',name:'跟随系统',caption:'随系统切换'}] as const
export function OnboardingController({request,suspended,onExit,finalFocus}:{request:'auto'|'full'|'models';suspended:boolean;onExit():void;finalFocus:()=>HTMLElement|null}){
 const bootstrap=useDesktopStore(state=>state.bootstrap)!
 const [route,setRoute]=useState<OnboardingRoute|null>(()=>request==='auto'?onboardingStartup(bootstrap):request==='full'?{flow:'full',step:bootstrap.onboarding?.step??'theme'}:{flow:'models',step:'entry'})
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[visit,setVisit]=useState(0)
 const [themeUnconfirmed,setThemeUnconfirmed]=useState(false),[missingAcknowledged,setMissingAcknowledged]=useState<string|null>(null)
 const pendingTheme=useRef<Settings['appearance']['theme']|null>(null),titleRef=useRef<HTMLHeadingElement>(null)
 const locked=useRef(false),alive=useRef(true),automatic=useRef(false)
 const attempt=useRef<{signature:string;id:string;body:Body;run:()=>Promise<StateSnapshot>}|null>(null)
 const creationIds=useRef<Partial<Record<'TEXT'|'IMAGE',string>>>({})
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;attempt.current=null;creationIds.current={}}},[])
 useEffect(()=>{if(!route)onExit()},[route,onExit])
 const flow=route?.flow??'full',step=route?.step
 const confirmationPending=!!error&&!!attempt.current&&bootstrap.onboarding?.receipt?.id===attempt.current.id
 function exit(){if(locked.current||suspended)return;attempt.current=null;onExit()}
 async function perform(body:Body){
  if(locked.current||suspended)throw Error('请等待当前操作完成')
  const signature=JSON.stringify({flow,...body})
  if(confirmationPending&&attempt.current?.signature!==signature)throw Error('请先重试确认上次提交')
  if(attempt.current?.signature!==signature){const id=crypto.randomUUID();attempt.current={signature,id,body:structuredClone(body),run:createDesktopOnboardingCommit({...body,flow,operationId:id} as OnboardingPayload)}}
  locked.current=true;setBusy(true);setError('')
  if(body.type==='theme'){pendingTheme.current=body.theme;setThemeUnconfirmed(true)}
  try{
   const next=await attempt.current.run()
   if(alive.current){attempt.current=null;if(body.type==='theme'){pendingTheme.current=null;setThemeUnconfirmed(false)}if(body.type==='model')creationIds.current={};setRoute({flow,step:next.onboarding!.step});setVisit(before=>before+1)}
   return next
  }catch(cause){if(alive.current)setError(cause instanceof Error?cause.message:'保存未确认，请重试');throw cause}
  finally{locked.current=false;if(alive.current)setBusy(false)}
 }
 const action=(body:Body)=>{void perform(body).catch(()=>{})}
 const retry=()=>{if(!attempt.current)throw Error('没有待确认的提交');return perform(attempt.current.body)}
 const draftChanged=()=>{if(!confirmationPending)attempt.current=null}
 useEffect(()=>{
  if(request==='models'&&step==='entry'&&!suspended&&!automatic.current){automatic.current=true;action({type:'start-models'})}
 },[request,step,suspended])
 const back=()=>action({type:'back'})
 async function submitModel(model:ModelDraft){
  if(model.id)return perform({type:'model',selection:{type:'draft',model}})
  const kind=step==='image'?'IMAGE':'TEXT'
  creationIds.current[kind]??=crypto.randomUUID()
  return perform({type:'model',selection:{type:'draft',model,creationId:creationIds.current[kind]}})
 }
 if(!route)return null
 const close=<Button variant="ghost" size="icon-sm" className="absolute right-4 top-4" aria-label="暂时退出引导" disabled={busy} onClick={exit}><X size={17}/></Button>
 const feedback=error?<div><p role="alert" className="text-sm text-destructive">{error}</p>{step==='theme'&&pendingTheme.current?<Button variant="outline" disabled={busy} onClick={()=>action({type:'theme',theme:pendingTheme.current!})}>重试主题保存</Button>:confirmationPending&&attempt.current?<Button variant="outline" disabled={busy} onClick={()=>action(attempt.current!.body)}>重试保存</Button>:null}</div>:null
 const next=<Button disabled={busy||themeUnconfirmed} onClick={()=>action({type:'next-theme'})}>{busy?<LoaderCircle size={16} className="animate-spin"/>:null}继续<ArrowRight size={16}/></Button>
 const open=!suspended
 if(step==='profile')return <ProfileEditorDialog key={`profile-${visit}`} open={open} blocked={busy} confirmationPending={confirmationPending} onRetry={retry} onDraftChanged={draftChanged} finalFocus={finalFocus} title="填写用户信息" submitLabel="继续" onClose={exit} onBack={back} onSaved={()=>{}} onSubmit={(avatarSessionId:string,user:Settings['user'],avatarDraftId?:string)=>perform({type:'profile',avatarSessionId,user,...(avatarDraftId?{avatarDraftId}:{})})}/>
 if(step==='text'||step==='image'){
  const kind=step==='text'?'TEXT':'IMAGE',id=kind==='TEXT'?bootstrap.onboarding?.textModelId:bootstrap.onboarding?.imageModelId
  const model=id?bootstrap.models.find(item=>item.id===id):undefined
  if(id&&!model&&missingAcknowledged!==id)return <Dialog open={open} onOpenChange={value=>{if(!value)exit()}}><DialogContent className="desktop-onboarding" finalFocus={finalFocus} initialFocus={()=>titleRef.current}><DialogTitle ref={titleRef} tabIndex={-1}>{kind==='TEXT'?'配置文本模型':'配置文生图模型'}</DialogTitle><DialogDescription>之前确认的模型已删除，请重新选择或添加模型。</DialogDescription><p role="alert">无法继续编辑已删除的模型。</p><div className="desktop-onboarding-footer-actions"><Button variant="outline" onClick={exit}>暂时退出</Button><Button onClick={()=>{setMissingAcknowledged(id);setVisit(before=>before+1)}}>重新选择或添加</Button></div></DialogContent></Dialog>
  return <ModelConfigurationDialog key={`${step}-${visit}`} open={open} finalFocus={finalFocus} kind={kind} model={model} onClose={exit} onboarding={{blocked:busy,confirmationPending,onRetry:retry,onDraftChanged:draftChanged,onSubmit:submitModel,onSelectExisting:id=>perform({type:'model',selection:{type:'existing',id}}),...(flow==='full'||step==='image'?{onBack:back}:{}),...(step==='image'?{onSkip:()=>action({type:'image-choice',choice:'skip'})}:{})}}/>
 }
 return <Dialog key={step} open={open} onOpenChange={value=>{if(!value)exit()}}><DialogContent showCloseButton={false} finalFocus={finalFocus} initialFocus={()=>titleRef.current} className={`desktop-onboarding desktop-onboarding-${step==='theme'?'theme':step==='image-choice'?'image-choice':step==='welcome'?'welcome':'compact'}`} onKeyDownCapture={event=>{if(event.nativeEvent.isComposing&&event.key==='Enter')event.preventDefault()}}>
  {close}
  <div className="desktop-onboarding-head">
   {step==='welcome'&&<img className="desktop-onboarding-welcome-mark" src={`/brand/seal-mark-${bootstrap.settings.appearance.theme==='ink'||bootstrap.settings.appearance.theme==='system'&&bootstrap.systemDark?'ink':'paper'}.svg`} alt=""/>}
   <DialogTitle ref={titleRef} tabIndex={-1}>{step==='theme'?'选择主题':step==='image-choice'?'要配置文生图模型吗？':step==='welcome'?'欢迎使用':'尚未配置文本模型'}</DialogTitle>
   <DialogDescription>{step==='theme'?'欢迎使用玄印写作。选择适合你的主题。':step==='image-choice'?'文字已经准备好了。你也可以为作品准备一个绘图助手。':step==='welcome'?'玄印写作，陪你把灵感写成作品。':'添加自己的文本模型后，就可以使用 AI 写作与审核。'}</DialogDescription>
  </div>
  <div className="desktop-onboarding-body">
   {step==='theme'&&<div role="radiogroup" aria-label="界面主题" className="desktop-onboarding-theme-grid">{themes.map(theme=><label key={theme.id} className="desktop-onboarding-theme-option" data-selected={bootstrap.settings.appearance.theme===theme.id}>
    <input type="radio" name="onboarding-theme" value={theme.id} aria-label={theme.name} checked={bootstrap.settings.appearance.theme===theme.id} disabled={busy||confirmationPending} onChange={()=>action({type:'theme',theme:theme.id})}/>
    <span className={`desktop-onboarding-theme-art ${theme.id}`} aria-hidden="true"><span className="mini-side"><i/><i/><i/><i/></span><span className="mini-chat"><b/><i/><i/><em/></span><span className="mini-content"><b/><i/><i/><i/><i/></span></span>
    <span className="desktop-onboarding-theme-meta"><strong className="desktop-onboarding-theme-name">{theme.name}</strong><span className="desktop-onboarding-theme-check" aria-hidden="true">{bootstrap.settings.appearance.theme===theme.id&&<Check size={13}/>}</span></span><span className="desktop-onboarding-theme-caption">{theme.caption}</span>
   </label>)}</div>}
   {step==='image-choice'&&<><div className="desktop-onboarding-choice-feature"><button type="button" className="choice-art-trigger" aria-label="配置文生图模型" disabled={busy||confirmationPending} onClick={()=>action({type:'image-choice',choice:'configure'})}><img className="choice-collage" src="/onboarding/xianxia-character-scene-v2.png" width="1774" height="887" alt="仙侠角色与云海山峦、楼阁场景的拼贴展示图"/><span className="choice-art-shade" aria-hidden="true"/><span className="choice-art-caption" aria-hidden="true"><span className="choice-art-label">配置文生图模型</span></span></button><div className="desktop-onboarding-choice-copy"><strong>给文字添一幅画</strong><p>封面、角色与场景图片<br/>使用你自己配置的文生图模型。</p></div></div><p className="desktop-onboarding-choice-info">这一步可以跳过。<br/>以后可在“设置 → 模型”中添加，不影响文本创作。</p></>}
   {step==='welcome'&&<><p className="desktop-onboarding-welcome-greeting">{bootstrap.settings.user.penName}，你好。</p><p className="desktop-onboarding-welcome-copy">从一个灵感、一段文字开始，<br/>写出属于你的作品。</p></>}
   {step==='entry'&&<p className="desktop-onboarding-choice-info">主题与用户信息保留，无需再次填写。<br/>暂不配置也可以继续使用本地写作功能。</p>}
   {feedback}
  </div>
  <div className="desktop-onboarding-footer">
   {step==='theme'?next:step==='welcome'?<Button onClick={exit}>开始创作<ArrowRight size={16}/></Button>:<>
    {step==='image-choice'&&<Button variant="ghost" disabled={busy||confirmationPending} onClick={back}>返回</Button>}
    <div className="desktop-onboarding-footer-actions">{step==='entry'?<><Button variant="outline" disabled={busy} onClick={exit}>暂不配置</Button><Button disabled={busy} onClick={()=>action({type:'start-models'})}>{busy&&<LoaderCircle size={16} className="animate-spin"/>}开始配置<ArrowRight size={16}/></Button></>:<><Button variant="outline" disabled={busy||confirmationPending} onClick={()=>action({type:'image-choice',choice:'skip'})}>跳过</Button><Button disabled={busy||confirmationPending} onClick={()=>action({type:'image-choice',choice:'configure'})}>配置文生图模型<ArrowRight size={16}/></Button></>}</div>
   </>}
  </div>
 </DialogContent></Dialog>
}
