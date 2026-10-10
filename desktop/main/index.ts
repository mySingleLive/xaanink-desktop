import { app, BaseWindow, BrowserWindow, ImageView, clipboard, dialog, ipcMain, Menu, MessageChannelMain, nativeImage, nativeTheme, protocol, safeStorage, screen, session, shell, type IpcMainInvokeEvent, type MenuItemConstructorOptions } from "electron"
import { Worker } from "node:worker_threads"
import {randomUUID} from "node:crypto"
import {DraftJournal,validateDraftSnapshot} from "./draft-journal"
import {CloseCoordinator,type CloseIntent,type CloseOwner} from "./close-coordinator"
import {RendererCloseChannel} from "./renderer-close-channel"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { lstat,readdir } from "node:fs/promises"
import { mkdirSync,realpathSync } from "node:fs"
import { z } from "zod"
import { ModelService } from "./model-service"
import { ModelConfigurationService } from "./model-configuration"
import { AvatarAssetService } from "./avatar-assets"
import { modelFailureNotice } from "./model-guidance"
import { settingsSchema, type Settings } from "../core/settings"
import { nativeWindowAppearance, applyWindowAppearance, syncNativeThemeSource } from "./window-appearance"
import { installWindowsCloseAccent } from "./native-close-accent"
import { RevisionConflict,atomicWrite } from "../core/versioned-store"
import { ModelRepository } from "./model-repository"
import { ModelGateway } from "../core/model-authorization"
import { DirectoryAuthority, type DirectoryPurpose } from "./directory-authority"
import { RpcPeer } from "../service/rpc"
import { requestSchema, type LocalResponse, type DesktopEvent, type SettingsAction } from "../shared/ipc"
import commands from "../shared/commands.json"
import { desktopMenu, electronAccelerator } from "../shared/command-registry"
import {localImageRequest} from "../shared/local-images"
import {ConfigurationFiles} from "./configuration-files"
import {FileExports} from "./file-export"
import {fileExportFailureMessages} from "../shared/file-export"
import {guardFileExportTarget} from "./file-export-target"
import {trustedCommandCatalogs} from "./trusted-command-catalogs"
import {createRootStartupBuffer,waitRootStartup} from "../shared/root-startup"
import {prepareSessionDirectory} from "./session-directory"
import {rootMaintenanceRequired} from "./root-maintenance-preflight"
import {launchRootMaintenance} from "./root-maintenance-window"
import {staticUiResponse} from "./static-ui"
import {BusinessGate} from "./business-gate"
import {DataRootManager} from "../core/data-root"
import {RootMigrationRequests} from "./root-migration-request"
import {RootMigrationHandoff} from "./root-migration-handoff"
import {assertNoLegacyBackupRecovery} from "./legacy-recovery-preflight"
import {WorkLeaseHandoff} from "./work-lease-handoff"
import {workLeaseRequestSchema} from "../shared/work-lease"
import {ApplicationMetadataGate} from "./application-metadata-gate"
import {rootRelocationPreflight} from "./root-relocation-preflight"
import {launchRootRelocation} from "./root-relocation-window"
import {inboxLeaseRecoveryRequired} from "./inbox-lease-recovery"
import {launchInboxLeaseRecovery} from "./inbox-lease-recovery-window"
import {ConversationDirectoryAuthorizations} from "./conversation-directory-authorizations"
import type {ConversationRequestOrigin} from "../shared/conversation-task"
import {workNames} from "../core/brand-names"
import {selectBrandStartupPaths,BrandStartupPathError,legacyEncryptionName,type BrandStartupPaths} from "./brand-startup-paths"
import { InputContextMenus } from "./input-context-menu"
import { inputContextStateSchema } from "../shared/input-context-menu"
import { OnboardingService } from "./onboarding-service"
import { OnboardingError, onboardingActionSchema } from "../shared/onboarding"

app.enableSandbox()
protocol.registerSchemesAsPrivileged([{ scheme: "xaanink", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true } }])
// Keep the instance-lock directory stable even when the data root changes.
const isolatedRoot = process.env.XAANINK_TEST_ROOT ? resolve(process.env.XAANINK_TEST_ROOT) : null
let startupPaths:BrandStartupPaths|null=null, startupSelectionError:unknown=null
try{startupPaths=selectBrandStartupPaths({appData:app.getPath("appData"),home:homedir(),isolatedRoot})}
catch(error){startupSelectionError=error;if(error instanceof BrandStartupPathError)startupPaths=error.recoveryPaths}
app.setName(startupPaths?.encryptionFamily==="legacy"?legacyEncryptionName:"玄印写作")
void app.whenReady().then(()=>app.setName("玄印写作"))
const bootstrapDirectory=startupPaths?.bootstrap??""
let bootstrapPath=""
if(startupPaths){
  mkdirSync(bootstrapDirectory, { recursive: true })
  bootstrapPath=realpathSync(bootstrapDirectory)
  app.setPath("userData", bootstrapPath)
}

