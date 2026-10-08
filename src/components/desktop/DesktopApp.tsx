"use client"
import { useEffect, useState,useRef } from "react"
import { useTheme } from "next-themes"
import { useQueryClient } from "@tanstack/react-query"
import { DashboardShell } from "@/components/layout/DashboardShell"
import { useDesktopStore, receiveDesktopState,flushDesktopSettings } from "@/stores/desktop"
import { useChatStore } from "@/stores/chat"
import { installDesktopTransport } from "@/lib/desktop/transport"
import { WindowsMenuControl } from "./WindowControls"
import { SettingsDialog } from "./SettingsDialog"
import { desktopFontFamily } from "@/lib/desktop/appearance"
import { inheritedChatChoices } from "@/lib/desktop/chat-defaults"
import type { ModelRequiredNotice } from "@desktop/shared/ipc"
import { ModelRequiredDialog } from "./ModelRequiredDialog"
import { DesktopCommandController } from "./DesktopCommandController"
import { DesktopNavigation } from "./DesktopNavigation"
import {setDesktopCatalogStatus} from "@/lib/desktop/command-runtime"
import {DesktopDraftSession} from "@/lib/desktop/draft-session"
import {desktopSaveCoordinator} from "@/lib/desktop/save-coordinator"
import {installDesktopDraftSources} from "@/lib/desktop/draft-sources"
import {restoreDesktopDraft,installRecoveryDraftSource} from "@/lib/desktop/draft-recovery"
import {installWorkspaceDraftSource} from "@/lib/desktop/workspace-draft-source"
import {installCommentDraftSource} from "@/lib/desktop/comment-draft-source"
import {browserSessionStorage} from "@/lib/chat-session"
import {createRecoveryVerifier} from "@/lib/desktop/recovery-targets"
import {RecoveryDialog} from "./RecoveryDialog"
import {Dialog,DialogContent,DialogTitle,DialogDescription} from "@/components/ui/dialog"
import {Loader2} from "lucide-react"
import {toast} from "sonner"
import {useDesktopCommands} from "@/lib/desktop/use-command-target"
import {useTabsStore} from "@/stores/tabs"
import {Button} from "@/components/ui/button"
import {TemplateManagementDialog} from "./TemplateManagementDialog"
import {WorkLeasePendingDialog} from "./WorkLeasePendingDialog"
export default function DesktopApp() {
  const bootstrap = useDesktopStore(state => state.bootstrap)
  const [error, setError] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [templatesOpen,setTemplatesOpen]=useState(false)
  const [settingsSection, setSettingsSection] = useState<string | undefined>()
  const [modelRequired,setModelRequired] = useState<ModelRequiredNotice | null>(null)
  const [closing,setClosing]=useState(false),[recoveryOpen,setRecoveryOpen]=useState(false)
  const [migrationPending,setMigrationPending]=useState(false),[retryingMigration,setRetryingMigration]=useState(false)
  const [leasePending,setLeasePending]=useState(false)
  const leasePendingRef=useRef(false)
  const drafts=useRef<DesktopDraftSession|null>(null)
  const closingRef=useRef(false)
  const { setTheme } = useTheme()
  const queryClient = useQueryClient()
  const platform=bootstrap?.platform
  useDesktopCommands({"file.save":{enabled:()=>!!drafts.current&&!!useTabsStore.getState().activeTabId&&!closingRef.current,run:async()=>{await drafts.current?.flush();toast.success("草稿已保存在本机")}}})
  useEffect(()=>{
    if(!platform)return
    let alive=true,dispose:(()=>void)|undefined
    setDesktopCatalogStatus(platform,"loading")
    void import("@/lib/desktop/monaco-commands").then(module=>module.initializeMonacoCommandCatalog(platform)).then(cleanup=>{
      if(!alive){cleanup();return}
      dispose=cleanup;setDesktopCatalogStatus(platform,"ready")
    }).catch(()=>{if(alive)setDesktopCatalogStatus(platform,"unavailable")})
    return()=>{alive=false;dispose?.()}
  },[platform])
  useEffect(() => {
    const bridge = window.desktop
    if (!bridge) { setError("请使用玄印写作桌面应用打开此工作台。"); return }
    installDesktopTransport(bridge)
    let alive = true
    let bootstrapAborted=false
    const storage=browserSessionStorage()
    let session:DesktopDraftSession|null=null
    void bridge.bootstrap().then(async state => {
      if(!alive||bootstrapAborted)return
      const releases:Array<()=>void>=[]
      let businessSourcesInstalled=false
      const installBusinessSources=()=>{
        if(businessSourcesInstalled)return
        releases.push(installDesktopDraftSources(desktopSaveCoordinator,storage));releases.push(installWorkspaceDraftSource(desktopSaveCoordinator));releases.push(installCommentDraftSource(desktopSaveCoordinator,"local-author",storage));businessSourcesInstalled=true
      }
      session=new DesktopDraftSession(bridge,desktopSaveCoordinator,{
        restore:async(snapshot,signal)=>{
          const result=await restoreDesktopDraft(snapshot,{restoreSession:state.settings.general.restoreSession,accountId:"local-author",storage,signal,verifyTarget:createRecoveryVerifier(window.fetch,signal)})
          if(alive&&result.retained)toast.info(`已保留 ${result.retained} 项待核对草稿`,{action:{label:"查看草稿",onClick:()=>setRecoveryOpen(true)}})
          return result.requiresCheckpoint?result.afterCheckpoint:undefined
        },
        installSources:()=>{
          try{installBusinessSources();releases.push(installRecoveryDraftSource(desktopSaveCoordinator))}
          catch(error){for(const release of releases.reverse())release();throw error}
          return()=>{for(const release of releases.reverse())release()}
        },
        flushSettings:()=>flushDesktopSettings(),
        closing:value=>{if(alive){closingRef.current=value||leasePendingRef.current;setClosing(value||leasePendingRef.current)}},
      })
      drafts.current=session
      await session.initialize(state.draftSessionId)
      if(!alive||bootstrapAborted)return
      useDesktopStore.setState({bootstrap:state})
    }).catch(() => { if (alive) setError("本地数据加载失败，原文件已保留。请检查数据目录后重新打开。") })
    const unsubscribe = bridge.subscribe(event => {
      if(!alive)return
      if(event.type==="work-lease-pending"){leasePendingRef.current=true;closingRef.current=true;setClosing(true);setLeasePending(true);return}
      if(event.type==="migration-cancel-pending"){setMigrationPending(true);return}
      if(event.type==="close-cancelled"){setMigrationPending(false)}
      if(event.type==="prepare-close"||event.type==="close-cancelled"){
        if(session){void session.handle(event);return}
        if(event.type==="prepare-close"){
          bootstrapAborted=true;closingRef.current=true;setClosing(true)
          setError("本次启动已停止，原文件已保留。")
          void bridge.replyClose(event.sessionId,event.id,{status:event.action==="flush"?"unmodified":"failed"}).catch(()=>{})
        }else{closingRef.current=leasePendingRef.current;setClosing(leasePendingRef.current)}
        return
      }
      if (event.type === "state") {
        receiveDesktopState(event.state)
      }
      else if (event.type === "theme") useDesktopStore.setState(current => current.bootstrap ? { bootstrap: { ...current.bootstrap, systemDark: event.dark } } : {})
      else if (event.type === "model-required") setModelRequired(current => current ?? event)
      else if (event.type === "command") {
        if(closingRef.current)return
        if (event.id === "app.settings") { setSettingsSection(undefined); setSettingsOpen(true) }
        else if(event.id === "file.templates")setTemplatesOpen(true)
        else if (event.id === "file.chat") useChatStore.getState().requestNewConversation()
        else if (event.id === "works.refresh") void queryClient.invalidateQueries()
        else window.dispatchEvent(new CustomEvent("desktop:command", { detail: event.id }))
      }
    })
    const settings = (event: Event) => { if(closingRef.current)return;setSettingsSection((event as CustomEvent<string>).detail); setSettingsOpen(true) }
    const recovery=()=>{if(!closingRef.current){setSettingsOpen(false);setRecoveryOpen(true)}}
    window.addEventListener("desktop:settings",settings)
    window.addEventListener("desktop:recovery",recovery)
    return () => { alive = false; session?.dispose();if(drafts.current===session)drafts.current=null;unsubscribe(); window.removeEventListener("desktop:settings",settings);window.removeEventListener("desktop:recovery",recovery) }
  }, [queryClient])
  // State may arrive through an IPC event or the return value of our own save.
  // Watch committed content, including changed default IDs, for both paths.
  const modelOptionsKey = JSON.stringify([bootstrap?.models, bootstrap?.settings.agent])
  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey:["chat-models"] })
    void queryClient.invalidateQueries({ queryKey:["image-models"] })
    const state = useChatStore.getState()
    const agent = useDesktopStore.getState().bootstrap?.settings.agent
    if (agent && !state.pendingRequest && !state.isGenerating) useChatStore.setState(inheritedChatChoices(state, agent))
  }, [modelOptionsKey, queryClient])
  useEffect(() => {
    if (!bootstrap) return
    const appearance = bootstrap.settings.appearance
    setTheme(appearance.theme === "system" ? bootstrap.systemDark ? "ink" : "paper" : appearance.theme)
    document.body.dataset.platform = bootstrap.platform
    document.documentElement.style.setProperty("--desktop-ui-size", `${appearance.uiFontSize}px`)
    document.documentElement.style.fontSize = `${16 * appearance.uiFontSize / 14}px`
    document.documentElement.style.setProperty("--desktop-body-size", `${appearance.bodyFontSize}px`)
    document.documentElement.style.setProperty("--desktop-body-font", desktopFontFamily(appearance.bodyFont, true))
    document.documentElement.style.setProperty("--desktop-body-line-height", String(appearance.lineHeight))
    document.documentElement.style.setProperty("--font-ui", desktopFontFamily(appearance.uiFont))
  }, [bootstrap, setTheme])
  const leaseDialog=<WorkLeasePendingDialog key="work-lease-pending" open={leasePending}/>
  if (error) return <>{leaseDialog}<main className="flex h-dvh flex-col items-center justify-center gap-4 p-8"><p role="alert" className="text-destructive">{error}</p><Button variant="outline" disabled={closing} onClick={()=>window.location.reload()}>重新打开工作台</Button></main></>
  if (!bootstrap) return <>{leaseDialog}<main className="flex h-dvh flex-col items-center justify-center gap-4 text-muted-foreground" role="status">正在打开本地工作台…</main></>
  const profile = bootstrap.settings.user
  return <>{leaseDialog}<DesktopCommandController /><DesktopNavigation />
   <div inert={leasePending} className="contents"><DashboardShell user={{ id: "local-author", name: profile.penName, email: profile.email, avatarUrl: profile.avatarAssetId ? `xaanink://asset/global/${profile.avatarAssetId}` : undefined }} /></div>
   <WindowsMenuControl /><TemplateManagementDialog open={templatesOpen} onOpenChange={setTemplatesOpen}/><SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} initialSection={settingsSection} />
   <ModelRequiredDialog notice={modelRequired} onClose={() => setModelRequired(null)} onConfigure={() => { setModelRequired(null); setSettingsSection(modelRequired?.code === "MODEL_NOT_SELECTED" ? "agent" : "models"); setSettingsOpen(true) }} /><RecoveryDialog open={recoveryOpen} onOpenChange={setRecoveryOpen}/>
   <Dialog open={!leasePending&&(closing||migrationPending)} onOpenChange={()=>{}}><DialogContent showCloseButton={false}>
    <DialogTitle>{migrationPending?"迁移取消尚未保存":"正在保存并关闭"}</DialogTitle>
    <DialogDescription>{migrationPending?"原数据和草稿已保留。请检查目录权限后重试取消；取消成功前，工作台暂不接受修改。":"正在等待本地写入确认，请保留窗口。"}</DialogDescription>
    {migrationPending?<Button disabled={retryingMigration} onClick={async()=>{setRetryingMigration(true);try{await window.desktop?.migrateRoot("cancel")}catch{toast.error("取消状态仍未保存，请检查目录权限后重试。")}finally{setRetryingMigration(false)}}}>{retryingMigration?"正在重试…":"重试取消迁移"}</Button>:<Loader2 aria-label="正在保存" className="size-5 animate-spin"/>}
   </DialogContent></Dialog></>
}
