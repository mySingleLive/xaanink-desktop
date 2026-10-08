import { randomUUID } from "node:crypto"
import { CommitDurabilityError, VersionedStore, type Snapshot, type StoreOptions } from "../core/versioned-store"
import { defaultState, stateSchema, publicState, settingsSchema, modelSchema, type AppState, type StoredModel, type Settings } from "../core/settings"
import { validateModelEndpoint, type ModelGateway } from "../core/model-authorization"

export interface SecretProtection { isEncryptionAvailable(): boolean; encryptString(value: string): Buffer; decryptString(value: Buffer): string }
export type ModelDraft = Omit<StoredModel, "id" | "authRevision" | "encryptedKey" | "keyMask"> & { id?: string; apiKey: string }

/** Main-process owner: only this object receives Electron safeStorage. */
export class ModelRepository {
  private readonly store: VersionedStore<AppState>
  private published = new Set<string>()
  constructor(readonly path: string, private readonly protection: SecretProtection, private readonly gateway: Pick<ModelGateway, "replace" | "remove">, storeOptions: StoreOptions = {}) {
    this.store = new VersionedStore(path, defaultState, stateSchema.parse, storeOptions)
  }
  async read() { const state = await this.store.read(); return { revision: state.revision, ...publicState(state.value) } }
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
  async saveModel(revision: number, draft: ModelDraft) {
    this.assertProtection()
    validateModelEndpoint(draft.endpoint)
    const current = await this.store.read()
    const prior = draft.id ? current.value.models.find(model => model.id === draft.id) : undefined
    if (draft.id && !prior) throw new Error("模型不存在，请重新读取")
    const changedScope = prior && (prior.endpoint !== draft.endpoint || prior.protocol !== draft.protocol || prior.provider !== draft.provider || prior.kind !== draft.kind)
    const { apiKey, id: _id, ...properties } = draft
    const key = apiKey.trim()
    if (key.length > 8192 || /[\r\n\0]/.test(key)) throw new Error("API Key格式无效")
    if (!key && (!prior || changedScope)) throw new Error("请为此供应商和端点输入API Key")
    const revoked = !!key || changedScope || (prior && (prior.enabled !== draft.enabled || prior.modelId !== draft.modelId))
    const next = modelSchema.parse({ ...properties, id: prior?.id ?? randomUUID(), authRevision: prior ? prior.authRevision + (revoked ? 1 : 0) : 1,
      encryptedKey: key ? this.encrypt(key) : prior!.encryptedKey,
      keyMask: "••••••••" })
    if (next.defaultThinking !== "default" && !next.thinkingLevels.includes(next.defaultThinking)) throw new Error("模型默认思考档位不在支持列表中")
    if (next.thinkingLevels.some(level => !level || level.length > 30) || new Set(next.thinkingLevels).size !== next.thinkingLevels.length) throw new Error("模型思考档位列表无效")
    if (current.value.models.some(model => model.id !== next.id && model.provider === next.provider && model.endpoint === next.endpoint && model.kind === next.kind && model.modelId === next.modelId)) throw new Error("这个模型已经添加")
    const settings = structuredClone(current.value.settings)
    if (settings.agent.textModelId === next.id && (prior?.enabled !== next.enabled || (settings.agent.thinking !== "default" && !next.thinkingLevels.includes(settings.agent.thinking)))) settings.agent.thinking = "default"
    const saved = await this.commit(revision, { settings, models: [...current.value.models.filter(model => model.id !== next.id), next] })
    return { revision: saved.revision, ...publicState(saved.value) }
  }
  async removeModel(revision: number, id: string) {
    const current = await this.store.read()
    if (!current.value.models.some(model => model.id === id)) throw new Error("模型不存在，请重新读取")
    const settings = structuredClone(current.value.settings)
    for (const key of ["textModelId", "reviewModelId", "imageModelId"] as const) if (settings.agent[key] === id) settings.agent[key] = null
    if (current.value.settings.agent.textModelId === id) settings.agent.thinking = "default"
    const saved = await this.commit(revision, { settings, models: current.value.models.filter(model => model.id !== id) })
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
}