let window: BrowserWindow | null = null
let modelService: ModelService
let modelConfiguration: ModelConfigurationService
let avatarAssets: AvatarAssetService
let onboardingService: OnboardingService
let repository: ModelRepository
let configurationFiles:ConfigurationFiles
let fileExports:FileExports
let recoveryExports:FileExports
let service: RpcPeer
let worker: Worker
let dataRoot = ""
const businessGate=new BusinessGate()
const inputContextMenus=new InputContextMenus(template=>Menu.buildFromTemplate(template))
const applicationMetadata=new ApplicationMetadataGate()
const metadataWrites={withWrite:<T>(run:()=>Promise<T>)=>applicationMetadata.write(run)}
let businessClosed=false
let migrationHandoff:RootMigrationHandoff|null=null
let workLease:WorkLeaseHandoff|null=null
let draftJournal:DraftJournal
let draftSession:{owner:number;id:string;ready:boolean;release:()=>void}|null=null
let ordinaryWorkerExited=false
let failedRootBeforeSession=false
let quitting = false
let closingFlow:Promise<boolean>|null=null
let closeCommitted=false
let closeCoordinator:CloseCoordinator
const closeChannel=new RendererCloseChannel(event=>send(event))
const closePermits=new WeakSet<BrowserWindow>()
let menuRevision = -1
let windowTheme: Settings["appearance"]["theme"] = "system"
let menuShortcuts: Record<string,string[]> = {}
const authority = new DirectoryAuthority()
const conversationDirectories=new ConversationDirectoryAuthorizations({choose:chooseConversationDirectory,revoke:owner=>authority.revokeOwner(owner)})
const responseOwners = new Map<string, { owner: number; cancel(): Promise<void> }>()
const send = (event: DesktopEvent) => {
  if (event.type === "state"&&event.state.revision>=menuRevision) refreshMenus(event.state)
  if (window && !window.isDestroyed()) window.webContents.send("desktop:event", event)
}
function trusted(event: IpcMainInvokeEvent) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || (new URL(event.senderFrame.url).protocol !== "xaanink:" || new URL(event.senderFrame.url).host !== "app")) throw new Error("不受信的桌面请求")
}
const directoryPurpose = z.enum(["create-work", "open-work", "data-root", "default-parent"])
function makeRecoveryExports(){
  return new FileExports({assertOwner:owner=>{
    // Recovery export must remain available when normal close/flush has failed.
    if(!window||window.isDestroyed()||!draftSession||draftSession.owner!==window.webContents.id||owner!==`${window.webContents.id}:${draftSession.id}`)throw Error("草稿所属窗口已变化")
  },chooseSave:async()=>{
    const selected=await dialog.showSaveDialog(window!,{title:"导出恢复草稿",defaultPath:"玄印写作-恢复草稿.json",filters:[{name:"恢复草稿",extensions:["json"]}]})
    return selected.canceled?null:selected.filePath??null
  },guardTarget:async target=>guardFileExportTarget(target,{dataRoots:[dataRoot,bootstrapPath],workRoots:await service.call<string[]>("protected-directories")})})
}
async function exportDraftSnapshot(input:unknown) {
  const snapshot=validateDraftSnapshot(input),current=window,sessionId=draftSession?.id
  if(!current||current.isDestroyed()||!sessionId)throw new Error("草稿窗口不可用")
  const result=await recoveryExports.save(`${current.webContents.id}:${sessionId}`,{id:randomUUID(),format:"recovery",filename:"玄印写作-恢复草稿.json",bytes:new TextEncoder().encode(JSON.stringify({format:"xaanink-recovery",version:1,snapshot})+"\n")})
  if(window!==current||current.isDestroyed()||draftSession?.id!==sessionId)throw new Error("草稿所属窗口已变化")
  if(result.status==="failed")throw Error(fileExportFailureMessages[result.code])
  return result.status==="saved"
}
function beginClose(intent:CloseIntent){
  if(!closeCoordinator)return
  if(workLease)intent="quit"
  if(!closingFlow&&migrationHandoff?.pending&&businessGate.closed){void retryMigrationCancellation().then(()=>beginClose(intent)).catch(()=>send({type:"migration-cancel-pending"}));return}
  if(!closingFlow)closeCommitted=false
  const work=closeCoordinator.request(intent);closingFlow=work
  void work.finally(()=>{if(closingFlow===work)closingFlow=null})
}
async function flushDraftForClose(owner:CloseOwner,retry:boolean){
  const reply=await closeChannel.request(owner,"flush",retry)
  if(!draftSession||draftSession.owner!==owner.owner||draftSession.id!==owner.sessionId)throw new Error("草稿所属窗口已变化")
  if(reply.status==="unmodified"&&!draftSession.ready)return
  if(reply.status!=="saved"||!draftSession.ready)throw new Error("尚未保存")
  await draftJournal.confirm(String(owner.owner),reply.receipt)
}
async function chooseDirectory(purpose: DirectoryPurpose, owner: string) {
  if (!window) throw new Error("应用窗口不可用")
  const settings = await repository.read()
  const result = await dialog.showOpenDialog(window, { title: purpose === "create-work" ? "为作品选择独立的空目录" : purpose === "open-work" ? "打开作品目录" : purpose === "data-root" ? "迁移应用数据" : "选择默认作品父目录", defaultPath: settings.settings.general.defaultParent || homedir(), properties: ["openDirectory", "createDirectory"] })
  return result.canceled || !result.filePaths[0] ? null : authority.issue(result.filePaths[0], purpose, owner)
}
async function chooseConversationDirectory(input:{title:string;premise?:string;requestId:string},assertCurrent:()=>void,grantOwner:string){
  assertCurrent()
  const current=window
  if(!current)throw Error("目录选择所属窗口不可用")
  try{
    const settings=await repository.read();assertCurrent()
    const result=await dialog.showOpenDialog(current,{title:`为《${input.title}》选择独立的空目录`,defaultPath:settings.settings.general.defaultParent||homedir(),properties:["openDirectory","createDirectory"]})
    assertCurrent()
    if(result.canceled)return null
    if(!Array.isArray(result.filePaths)||result.filePaths.length!==1||typeof result.filePaths[0]!=="string")throw Error("目录选择结果无效")
    const grant=await authority.issue(result.filePaths[0],"create-work",grantOwner);assertCurrent()
    const selection=await authority.consume(grant.id,"create-work",grantOwner);assertCurrent()
    return selection
  }finally{authority.revokeOwner(grantOwner)}
}
function createOrdinaryServiceWorker(){
  const startup = createRootStartupBuffer()
  worker = new Worker(join(__dirname, "../service/index.cjs"), { workerData: { root: dataRoot, bootstrap:bootstrapPath, migrations: join(app.getAppPath(), "prisma/migrations"), startup } })
  service = new RpcPeer(worker, async (method, value) => {
    if (!modelService) throw new Error("模型服务尚未就绪")
    if (method === "conversation.claim") return conversationDirectories.claim(value)
    if (method === "conversation.release") return conversationDirectories.release(value)
    if (method === "conversation.choose-directory") return conversationDirectories.choose(value)
    if (method === "conversation.create-admission") return conversationDirectories.createAdmission(value)
    if (method === "conversation.create-finished") return conversationDirectories.finishCreate(value)
    if (method === "model.catalog") return repository.read()
    if (method === "model.defaults") return modelService.defaults()
    if (method === "model.resolve") {
      try { return await modelService.resolve(value) }
      catch (error) { const notice = modelFailureNotice(error,value); if (notice) send(notice); throw error }
    }
    if (method === "model.assert") return modelService.assertAuthorization(value)
    if (method === "model.start") return modelService.start(value)
    if (method === "model.image.start") return modelService.startImage(value)
    if (method === "model.read") return modelService.read(value)
    if (method === "model.cancel") return modelService.cancel(value)
    throw new Error("未知主进程服务命令")
  })
  const disconnected = () => {
    applicationMetadata.revoke()
    conversationDirectories.revokeAll()
    service.dispose()
    void modelService?.close().catch(() => undefined)
    send({ type: "service-disconnected" })
    const responses = [...responseOwners.values()]; responseOwners.clear()
    void Promise.allSettled(responses.map(response => response.cancel()))
  }
  worker.on("error", disconnected); worker.on("exit", () => {ordinaryWorkerExited=true;conversationDirectories.workerStopped();disconnected()})
  ordinaryWorkerExited=false
  return startup
}
async function launch() {
  const assertLock=()=>{if(!app.hasSingleInstanceLock())throw Error("LOCK_REQUIRED")}
  assertNoLegacyBackupRecovery(bootstrapPath,assertLock)
  if(startupSelectionError||!startupPaths)throw startupSelectionError??Error("BRAND_STARTUP_INVALID")
  dataRoot = startupPaths.defaultRoot
  // The synchronous worker barrier validates and owns the root before Electron
  // creates caches or any UI. Legacy recovery controls are inspected above.
  const startup=createOrdinaryServiceWorker(),rootStartup=waitRootStartup(startup)
  if(rootStartup.status!=="ready"){failedRootBeforeSession=rootStartup.code==="ROOT_INITIALIZATION_FAILED";throw new Error(rootStartup.code)}
  dataRoot=rootStartup.root
  app.setPath("sessionData", prepareSessionDirectory(dataRoot))
  await service.call("ready")
  await app.whenReady()
  let vault: ModelRepository
  const gateway = new ModelGateway({ keyFor: (id, revision) => vault.keyFor(id, revision), fetch: globalThis.fetch })
  vault = repository = new ModelRepository(join(dataRoot, "state.json"), safeStorage, gateway,metadataWrites)
  await repository.initialize()
  modelService = new ModelService(repository, gateway)
  modelConfiguration = new ModelConfigurationService({ repository, gateway, fetch: globalThis.fetch })
  avatarAssets = new AvatarAssetService({ root: dataRoot,...metadataWrites })
  onboardingService = new OnboardingService({ repository, avatarAssets })
  configurationFiles=new ConfigurationFiles({repository,catalogs:trustedCommandCatalogs,protectedRoots:async()=>[dataRoot,bootstrapPath,...await service.call<string[]>("protected-directories")],assertOwner:owner=>{
    if(!window||window.isDestroyed()||!draftSession||closingFlow||!owner.startsWith(`${window.webContents.id}:${draftSession.id}:`))throw Error("配置所属窗口已变化")
  },chooseImport:async()=>{const selected=await dialog.showOpenDialog(window!,{title:"导入配置",properties:["openFile"],filters:[{name:"玄印写作配置",extensions:["json"]}]});return selected.canceled?null:selected.filePaths[0]??null},
  chooseExport:async()=>{const selected=await dialog.showSaveDialog(window!,{title:"导出配置",defaultPath:"玄印写作-配置.json",filters:[{name:"玄印写作配置",extensions:["json"]}]});return selected.canceled?null:selected.filePath??null}})
  fileExports=new FileExports({assertOwner:owner=>{
    if(!window||window.isDestroyed()||!draftSession?.ready||draftSession.owner!==window.webContents.id||closingFlow||businessGate.closed||owner!==`${window.webContents.id}:${draftSession.id}`)throw Error("导出所属窗口已变化")
  },chooseSave:async(_owner,input)=>{
    const selected=await dialog.showSaveDialog(window!,{title:input.format==="templates"?"导出模板":"导出稿件",defaultPath:input.filename,filters:[{name:input.format==="templates"?"玄印写作模板":input.extension.toUpperCase(),extensions:[input.extension]}]})
    return selected.canceled?null:selected.filePath??null
  },guardTarget:async target=>guardFileExportTarget(target,{dataRoots:[dataRoot,bootstrapPath],workRoots:await service.call<string[]>("protected-directories")})})
  recoveryExports=makeRecoveryExports()
  draftJournal = new DraftJournal(dataRoot,metadataWrites)
  protocol.handle("xaanink", async request => {
    const url = new URL(request.url)
    if (!["GET", "HEAD"].includes(request.method)) return new Response(null, { status: 403 })
    if (url.hostname === "asset") {
      const id = /^\/global\/([0-9a-f-]{36})$/.exec(url.pathname)?.[1]
      if (!id || url.search || url.username || url.password) return new Response(null, { status: 404 })
      try {
        const bytes = await businessGate.run(()=>avatarAssets.readAsset(id))
        if (!bytes) return new Response(null, { status: 404 })
        return new Response(request.method === "HEAD" ? null : new Uint8Array(bytes), { headers: { "Content-Type": "image/png", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'", "Cache-Control": "private, max-age=31536000, immutable" } })
      } catch { return new Response(null, { status: 404 }) }
    }
    if (url.hostname !== "app") return new Response(null, { status: 403 })
    if(localImageRequest(url.pathname+url.search)){
      if(!["GET","HEAD"].includes(request.method))return new Response(null,{status:405})
      try{
        const asset=await businessGate.run(()=>service.call<{bytes:Uint8Array;mime:string}>("image-asset",url.pathname))
        if(!["image/png","image/jpeg","image/webp","image/gif"].includes(asset.mime)||asset.bytes.byteLength>10*1024*1024)throw Error("INVALID_IMAGE")
        return new Response(request.method==="HEAD"?null:new Uint8Array(asset.bytes),{headers:{"Content-Type":asset.mime,"Content-Length":String(asset.bytes.byteLength),"X-Content-Type-Options":"nosniff","Cache-Control":"private, max-age=31536000, immutable","Content-Security-Policy":"default-src 'none'"}})
      }catch{return new Response(null,{status:404})}
    }
    return staticUiResponse(request,join(app.getAppPath(),"out"))
  })
  const localFontsAllowed = (contents: Electron.WebContents | null, permission: string, details: { isMainFrame: boolean; requestingUrl?: string }) => permission === "local-fonts" && !!window && contents === window.webContents && details.isMainFrame && details.requestingUrl === "xaanink://app/"
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => callback(localFontsAllowed(contents, permission, details)))
  session.defaultSession.setPermissionCheckHandler((contents, permission, _origin, details) => localFontsAllowed(contents, permission, details))
  session.defaultSession.on("will-download",event=>event.preventDefault())
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !["xaanink:", "devtools:", "blob:", "data:"].includes(new URL(details.url).protocol) }))
  registerIpc()
  closeCoordinator=new CloseCoordinator({
    current:()=>window&&draftSession?{owner:window.webContents.id,sessionId:draftSession.id}:null,
    busy:async()=>{const status=await service.call<{active:number}>("task-status");return status.active>0||modelService.activeCount>0||modelConfiguration.activeCount>0},
    confirmStop:async()=>{const options={type:"question" as const,title:"仍有创作任务运行",message:"停止正在执行的任务后关闭？",detail:"已保存的内容和待确认草稿会保留。",buttons:["取消关闭","停止任务并继续"],defaultId:0,cancelId:0};const result=window?await dialog.showMessageBox(window,options):await dialog.showMessageBox(options);return result.response===1},
    stopTasks:async()=>{
      if(window)modelConfiguration.cancelOwner(String(window.webContents.id))
      const timeout=Promise.withResolvers<never>(),timer=setTimeout(()=>timeout.reject(new Error("停止任务超时，窗口与草稿已保留")),10000)
      try{await Promise.race([Promise.all([modelService.close(),service.call("stop-tasks")]),timeout.promise])}
      finally{clearTimeout(timer)}
    },
    flush:flushDraftForClose,
    closeData:async()=>{
      if(window){recoveryExports.cancelWindow(`${window.webContents.id}:`);fileExports.cancelWindow(`${window.webContents.id}:`);configurationFiles.cancelWindow(`${window.webContents.id}:`);modelConfiguration.cancelOwner(String(window.webContents.id));avatarAssets.cancelOwner(String(window.webContents.id))}
      const drained=businessGate.close()
      conversationDirectories.revokeAll()
      await Promise.allSettled([...responseOwners.values()].map(response=>response.cancel()))
      await drained;await conversationDirectories.flush();await recoveryExports.flush();await fileExports.flush();await configurationFiles.flush();await repository.read();await service.call("close")
      businessClosed=true
      await draftJournal.read()
      const drainedMetadata=await applicationMetadata.acquire();applicationMetadata.release(drainedMetadata)
      await migrationHandoff?.armClosed()
    },
    closedHandoffPending:()=>!!workLease?.requiresRestart,
    afterClose:async()=>{await workLease?.finishClosed()},
    failed:async()=>{
      if(workLease?.requiresRestart){const options={type:"warning" as const,title:"作品锁修复交接尚未完成",message:"作品锁修复状态尚未确认保存。",detail:"原文件与恢复草稿已保留。工作台暂不接受修改，请重试完成交接后重新启动。",buttons:["重试交接","稍后重试"],defaultId:1,cancelId:1};const result=window?await dialog.showMessageBox(window,options):await dialog.showMessageBox(options);return result.response===0?"retry":"cancel"}
      const options={type:"warning" as const,title:"尚不能关闭",message:"部分修改尚未确认保存。",detail:"窗口和原草稿已保留。可以重试、导出恢复草稿，或返回继续处理。",buttons:["重试","导出草稿","取消关闭"],defaultId:2,cancelId:2};const result=window?await dialog.showMessageBox(window,options):await dialog.showMessageBox(options);return(["retry","export","cancel"] as const)[result.response]??"cancel"
    },
    exportDraft:async owner=>{const reply=await closeChannel.request(owner,"export");if(!window||window.isDestroyed()||window.webContents.id!==owner.owner||draftSession?.owner!==owner.owner||draftSession.id!==owner.sessionId)throw new Error("草稿所属窗口已变化");if(reply.status!=="export")throw new Error("无法读取草稿");await exportDraftSnapshot(reply.snapshot)},
    commit:async intent=>{migrationHandoff?.commit();workLease?.commit();closeCommitted=true;if(window)closePermits.add(window);if(intent==="quit"){quitting=true;void worker.terminate();app.quit()}else window?.close()},
    release:async()=>{closeChannel.cancel();if(!closeCommitted){
      if(workLease?.requiresRestart){send({type:"work-lease-pending"});return}
      await workLease?.cancel()
      try{await migrationHandoff?.cancelPrepared();await restoreBusiness()}
      catch(error){void businessGate.close();send({type:"migration-cancel-pending"});throw error}
    }},
  })
  // Subscribe before loadURL so a system change during first paint is retained.
  nativeTheme.on("updated", () => {
    applyMainWindowAppearance()
    send({ type: "theme", dark: nativeTheme.shouldUseDarkColors })
  })
  await createWindow()
  app.on("second-instance", () => { window?.show(); window?.focus() })
  app.on("activate", () => { if(closingFlow||migrationHandoff?.pending||workLease?.pending)return;if (!window) void createWindow(); else window.show() })
  app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit() })
  app.on("before-quit", event => {
    if (quitting) return
    event.preventDefault()
    beginClose("quit")
  })
}
async function restoreBusiness(){if(workLease?.requiresRestart)throw Error("作品锁修复交接必须完成后重新启动");if(businessGate.closed)await businessGate.close();businessGate.reopen();businessClosed=false;modelService.resume();send({type:"close-cancelled"})}
async function retryMigrationCancellation(){
  if(closingFlow)throw Error("迁移交接仍在处理中")
  await migrationHandoff?.cancelPrepared();await restoreBusiness();migrationHandoff=null
}
function businessHandle(channel:string,handler:(event:IpcMainInvokeEvent,...args:any[])=>unknown){
  ipcMain.handle(channel,(event,...args)=>businessGate.run(async()=>handler(event,...args)))
}
function registerIpc() {
  ipcMain.handle("desktop:work-lease",async(event,input)=>{
    trusted(event);const action=workLeaseRequestSchema.parse(input)
    if(action.type==="retry"){
      if(!workLease?.requiresRestart)throw Error("没有待完成的作品锁恢复")
      beginClose("quit");return closingFlow&&await closingFlow?"restarting":"pending"
    }
    if(closingFlow||migrationHandoff||workLease||businessGate.closed)throw Error("恢复、迁移或关闭仍在处理中")
    const ownerWindow=window,ownerSession=draftSession
    if(!ownerWindow||!ownerSession?.ready)throw Error("请等待工作台加载完成")
    const identity={owner:ownerWindow.webContents.id,sessionId:ownerSession.id}
    const assertOwner=(owner:CloseOwner)=>{trusted(event);if(window!==ownerWindow||ownerWindow.isDestroyed()||draftSession!==ownerSession||owner.owner!==ownerSession.owner||owner.sessionId!==ownerSession.id)throw Error("作品锁恢复所属窗口已变化")}
    const handoff=new WorkLeaseHandoff({workId:action.workId,owner:identity},{
      assertOwner,assertHost:()=>{if(!app.hasSingleInstanceLock())throw Error("LOCK_REQUIRED")},
      namesForWork:workNames,
      assertClosed:()=>{if(!businessClosed||!businessGate.closed)throw Error("恢复前本地数据尚未关闭")},
      target:workId=>service.call("closed-work-lease-target",workId),
      confirm:async(preview,signal)=>{
        assertOwner(identity)
        const result=await dialog.showMessageBox(ownerWindow,{type:"warning",title:"修复异常退出锁",message:"移除已退出进程留下的作品锁？",detail:`作品目录：${preview.work.path}\n原进程：${preview.owner.pid}\n原设备：${preview.owner.host}\n已确认该本机进程退出。只处理这次确认的锁，作品内容保持原样。完成或取消后应用都会重新启动。`,buttons:["取消","修复并重新启动"],defaultId:0,cancelId:0,signal})
        assertOwner(identity);return !signal.aborted&&result.response===1
      },
      close:async()=>{beginClose("quit");return closingFlow?await closingFlow:false},
      notice:async message=>{assertOwner(identity);await dialog.showMessageBox(ownerWindow,{type:"info",title:"作品锁恢复结果",message,buttons:["重新启动"],defaultId:0,cancelId:0});assertOwner(identity)},
      restart:()=>app.relaunch(),
    })
    workLease=handoff
    try{return await handoff.start()?"restarting":handoff.requiresRestart?"pending":"cancelled"}
    finally{if(!handoff.requiresRestart&&workLease===handoff)workLease=null}
  })
  ipcMain.handle("desktop:migrate-root",async(event,input)=>{
    trusted(event)
    const action=z.enum(["start","cancel"]).parse(input)
    if(action==="cancel"){await retryMigrationCancellation();return false}
    if(closingFlow||migrationHandoff||workLease)throw Error("作品锁修复、迁移或关闭仍在处理中")
    const ownerWindow=window,ownerSession=draftSession
    if(!ownerWindow||!ownerSession?.ready)throw Error("请等待工作台加载完成")
    const source=new DataRootManager(bootstrapPath,dataRoot)
    const assertOwner=()=>{trusted(event);if(window!==ownerWindow||draftSession!==ownerSession)throw Error("迁移所属窗口已变化")}
    const requests=new RootMigrationRequests(bootstrapPath,{resolveSource:()=>source.resolve(),assertStableLock:()=>{if(!app.hasSingleInstanceLock())throw Error("LOCK_REQUIRED")},assertOwner:nonce=>handoff.assertOwner(nonce),assertClosed:()=>{if(!businessClosed||!businessGate.closed)throw Error("SOURCE_NOT_CLOSED")}})
    const handoff=new RootMigrationHandoff({requests,assertOwner,choose:async()=>{
      const grant=await chooseDirectory("data-root",String(event.sender.id));assertOwner()
      if(!grant)return null
      const target=await authority.consume(grant.id,"data-root",String(event.sender.id));assertOwner()
      if((await readdir(target.path)).length)throw Error("请选择一个空目录用于迁移应用数据")
      return target
    },confirm:async target=>{
      const result=await dialog.showMessageBox(ownerWindow,{type:"question",title:"迁移应用数据",message:"迁移应用数据并重新启动？",detail:`目标目录：${target.path}\n草稿和设置保存后会重新启动，显示迁移进度。作品继续存放在各自的目录中。`,buttons:["取消","迁移并重新启动"],defaultId:0,cancelId:0})
      assertOwner();return result.response===1
    },close:async()=>{beginClose("quit");return closingFlow?await closingFlow:false},restart:()=>app.relaunch()})
    migrationHandoff=handoff
    try{return await handoff.start()}
    finally{if(!handoff.pending){if(!closeCommitted&&businessGate.closed)await restoreBusiness();if(migrationHandoff===handoff)migrationHandoff=null}}
  })
  businessHandle("desktop:configuration",async(event,input)=>{
    trusted(event)
    if(!draftSession||draftSession.owner!==event.sender.id||closingFlow)throw Error("配置所属窗口不可用")
    const ownerSession=draftSession,currentWindow=window
    const active=()=>{trusted(event);if(draftSession!==ownerSession||window!==currentWindow)throw Error("配置所属窗口已变化")}
    const action=z.discriminatedUnion("type",[
      z.object({type:z.literal("preview"),sessionId:z.uuid()}).strict(),z.object({type:z.literal("export"),sessionId:z.uuid()}).strict(),z.object({type:z.literal("cancel"),sessionId:z.uuid()}).strict(),
      z.object({type:z.literal("apply"),sessionId:z.uuid(),token:z.uuid(),choices:z.unknown()}).strict(),
    ]).parse(input)
    const owner=`${event.sender.id}:${draftSession.id}:${action.sessionId}`
    if(action.type==="cancel"){configurationFiles.cancel(owner);return true}
    if(action.type==="preview"){const result=await configurationFiles.preview(owner);active();return result}
    if(action.type==="export"){const result=await configurationFiles.export(owner);active();return result}
    const state=await configurationFiles.apply(owner,action.token,action.choices as import("../core/configuration-transfer").ConfigurationImportChoices)
    active()
    window?.webContents.setZoomFactor(state.settings.appearance.zoom);send({type:"state",state});return state
  })
  businessHandle("desktop:file-export",async(event,input)=>{
    trusted(event)
    if(!draftSession?.ready||draftSession.owner!==event.sender.id||closingFlow)throw Error("导出所属窗口不可用")
    return fileExports.save(`${event.sender.id}:${draftSession.id}`,input)
  })
  ipcMain.handle("desktop:file-export-cancel",async(event,input)=>{
    trusted(event)
    if(!draftSession||draftSession.owner!==event.sender.id)throw Error("导出所属窗口已变化")
    fileExports.cancel(`${event.sender.id}:${draftSession.id}`,z.uuid().parse(input))
  })
  ipcMain.handle("desktop:close-reply",async(event,sessionId,id,reply)=>{
    trusted(event)
    if(!draftSession||draftSession.owner!==event.sender.id||draftSession.id!==z.uuid().parse(sessionId))throw new Error("草稿所属窗口已变化")
    return closeChannel.reply({owner:event.sender.id,sessionId},z.uuid().parse(id),reply)
  })
  ipcMain.handle("desktop:draft-export",async(event,sessionId,snapshot)=>{
    trusted(event)
    if(!draftSession||draftSession.owner!==event.sender.id||draftSession.id!==z.uuid().parse(sessionId))throw new Error("草稿所属窗口已变化")
    return exportDraftSnapshot(snapshot)
  })
  ipcMain.handle("desktop:draft-persist", async (event, sessionId, snapshot) => {
    trusted(event)
    if(!draftSession||draftSession.owner!==event.sender.id||draftSession.id!==z.uuid().parse(sessionId))throw new Error("草稿所属窗口已变化")
    if(!draftSession.ready)throw new Error("草稿恢复尚未就绪")
    if(businessClosed)throw Error("草稿数据已关闭")
    const receipt=await draftJournal.persist(String(event.sender.id),snapshot)
    trusted(event)
    if(draftSession?.id!==sessionId)throw new Error("草稿所属窗口已变化")
    return receipt
  })
  ipcMain.handle("desktop:draft-ready",async(event,sessionId)=>{
    trusted(event)
    if(!draftSession||draftSession.owner!==event.sender.id||draftSession.id!==z.uuid().parse(sessionId))throw new Error("草稿所属窗口已变化")
    if(closingFlow)throw new Error("工作台正在关闭")
    draftSession.ready=true
  })
  ipcMain.handle("desktop:draft-read", async (event, sessionId) => {
    trusted(event)
    if(!draftSession||draftSession.owner!==event.sender.id||draftSession.id!==z.uuid().parse(sessionId))throw new Error("草稿所属窗口已变化")
    const snapshot=await draftJournal.read()
    trusted(event)
    if(draftSession?.id!==sessionId)throw new Error("草稿所属窗口已变化")
    return snapshot
  })
  ipcMain.handle("desktop:clipboard-write", async (event, input) => {
    trusted(event)
    if(!window?.isFocused())throw new Error("应用窗口未聚焦")
    const text=z.string().max(1024*1024).parse(input)
    await clipboard.writeText(text)
  })
  ipcMain.handle("desktop:input-context-menu", async (event, input) => {
    trusted(event)
    const state=inputContextStateSchema.parse(input),current=window
    if(!current?.isFocused()||closingFlow||businessGate.closed)return null
    const command=await inputContextMenus.open(current,state)
    trusted(event)
    return window===current&&current.isFocused()&&!closingFlow&&!businessGate.closed ? command : null
  })
  ipcMain.handle("desktop:clipboard-read", async event => {
    trusted(event)
    if(!window?.isFocused())throw new Error("应用窗口未聚焦")
    const text=await clipboard.readText()
    trusted(event)
    if(!window?.isFocused())throw new Error("应用窗口未聚焦")
    if(text.length>1024*1024)throw new Error("剪贴板内容过长")
    return text
  })
  businessHandle("desktop:bootstrap", async event => {
    trusted(event)
    const current=draftSession
    if(!current||current.owner!==event.sender.id)throw new Error("草稿所属窗口已变化")
    const state=await repository.read();trusted(event)
    if(draftSession!==current)throw new Error("草稿所属窗口已变化")
    return {...state,platform:process.platform,version:app.getVersion(),dataRoot,draftSessionId:current.id,systemDark:nativeTheme.shouldUseDarkColors}
  })
  businessHandle("desktop:directory", async (event, purpose) => { trusted(event); return chooseDirectory(directoryPurpose.parse(purpose), String(event.sender.id)) })
  businessHandle("desktop:model-discover", async (event, id, draft) => { trusted(event); return modelConfiguration.discover(String(event.sender.id), z.uuid().parse(id), draft) })
  businessHandle("desktop:model-test", async (event, id, draft) => { trusted(event); return modelConfiguration.test(String(event.sender.id), z.uuid().parse(id), draft, { authorizeCharge: true }) })
  ipcMain.handle("desktop:model-cancel", async (event, id) => { trusted(event); modelConfiguration.cancel(String(event.sender.id), z.uuid().parse(id)) })
  ipcMain.handle("desktop:avatar-choose", async (event, id, acceptedDraftId) => {
    trusted(event)
    const parsed=z.object({sessionId:z.uuid(),acceptedDraftId:z.uuid().nullable().optional()}).strict().safeParse({sessionId:id,acceptedDraftId})
    if(!parsed.success)throw new Error("头像编辑会话无效")
    const {sessionId}=parsed.data,owner=String(event.sender.id)
    if(businessGate.closed)throw new Error("BUSINESS_CLOSED")
    // Allocate the picker epoch when IPC is received, before the business work
    // microtask. A subsequent hide can then cancel even this queued picker.
    avatarAssets.begin(owner,sessionId)
    const selection = avatarAssets.beginSelection(owner,sessionId,parsed.data.acceptedDraftId)
    return businessGate.run(async()=>{
      avatarAssets.assertSelectionActive(owner,sessionId,selection)
      const selected = await dialog.showOpenDialog(window!, { title: "选择头像", properties: ["openFile"], filters: [{ name: "头像图片", extensions: ["png","jpg","jpeg","webp"] }] })
      trusted(event);avatarAssets.assertSelectionActive(owner,sessionId,selection)
      if (selected.canceled || !selected.filePaths[0]) return null
      return avatarAssets.stageSelected(owner,sessionId,selected.filePaths[0],selection)
    })
  })
  ipcMain.handle("desktop:avatar-cancel", async (event, id) => { trusted(event); avatarAssets.cancel(String(event.sender.id),z.uuid().parse(id)) })
  ipcMain.handle("desktop:avatar-selection-cancel", async (event, input) => {
    trusted(event)
    const parsed=z.object({sessionId:z.uuid(),draftId:z.uuid().nullable()}).strict().safeParse(input)
    if(!parsed.success)throw new Error("头像编辑会话无效")
    avatarAssets.cancelSelection(String(event.sender.id),parsed.data.sessionId,parsed.data.draftId)
  })
  businessHandle("desktop:settings", async (event, input: SettingsAction) => {
    trusted(event)
    const envelope = z.object({ type: z.enum(["update", "save-profile", "save-model", "remove-model"]), revision: z.number().int().nonnegative() }).passthrough().parse(input)
    let state: Awaited<ReturnType<ModelRepository["read"]>>
    if (envelope.type === "save-profile") {
      const profile = z.object({ type:z.literal("save-profile"), revision:z.number().int().nonnegative(), sessionId:z.uuid(), user:settingsSchema.shape.user, avatarDraftId:z.uuid().optional() }).strict().parse(input)
      const owner = String(event.sender.id)
      avatarAssets.begin(owner,profile.sessionId)
      const before = await repository.read()
      avatarAssets.assertActive(owner,profile.sessionId)
      if (before.revision !== profile.revision) throw new RevisionConflict()
      if (profile.user.avatarAssetId !== before.settings.user.avatarAssetId) throw new Error("用户资料已变更，请重新打开后保存")
      const avatar = profile.avatarDraftId ? await avatarAssets.persistDraft(owner,profile.sessionId,profile.avatarDraftId) : null
      avatarAssets.assertActive(owner,profile.sessionId,profile.avatarDraftId)
      state = await repository.updateSettings(profile.revision,{...before.settings,user:{...profile.user,avatarAssetId:avatar?.assetId ?? profile.user.avatarAssetId}})
      avatarAssets.cancel(owner,profile.sessionId,profile.avatarDraftId)
    } else if (envelope.type === "update") {
      const settings = settingsSchema.parse((input as Extract<SettingsAction,{type:"update"}>).settings)
      const before = await repository.read()
      if (JSON.stringify(settings.user) !== JSON.stringify(before.settings.user)) throw new Error("用户资料需要在编辑用户对话框中保存")
      state = await repository.updateSettings(envelope.revision,settings)
    } else if (envelope.type === "save-model") state = await repository.saveModel(envelope.revision,(input as Extract<SettingsAction,{type:"save-model"}>).model)
    else state = await repository.removeModel(envelope.revision,z.uuid().parse((input as Extract<SettingsAction,{type:"remove-model"}>).id))
    window?.webContents.setZoomFactor(state.settings.appearance.zoom)
    send({ type: "state", state }); return state
  })
  businessHandle("desktop:onboarding", async (event, input: unknown) => {
    const parsed=onboardingActionSchema.safeParse(input)
    if(!parsed.success)throw new OnboardingError("INVALID_ACTION")
    const action=parsed.data,currentWindow=window,currentSession=draftSession
    const active=()=>{
      try{trusted(event)}catch{throw new OnboardingError("OWNER_UNAVAILABLE")}
      if(!currentWindow||currentWindow.isDestroyed()||window!==currentWindow||!currentSession?.ready||draftSession!==currentSession||
        currentSession.owner!==event.sender.id||currentSession.id!==action.sessionId||closingFlow||quitting||businessGate.closed||migrationHandoff?.pending||workLease?.pending)
        throw new OnboardingError("OWNER_UNAVAILABLE")
    }
    active()
    const state=await onboardingService.commit(String(event.sender.id),action,active)
    active();currentWindow!.webContents.setZoomFactor(state.settings.appearance.zoom)
    send({type:"state",state});return state
  })
  ipcMain.handle("desktop:command", async (event, id) => { trusted(event); await executeCommand(z.string().max(100).parse(id),true) })
  ipcMain.handle("desktop:cancel", async (event, id) => { trusted(event); z.uuid().parse(id); const active = responseOwners.get(id); if (active?.owner === event.sender.id) await active.cancel() })
  businessHandle("desktop:request", async (event, value) => {
    trusted(event); const input = requestSchema.parse(value)
    if (responseOwners.size >= 256) throw new Error("本地请求过多，请稍后重试")
    if (responseOwners.has(input.id)) throw new Error("请求编号重复")
    let response: LocalResponse; let local: Uint8Array | undefined
    let canceled = false; let started = false; let port: Electron.MessagePortMain | undefined
    let requestOrigin:ConversationRequestOrigin|undefined
    let canceling: Promise<void> | undefined
    const active = { owner: event.sender.id, cancel: () => {
      if (canceling) return canceling
      canceled = true
      if(requestOrigin)conversationDirectories.endRequest(requestOrigin)
      canceling = Promise.resolve().then(async () => {
        port?.close()
        try { if (started) await service.call("cancel", input.id) }
        finally { if (port && responseOwners.get(input.id) === active) responseOwners.delete(input.id) }
      })
      return canceling
    } }
    responseOwners.set(input.id, active)
    const check = () => { if (canceled || event.sender.isDestroyed() || businessGate.closed) throw new Error("本地请求已取消") }
    try {
    const pathname = new URL(input.path,"https://local.invalid").pathname
    if (pathname === "/api/novels" && input.method === "POST") {
      const grant = await chooseDirectory("create-work", String(event.sender.id))
      check()
      if (!grant) { response = { id: input.id, status: 409, headers: { "content-type": "application/json" } }; local = new TextEncoder().encode(JSON.stringify({ error: "已取消目录选择，创作草稿已保留", code: "DIRECTORY_SELECTION_CANCELLED" })) }
      else {
        const selection = await authority.consume(grant.id, "create-work", String(event.sender.id))
        check()
        check()
        const created = await service.call("create-work", { selection, input: JSON.parse(new TextDecoder().decode(Uint8Array.from(input.body ?? []))) })
        response = { id: input.id, status: 201, headers: { "content-type": "application/json" } }; local = new TextEncoder().encode(JSON.stringify(created))
      }
    } else if (["/api/models", "/api/image-models"].includes(pathname) && input.method === "GET") {
      const state = await repository.read(); const kind = pathname === "/api/models" ? "TEXT" : "IMAGE"
      response = { id: input.id, status: 200, headers: { "content-type": "application/json" } }
      local = new TextEncoder().encode(JSON.stringify({ defaultModelId: kind === "TEXT" ? state.settings.agent.textModelId : state.settings.agent.imageModelId, models: state.models.filter(model => model.kind === kind && model.enabled).map(model => ({ ...model, tier: "NORMAL", free: false, thinkingEfforts: model.thinkingLevels.filter(level => level !== "default").map(level => ({ value: level, label: level })) })) }))
    } else {
      check()
      if(pathname==="/api/chat"&&input.method==="POST"){
        const capturedWindow=window,capturedSession=draftSession
        requestOrigin=conversationDirectories.begin(input.id,String(event.sender.id),()=>{
          trusted(event)
          if(!capturedWindow||window!==capturedWindow||capturedWindow.isDestroyed()||!capturedSession?.ready||draftSession!==capturedSession||capturedSession.owner!==event.sender.id||closingFlow||businessGate.closed||quitting)throw Error("目录授权所属任务窗口已变化")
        })
      }
      started = true; response = await service.call<LocalResponse>("start",requestOrigin?{request:input,origin:requestOrigin}:input)
    }
    check()
    const channel = new MessageChannelMain(); let seq = 0; let reading = false
    port = channel.port1
    port.on("close", () => { if (responseOwners.get(input.id) === active) void active.cancel().catch(() => undefined) })
    const cancel = active.cancel
    channel.port1.on("message", async ({ data }) => {
      if (reading || data?.type !== "pull" || data.seq !== seq) { responseOwners.delete(input.id); await cancel().catch(() => undefined); return }
      reading = true
      try {
        let frame: { done: boolean; bytes?: Uint8Array }
        if (local) { frame = local.length ? { done: false, bytes: local.slice(0, 65536) } : { done: true }; local = local.slice(65536) }
        else frame = await service.call("read", input.id)
        channel.port1.postMessage({ ...frame, seq: seq++ })
        if (frame.done) { if(requestOrigin)conversationDirectories.endRequest(requestOrigin);responseOwners.delete(input.id); channel.port1.close() }
      } catch { channel.port1.postMessage({ error: "本地响应读取失败，请重试", seq: seq++ }); responseOwners.delete(input.id); await cancel().catch(() => undefined) }
      finally { reading = false }
    })
    channel.port1.start(); event.sender.postMessage("desktop:response-port", { id: input.id }, [channel.port2])
    return response
    } catch (error) {
      await active.cancel().catch(() => undefined)
      if (responseOwners.get(input.id) === active) responseOwners.delete(input.id)
      throw error
    }
  })
}
function menuTemplate(): MenuItemConstructorOptions[] {
  const roles: Record<string, MenuItemConstructorOptions["role"]> = { "app.services": "services", "app.hide": "hide", "app.hideOthers": "hideOthers", "app.showAll": "unhide", "window.minimize": "minimize", "window.front": "front" }
  return desktopMenu(process.platform === "darwin" ? "darwin" : "win32",menuShortcuts).map(group => ({
    id:`menu.${group.id}`, label:group.label, submenu:group.items.map(command => {
      const accelerator=electronAccelerator(command.binding)
      return { id:command.id, label:command.label + (command.binding && !accelerator ? `（${command.binding}）` : ""), role:roles[command.id], enabled:command.enabled, accelerator,
        click:() => { void executeCommand(command.id).catch(() => dialog.showErrorBox("操作未完成","请检查当前窗口或任务状态后重试。")) } }
    }),
  }))
}
function applyMainWindowAppearance() {
  syncNativeThemeSource(nativeTheme, windowTheme)
  applyWindowAppearance(window, process.platform, windowTheme, nativeTheme.shouldUseDarkColors)
}
function refreshMenus(state: Awaited<ReturnType<ModelRepository["read"]>>) {
  if (state.revision < menuRevision) return
  menuRevision=state.revision
  windowTheme=state.settings.appearance.theme
  applyMainWindowAppearance()
  menuShortcuts=structuredClone(state.settings.shortcuts[process.platform === "darwin" ? "darwin" : "win32"])
  if (process.platform === "darwin" && app.isReady()) Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate()))
}
async function executeCommand(id: string, fromRenderer=false) {
  if((closingFlow||businessGate.closed)&&!["app.quit","window.close"].includes(id))return
  if (id === "app.menu") { if (window) Menu.buildFromTemplate(menuTemplate()).popup({ window }); return }
  if (!commands.commands.some(command => command.id === id)) throw new Error("未知应用命令")
  // Editing is owned by the retained renderer target; never queue native edits
  // against whichever field happens to be focused when IPC reaches main.
  if (fromRenderer && id.startsWith("text.")) {
    throw new Error("文本编辑命令必须由当前输入控件执行")
  }
  if(id.startsWith("menu.")){
    if(window){const group=menuTemplate().find(group=>group.id===id);if(group&&Array.isArray(group.submenu))Menu.buildFromTemplate(group.submenu).popup({window})}
    return
  }
  if(id==="app.hide"){if(process.platform==="darwin")app.hide();return}
  if(id==="app.hideOthers"){if(process.platform==="darwin")Menu.sendActionToFirstResponder("hideOtherApplications:");return}
  if(id==="app.showAll"){if(process.platform==="darwin")Menu.sendActionToFirstResponder("unhideAllApplications:");return}
  if(id==="window.front"){for(const owned of BrowserWindow.getAllWindows())owned.moveTop();return}
  if (id === "app.quit") { app.quit(); return }
  if (id === "window.close") { window?.close(); return }
  if (id === "window.minimize") { window?.minimize(); return }
  if (id === "window.maximize") { if (window?.isMaximized()) window.unmaximize(); else window?.maximize(); return }
  if (id === "view.fullscreen") { window?.setFullScreen(!window.isFullScreen()); return }
  if (id === "help.docs") return
  if (id === "help.feedback") { await shell.openExternal("https://github.com/mySingleLive/xaanink-desktop/issues/new/choose"); return }
  if (id === "app.about") {
    if (process.platform === "darwin") { app.setAboutPanelOptions({ applicationName: "玄印写作", applicationVersion: app.getVersion(), copyright: "GPL-3.0 · XaanInk" }); app.showAboutPanel() }
    else {
      const about = new BrowserWindow({ width: 400, height: 260, resizable: false, minimizable: false, maximizable: false, parent: window ?? undefined, modal: true, title: "关于玄印写作", webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
      about.setMenu(null); await about.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(`<html lang="zh-CN"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>关于玄印写作</title><body style="font:15px system-ui;text-align:center;margin:0;padding:20px"><h1 style="font-size:26px;margin:0 0 12px">玄印写作</h1><p>版本 ${app.getVersion()}</p><p>本地创作，由你的模型驱动</p><p>GPL-3.0 · XaanInk</p></body></html>`))
    }
    return
  }
  if (id === "file.open") {
    await businessGate.run(async()=>{
      const owner=String(window?.webContents.id),current=window
      const grant=await chooseDirectory("open-work",owner)
      if(!grant)return
      if(closingFlow||businessGate.closed||window!==current||!current||current.isDestroyed())throw Error("作品所属窗口已变化或正在关闭")
      const proof=await authority.consume(grant.id,"open-work",owner)
      if(closingFlow||businessGate.closed||window!==current||current.isDestroyed())throw Error("作品所属窗口已变化或正在关闭")
      await service.call("open-work",proof);send({type:"command",id:"works.refresh"})
    })
    return
  }
  send({ type: "command", id })
}
async function createWindow() {
  // A macOS window-only close drained the services, but did not quit the app.
  // Reopening may resume them only after any durable migration handoff is gone.
  if(businessGate.closed){
    if(closingFlow||migrationHandoff?.pending||workLease?.pending||quitting)throw Error("工作台仍在关闭或等待维护交接")
    await restoreBusiness()
  }
  modelService.resume()
  const state = await repository.read()
  refreshMenus(state)
  const nativeAppearance = nativeWindowAppearance(state.settings.appearance.theme, nativeTheme.shouldUseDarkColors)
  window = new BrowserWindow({ width: 1440, height: 940, minWidth: 760, minHeight: 580, show: false, title: "玄印写作", backgroundColor: nativeAppearance.backgroundColor, titleBarStyle: "hidden", trafficLightPosition: { x: 14, y: 14 }, ...(process.platform === "win32" ? { titleBarOverlay: nativeAppearance.titleBarOverlay } : {}), webPreferences: { preload: join(__dirname, "../preload/index.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true } })
  const current = window
  if (process.platform === "win32") installWindowsCloseAccent(current, { BaseWindow, ImageView, nativeImage, screen }, nativeAppearance.titleBarOverlay.symbolColor)
  current.webContents.setZoomFactor(state.settings.appearance.zoom)
  // Keyboard bindings are resolved once in the renderer, including secondary
  // bindings, chords, IME and shortcut recording. Native menus remain clickable.
  current.webContents.setIgnoreMenuShortcuts(true)
  const ownerId = current.webContents.id
  current.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
  current.webContents.on("will-navigate", event => event.preventDefault())
  current.webContents.on("will-attach-webview", event => event.preventDefault())
  const releaseOwner = () => {
    conversationDirectories.revokeOwner(String(ownerId))
    closeChannel.cancel()
    recoveryExports.cancelWindow(`${ownerId}:`)
    fileExports.cancelWindow(`${ownerId}:`)
    configurationFiles.cancelWindow(`${ownerId}:`)
    if(draftSession?.owner===ownerId){void workLease?.cancel().catch(()=>{});draftSession.release();draftSession=null}
    authority.revokeOwner(String(ownerId))
    modelConfiguration.cancelOwner(String(ownerId))
    avatarAssets.cancelOwner(String(ownerId))
    for (const response of responseOwners.values()) if (response.owner === ownerId) void response.cancel().catch(() => undefined)
  }
  current.webContents.on("render-process-gone", releaseOwner)
  current.webContents.on("destroyed", releaseOwner)
  current.webContents.on("did-start-navigation", (details,legacyUrl,legacySameDocument,legacyMainFrame) => {
    const mainFrame=details.isMainFrame??legacyMainFrame,sameDocument=details.isSameDocument??legacySameDocument
    // Hydration/history updates retain this document's task capabilities. Only
    // a new (or unknown) main document revokes them and creates a fresh session.
    if(mainFrame!==false&&sameDocument!==true){releaseOwner();if((details.url??legacyUrl)==="xaanink://app/")draftSession={owner:ownerId,id:randomUUID(),ready:false,release:draftJournal.activate(String(ownerId))}}
  })
  current.on("closed", () => { releaseOwner(); if (window === current) window = null })
  current.on("close",event=>{if(quitting||closePermits.delete(current))return;event.preventDefault();beginClose(process.platform==="win32"?"quit":"window")})
  refreshMenus(state)
  if (process.platform !== "darwin") current.setMenu(null)
  current.once("ready-to-show", () => current.show())
  await current.loadURL("xaanink://app/")
}

if(!startupPaths){
  void app.whenReady().then(()=>{dialog.showErrorBox("玄印写作无法启动","本地数据未能安全打开。原文件已保留，请检查目录和权限。");app.exit(1)})
}
else if (!app.requestSingleInstanceLock()) app.quit()
else {
  const start=()=>{
    assertNoLegacyBackupRecovery(bootstrapPath,()=>{if(!app.hasSingleInstanceLock())throw Error("LOCK_REQUIRED")})
    const relocation=rootRelocationPreflight(bootstrapPath)
    if(relocation.mode!=="none")return launchRootRelocation(bootstrapPath,relocation)
    if(rootMaintenanceRequired(bootstrapPath))return launchRootMaintenance(bootstrapPath,startupPaths!.defaultRoot)
    if(inboxLeaseRecoveryRequired(relocation.pointer))return launchInboxLeaseRecovery(bootstrapPath,()=>{
      if(worker||window||repository||modelService||BrowserWindow.getAllWindows().length)throw Error("ORDINARY_HOST_ALREADY_STARTED")
      assertNoLegacyBackupRecovery(bootstrapPath,()=>{if(!app.hasSingleInstanceLock())throw Error("LOCK_REQUIRED")})
      if(rootRelocationPreflight(bootstrapPath).mode!=="none"||rootMaintenanceRequired(bootstrapPath))throw Error("ROOT_MAINTENANCE_REQUIRED")
    })
    return launch()
  }
  const failed=async(error:unknown)=>{
    if(failedRootBeforeSession&&worker&&BrowserWindow.getAllWindows().length===0){
      try{await worker.terminate();if(!ordinaryWorkerExited)throw Error("WORKER_EXIT_UNCONFIRMED")}catch(cause){if(isolatedRoot)console.error(cause)}
    }
    if (isolatedRoot) console.error(error)
    const legacy=error instanceof Error&&error.message.startsWith("LEGACY_BACKUP_RECOVERY")
    dialog.showErrorBox("玄印写作无法启动",legacy?"检测到旧版本未完成或无法确认的数据恢复记录。原文件已保留，请通过项目问题反馈寻求处理。":"本地数据未能安全打开。原文件已保留，请检查目录和权限。")
    app.exit(1)
  }
  try{void start().catch(failed)}catch(error){void failed(error)}
}
