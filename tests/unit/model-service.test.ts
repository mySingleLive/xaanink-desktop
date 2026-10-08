import assert from "node:assert/strict"
import { test } from "node:test"
import { randomUUID } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ModelRepository, type ModelDraft } from "../../desktop/main/model-repository"
import { ModelGateway } from "../../desktop/core/model-authorization"
import { ModelService } from "../../desktop/main/model-service"
const draft: ModelDraft = { name: "自选模型", provider: "custom", protocol: "openai", modelId: "fixture-text", endpoint: "https://fixture.invalid/v1", kind: "TEXT", contextWindow: 128000, enabled: true, thinkingLevels: [], defaultThinking: "default", apiKey: "fixture-main-only-secret" }
const protection = { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() }
test("DESK-M12/M13: worker transport receives public metadata and streams, while final network alone receives the key", async () => {
  const root = await mkdtemp(join(tmpdir(), "xuanxiang-model-service-"))
  let repository!: ModelRepository; let calls = 0; let sentKey = ""
  const gateway = new ModelGateway({ keyFor: (id, rev) => repository.keyFor(id, rev), fetch: async (_url, init) => { calls++; sentKey = new Headers(init?.headers).get("authorization")!; return new Response("fixture answer") } })
  repository = new ModelRepository(join(root, "state.json"), protection, gateway)
  const service = new ModelService(repository, gateway)
  try {
    let state = await repository.saveModel(0, draft)
    await assert.rejects(service.resolve({ role: "text" }), /MODEL_NOT_SELECTED/)
    const model = await service.resolve({ role: "text", id: state.models[0].id })
    assert.equal(JSON.stringify(model).includes(draft.apiKey), false)
    const request = { id: randomUUID(), modelId: model.id, authRevision: model.authRevision, kind: model.kind, url: model.endpoint + "/chat/completions", method: "POST", headers: { Authorization: "not-a-real-key" }, body: JSON.stringify({ model: model.modelId }) }
    assert.equal((await service.start(request)).status, 200)
    assert.equal(sentKey, "Bearer " + draft.apiKey)
    const chunk = await service.read(request.id)
    assert.equal(new TextDecoder().decode(chunk.bytes), "fixture answer")
    assert.equal((await service.read(request.id)).done, true)
    state = await repository.saveModel(state.revision, { ...draft, id: model.id, apiKey: "rotated-fixture" })
    await assert.rejects(service.start({ ...request, id: randomUUID() }), /AUTHORIZATION_REVOKED/)
    assert.equal(calls, 1)
    await assert.rejects(service.resolve({ role: "image", id: model.id }), /MODEL_KIND_MISMATCH/)
    await repository.removeModel(state.revision, model.id)
    await assert.rejects(service.resolve({ role: "text", id: model.id }), /MODEL_NOT_FOUND/)
  } finally { await service.close(); await rm(root, { recursive: true, force: true }) }
})
test("IPC-02: cancel while model headers are pending aborts the request and never reuses its live id", async () => {
  const root = await mkdtemp(join(tmpdir(), "xuanxiang-model-cancel-")); let repository!: ModelRepository
  const entered = Promise.withResolvers<void>(); const continueFetch = Promise.withResolvers<void>(); let aborted = false
  const gateway = new ModelGateway({ keyFor: (id, rev) => repository.keyFor(id, rev), fetch: async (_url, init) => { entered.resolve(); init?.signal?.addEventListener("abort", () => { aborted = true }); await continueFetch.promise; return new Response("late result") } })
  repository = new ModelRepository(join(root, "state.json"), protection, gateway); const service = new ModelService(repository, gateway)
  try {
    const state = await repository.saveModel(0, draft); const model = state.models[0]
    const input = { id: randomUUID(), modelId: model.id, authRevision: model.authRevision, kind: model.kind, url: model.endpoint + "/chat/completions", method: "POST", headers: {}, body: JSON.stringify({ model: model.modelId }) }
    const pending = service.start(input); await entered.promise
    await service.cancel(input.id)
    await assert.rejects(service.start(input), /重复/)
    continueFetch.resolve(); await assert.rejects(pending, /AUTHORIZATION_REVOKED/)
    assert.equal(aborted, true)
  } finally { continueFetch.resolve(); await service.close(); await rm(root, { recursive: true, force: true }) }
})
test("window close pauses model invocation and an explicit reopen can resume without retaining old transfers",async()=>{
 const root=await mkdtemp(join(tmpdir(),"xuanxiang-model-reopen-"));let repository!:ModelRepository,calls=0
 const gateway=new ModelGateway({keyFor:(id,rev)=>repository.keyFor(id,rev),fetch:async()=>{calls++;return new Response("isolated answer")}})
 repository=new ModelRepository(join(root,"state.json"),protection,gateway);const service=new ModelService(repository,gateway)
 try{
  const state=await repository.saveModel(0,draft),model=state.models[0],input={id:randomUUID(),modelId:model.id,authRevision:model.authRevision,kind:model.kind,url:model.endpoint+"/chat/completions",method:"POST",headers:{},body:JSON.stringify({model:model.modelId})}
  await service.start(input);assert.equal(service.activeCount,1);await service.close();assert.equal(service.activeCount,0)
  await assert.rejects(service.start({...input,id:randomUUID()}),/关闭/);assert.equal(calls,1)
  service.resume();await service.start({...input,id:randomUUID()});assert.equal(service.activeCount,1);assert.equal(calls,2)
 }finally{await service.close();await rm(root,{recursive:true,force:true})}
})
