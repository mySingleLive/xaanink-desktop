import { createHash, randomUUID } from "node:crypto"
import { CommitDurabilityError, RevisionConflict, VersionedStore, type Snapshot, type StoreOptions } from "../core/versioned-store"
import { defaultState, stateSchema, publicState, settingsSchema, modelSchema, type AppState, type StoredModel, type Settings } from "../core/settings"
import { validateModelEndpoint, type ModelGateway } from "../core/model-authorization"
import { onboardingActionSchema, OnboardingError, type OnboardingAction, type OnboardingProgress } from "../shared/onboarding"
import type { StateSnapshot } from "../shared/ipc"

export interface SecretProtection { isEncryptionAvailable(): boolean; encryptString(value: string): Buffer; decryptString(value: Buffer): string }
export type ModelDraft = Omit<StoredModel, "id" | "authRevision" | "encryptedKey" | "keyMask"> & { id?: string; apiKey: string }

/** Main-process owner: only this object receives Electron safeStorage. */
export class ModelRepository {
  private readonly store: VersionedStore<AppState>
  private published = new Set<string>()
  private readonly onboardingIdentities = new Map<string,{fingerprint:string;accepted:boolean;pending?:Promise<ReturnType<typeof publicState>&{revision:number}>}>()
  private onboardingQueue:Promise<unknown> = Promise.resolve()
  private readonly operationLimit:number
  constructor(readonly path: string, private readonly protection: SecretProtection, private readonly gateway: Pick<ModelGateway, "replace" | "remove">, storeOptions: StoreOptions = {}, onboardingOptions:{operationLimit?:number}={}) {
    this.store = new VersionedStore(path, defaultState, stateSchema.parse, storeOptions)
    this.operationLimit=onboardingOptions.operationLimit??4096
    if(!Number.isSafeInteger(this.operationLimit)||this.operationLimit<1||this.operationLimit>4096)throw new Error("引导操作边界无效")
  }
  async read():Promise<StateSnapshot> { const state = await this.store.read(); return { revision: state.revision, ...publicState(state.value) } }
  private assertProtection() {
    try { if (this.protection.isEncryptionAvailable()) return } catch { /* OS errors must not escape. */ }
    throw new Error("系统密钥保护不可用，无法加密或解密")
  }
  private encrypt(key: string) {
    try { return this.protection.encryptString(key).toString("base64") }
    catch { throw new Error("系统密钥加密失败，原配置已保留") }
  }
  private publish(state: AppState) {
    const ids = new Set(state.models.map(model => model.id))
    for (const id of this.published) if (!ids.has(id)) this.gateway.remove(id)
    for (const model of state.models) this.gateway.replace({ id: model.id, authRevision: model.authRevision, endpoint: model.endpoint, kind: model.kind, enabled: model.enabled,
      protocol: model.provider === "google" && model.kind === "IMAGE" ? "google" : model.protocol })
    this.published = ids
  }
  async initialize(assertCurrent:()=>void=()=>{}) {
    assertCurrent()
    const state = await this.store.read()
    assertCurrent()
    this.publish(state.value)
    const current = await this.read()
    assertCurrent()
    return current
  }
  private async commit(revision: number, value: AppState, beforeCommit?:()=>void): Promise<Snapshot<AppState>> {
    try {
      const saved = await this.store.update(revision, value, beforeCommit)
      this.publish(saved.value)
      return saved
    } catch (error) {
      // rename may have committed despite a directory-fsync failure. Reconcile
      // authorization with the authoritative bytes before returning an error.
      if (error instanceof CommitDurabilityError) this.publish((await this.store.read()).value)
      throw error
    }
  }
  async keyFor(id: string, revision: number): Promise<string> {
    const state = await this.store.read()
    const model = state.value.models.find(item => item.id === id && item.authRevision === revision && item.enabled)
    if (!model) throw new Error("模型授权已失效")
    this.assertProtection()
    try { return this.protection.decryptString(Buffer.from(model.encryptedKey, "base64")) }
    catch { throw new Error("系统密钥解密失败，请重新配置此模型") }
  }
  private prepareModel(current:AppState,draft:ModelDraft,creationId?:string):StoredModel {
    this.assertProtection()
    validateModelEndpoint(draft.endpoint)
    const prior = draft.id ? current.models.find(model => model.id === draft.id) : undefined
    if (draft.id && !prior) throw new Error("模型不存在，请重新读取")
    const changedScope = prior && (prior.endpoint !== draft.endpoint || prior.protocol !== draft.protocol || prior.provider !== draft.provider || prior.kind !== draft.kind)
    const { apiKey, id: _id, ...properties } = draft
    const key = apiKey.trim()
    if (key.length > 8192 || /[\r\n\0]/.test(key)) throw new Error("API Key格式无效")
    if (!key && (!prior || changedScope)) throw new Error("请为此供应商和端点输入API Key")
    const revoked = !!key || changedScope || (prior && (prior.enabled !== draft.enabled || prior.modelId !== draft.modelId))
    const next = modelSchema.parse({ ...properties, id: prior?.id ?? creationId ?? randomUUID(), authRevision: prior ? prior.authRevision + (revoked ? 1 : 0) : 1,
      encryptedKey: key ? this.encrypt(key) : prior!.encryptedKey,
      keyMask: "••••••••" })
    if (next.defaultThinking !== "default" && !next.thinkingLevels.includes(next.defaultThinking)) throw new Error("模型默认思考档位不在支持列表中")
    if (next.thinkingLevels.some(level => !level || level.length > 30) || new Set(next.thinkingLevels).size !== next.thinkingLevels.length) throw new Error("模型思考档位列表无效")
    if (current.models.some(model => model.id !== next.id && model.provider === next.provider && model.endpoint === next.endpoint && model.kind === next.kind && model.modelId === next.modelId)) throw new Error("这个模型已经添加")
    return next
  }
  async saveModel(revision: number, draft: ModelDraft) {
    const current = await this.store.read()
    const prior=draft.id?current.value.models.find(model=>model.id===draft.id):undefined
    const next=this.prepareModel(current.value,draft)
    const settings = structuredClone(current.value.settings)
    if (settings.agent.textModelId === next.id && (prior?.enabled !== next.enabled || (settings.agent.thinking !== "default" && !next.thinkingLevels.includes(settings.agent.thinking)))) settings.agent.thinking = "default"
    const saved = await this.commit(revision, { ...current.value, settings, models: [...current.value.models.filter(model => model.id !== next.id), next] })
    return { revision: saved.revision, ...publicState(saved.value) }
  }
  async removeModel(revision: number, id: string) {
    const current = await this.store.read()
    if (!current.value.models.some(model => model.id === id)) throw new Error("模型不存在，请重新读取")
    const settings = structuredClone(current.value.settings)
    for (const key of ["textModelId", "reviewModelId", "imageModelId"] as const) if (settings.agent[key] === id) settings.agent[key] = null
    if (current.value.settings.agent.textModelId === id) settings.agent.thinking = "default"
    const saved = await this.commit(revision, { ...current.value, settings, models: current.value.models.filter(model => model.id !== id) })
    return { revision: saved.revision, ...publicState(saved.value) }
  }
  async updateSettings(revision: number, settings: Settings, beforeCommit?:()=>void) {
    const state = await this.store.read(); const validated = settingsSchema.parse(settings)
    for (const key of ["textModelId", "reviewModelId", "imageModelId"] as const) {
      const id = validated.agent[key]
      if (!id || id === state.value.settings.agent[key]) continue
      const kind = key === "imageModelId" ? "IMAGE" : "TEXT"
      if (!state.value.models.some(model => model.id === id && model.kind === kind && model.enabled)) throw new Error("请选择已添加且启用的对应模型")
    }
    const text = state.value.models.find(model => model.id === validated.agent.textModelId && model.kind === "TEXT")
    if (validated.agent.thinking !== "default" && !text?.thinkingLevels.includes(validated.agent.thinking)) {
      if (validated.agent.textModelId !== state.value.settings.agent.textModelId) validated.agent.thinking = "default"
      else throw new Error("此模型不支持所选思考强度")
    }
    const saved = await this.commit(revision, { ...state.value, settings: validated }, beforeCommit)
    return { revision: saved.revision, ...publicState(saved.value) }
  }
  /** One durable replacement includes model/profile, defaults and progress.
   * Retry fingerprints live only in this main-process owner, never on disk. */
  commitOnboarding(input:OnboardingAction,beforeCommit:()=>void,prepareAvatar?:(before:AppState)=>Promise<string|null>) {
    const guard=()=>{try{beforeCommit()}catch{throw new OnboardingError("OWNER_UNAVAILABLE")}}
    let action:OnboardingAction
    try{guard();action=onboardingActionSchema.parse(input)}catch(error){return Promise.reject(error instanceof OnboardingError?error:new OnboardingError("INVALID_ACTION"))}
    const fingerprint=createHash("sha256").update(JSON.stringify(action)).digest("hex")
    let identity=this.onboardingIdentities.get(action.operationId)
    if(identity&&identity.fingerprint!==fingerprint)return Promise.reject(new OnboardingError("IDENTITY_CHANGED"))
    if(!identity){
      if(this.onboardingIdentities.size>=this.operationLimit)return Promise.reject(new OnboardingError("IDENTITY_LIMIT"))
      identity={fingerprint,accepted:false};this.onboardingIdentities.set(action.operationId,identity)
    }
    if(identity.pending)return identity.pending
    const frozenIdentity=identity
    const work=this.onboardingQueue.then(async()=>{
      try{
        guard();const before=await this.store.read();guard()
        const old=before.value.onboarding
        if(old?.receipt?.id===action.operationId){
          if(!frozenIdentity.accepted)throw new OnboardingError("RETRY_UNAVAILABLE")
          const confirmed=await this.commit(before.revision,before.value,guard);guard()
          return{revision:confirmed.revision,...publicState(confirmed.value)}
        }
        if(before.revision!==action.revision)throw new OnboardingError("REVISION_CONFLICT")
        let progress:OnboardingProgress=old?structuredClone(old):{version:1,completed:false,step:"theme",textModelId:null,imageModelId:null,receipt:null}
        if(action.flow==="full"&&progress.completed||action.flow==="models"&&!progress.completed)throw new OnboardingError("INVALID_TRANSITION")
        const value=structuredClone(before.value)
        const expect=(...steps:OnboardingProgress["step"][])=>{if(!steps.includes(progress.step))throw new OnboardingError("INVALID_TRANSITION")}
        let modelId:string|undefined
        frozenIdentity.accepted=true
        switch(action.type){
          case "theme": if(action.flow!=="full")throw new OnboardingError("INVALID_TRANSITION");expect("theme");value.settings.appearance.theme=action.theme;break
          case "next-theme": if(action.flow!=="full")throw new OnboardingError("INVALID_TRANSITION");expect("theme");progress.step="profile";break
          case "profile":{
            if(action.flow!=="full")throw new OnboardingError("INVALID_TRANSITION");expect("profile")
            if(action.user.avatarAssetId!==before.value.settings.user.avatarAssetId)throw new OnboardingError("AVATAR_UNAVAILABLE")
            if(action.avatarDraftId&&!prepareAvatar)throw new OnboardingError("AVATAR_UNAVAILABLE")
            const avatarAssetId=prepareAvatar?await prepareAvatar(before.value):action.user.avatarAssetId;guard()
            value.settings.user={...action.user,avatarAssetId};progress.step="text";break
          }
          case "start-models":
            if(action.flow!=="models")throw new OnboardingError("INVALID_TRANSITION")
            progress.step="text"
            if(progress.textModelId&&!value.models.some(model=>model.id===progress.textModelId&&model.kind==="TEXT"))progress.textModelId=null
            break
          case "model":{
            expect("text","image");const kind=progress.step==="text"?"TEXT":"IMAGE"
            let model:StoredModel
            if(action.selection.type==="existing"){
              const selectedId=action.selection.id
              const existing=value.models.find(item=>item.id===selectedId)
              if(!existing?.enabled||existing.kind!==kind)throw new OnboardingError("MODEL_UNAVAILABLE")
              model=existing
            }else{
              const {model:draft,creationId}=action.selection
              if(!draft.enabled||draft.kind!==kind)throw new OnboardingError("MODEL_UNAVAILABLE")
              if(draft.id){
                const prior=value.models.find(item=>item.id===draft.id)
                if(!prior||prior.kind!==kind)throw new OnboardingError("MODEL_UNAVAILABLE")
              }else if(value.models.some(item=>item.id===creationId))throw new OnboardingError("CREATION_COLLISION")
              model=this.prepareModel(value,draft,creationId)
              value.models=[...value.models.filter(item=>item.id!==model.id),model]
            }
            modelId=model.id
            if(kind==="TEXT"){
              value.settings.agent.textModelId=model.id;value.settings.agent.reviewModelId=model.id
              if(value.settings.agent.thinking!=="default"&&!model.thinkingLevels.includes(value.settings.agent.thinking))value.settings.agent.thinking="default"
              progress.textModelId=model.id;progress.step="image-choice"
            }else{value.settings.agent.imageModelId=model.id;progress.imageModelId=model.id;progress.completed=true;progress.step="welcome"}
            break
          }
          case "image-choice":
            expect("image-choice","image")
            if(action.choice==="configure"){expect("image-choice");progress.step="image"}
            else{progress.completed=true;progress.step="welcome"}
            break
          case "back":{
            const destination={profile:"theme",text:"profile","image-choice":"text",image:"image-choice"} as const
            if(!Object.hasOwn(destination,progress.step)||action.flow==="models"&&progress.step==="text")throw new OnboardingError("INVALID_TRANSITION")
            progress.step=destination[progress.step as keyof typeof destination];break
          }
        }
        progress.receipt={id:action.operationId,type:action.type,...(modelId?{modelId}:{})};value.onboarding=progress
        guard();const saved=await this.commit(action.revision,value,guard);guard()
        return{revision:saved.revision,...publicState(saved.value)}
      }catch(error){
        if(error instanceof OnboardingError)throw error
        if(error instanceof RevisionConflict)throw new OnboardingError("REVISION_CONFLICT")
        throw new OnboardingError("SAVE_FAILED")
      }
    })
    frozenIdentity.pending=work
    this.onboardingQueue=work.catch(()=>undefined)
    void work.finally(()=>{if(frozenIdentity.pending===work)frozenIdentity.pending=undefined}).catch(()=>{})
    return work
  }
}
