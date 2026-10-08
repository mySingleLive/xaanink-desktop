import { configureModelTransport, localModelFetch } from "./models"
import { parentPort, workerData } from "node:worker_threads"
import { Workspaces } from "./workspaces"
import { LocalDispatcher } from "./dispatcher"
import { RpcPeer } from "./rpc"
import { type LocalRequest, type LocalResponse } from "../shared/ipc"
import type { DirectoryProof } from "../main/directory-authority"
import { prisma } from "../../src/lib/db"
import {localTemplateLibrary} from "./template-library"
import {closedWorkLeaseTarget} from "./closed-work-lease-target"
import { runWithNewTaskDefaults } from "./task-defaults"
import {abortAllLocalAttempts,localAttemptCount} from "../../src/lib/local-chat-cancellation"
import {setTimeout as delay} from "node:timers/promises"
import {localImageRequest} from "../shared/local-images"
import {currentWorkAssets} from "./image-assets"
import {randomUUID} from "node:crypto"
import { startOwnedRoot } from "./root-startup"
import { publishRootStartup, readRootStartup, ROOT_STARTUP_BYTES, RootStartupError, type RootStartupResult } from "../shared/root-startup"
import {parseConversationWorkerRequest} from './conversation-request'
import {configureConversationTransfers,recoverConversationTransfers} from './conversation-runtime'
import {getDatabaseContext,runInDatabaseContext} from './context'

if (!parentPort) throw new Error("Desktop service requires an isolated worker")
// Any retained Web path attempting a direct network call fails closed. SDKs use
// the explicitly injected main-process model gateway transport.
globalThis.fetch = localModelFetch
let works: Workspaces
let dispatcher: LocalDispatcher
interface ActiveResponse { reader: ReadableStreamDefaultReader<Uint8Array>; abort: AbortController; done: () => void; remainder?: Uint8Array; reading: boolean }
const responses = new Map<string, ActiveResponse>()
const starting = new Map<string, AbortController>()
const pendingStarts = new Set<Promise<void>>()
let closing = false
let closedForMaintenance = false
const ready = (async () => {
  let openedWorks: Workspaces | undefined
  try {
    if (workerData.bootstrap === undefined && workerData.startup instanceof SharedArrayBuffer && workerData.startup.byteLength === ROOT_STARTUP_BYTES) throw new RootStartupError("BOOTSTRAP_UNAVAILABLE")
    if (workerData.bootstrap !== undefined) readRootStartup(workerData.startup)
    const started = await startOwnedRoot({ root: workerData.root, bootstrap: workerData.bootstrap }, async root => {
      // Recovery and pointer validation have completed before this constructor.
      works = openedWorks = new Workspaces(root, workerData.migrations)
      await works.initialize()
      await works.run("inbox", async () => {
        await localTemplateLibrary.initialize()
      })
      configureConversationTransfers(works,(method,input)=>main.call(method,input))
      await recoverConversationTransfers(works)
      dispatcher = new LocalDispatcher(works)
      return works
    })
    return started.root
  } catch (error) {
    // Failed seed/adoption must release this worker's real engines and leases.
    await openedWorks?.close().catch(() => undefined)
    throw error
  }
})()
void ready.then(root => notifyStartup({ version: 1, status: "ready", root }), error => notifyStartup({ version: 1, status: "failed", code: error instanceof RootStartupError ? error.code : "ROOT_STARTUP_FAILED" }))
function notifyStartup(result: RootStartupResult) {
  if (workerData.startup instanceof SharedArrayBuffer) {
    if (workerData.startup.byteLength === ROOT_STARTUP_BYTES) publishRootStartup(workerData.startup, result)
    else if (workerData.startup.byteLength === Int32Array.BYTES_PER_ELEMENT) {
      // Retained explicit compatibility for existing bootstrap-free fixtures.
      const startup = new Int32Array(workerData.startup)
      Atomics.store(startup, 0, result.status === "ready" && workerData.bootstrap === undefined ? 1 : 2); Atomics.notify(startup, 0)
    }
  }
}
async function start(value: unknown): Promise<LocalResponse> {
  const {request:input,origin}=parseConversationWorkerRequest(value)
  if (closing) throw new Error("本地服务正在关闭")
  if (responses.has(input.id) || starting.has(input.id) || responses.size + starting.size >= 256) throw new Error("本地请求重复或过多")
  const abort = new AbortController(); starting.set(input.id, abort)
  const headers = Promise.withResolvers<LocalResponse>(); const complete = Promise.withResolvers<void>()
  const task = (async () => {
    const workspace = await dispatcher.workspaceFor(input)
    await works.runWithGlobal(workspace, () => runInDatabaseContext({...getDatabaseContext(),requestOrigin:origin},()=>runWithNewTaskDefaults(async () => {
      if (abort.signal.aborted) throw new Error("请求已取消")
      const response = await dispatcher.handle(input, abort.signal)
      const reader = (response.body ?? new ReadableStream<Uint8Array>({ start(controller) { controller.close() } })).getReader()
      if (abort.signal.aborted) { try { await reader.cancel() } finally { reader.releaseLock() }; throw new Error("请求已取消") }
      responses.set(input.id, { reader, abort, done: () => complete.resolve(), reading: false })
      if (starting.get(input.id) === abort) starting.delete(input.id)
      headers.resolve({ id: input.id, status: response.status, headers: Object.fromEntries(response.headers) })
      await complete.promise
    })))
  })().catch(error => { headers.reject(error) }).finally(() => { if (starting.get(input.id) === abort) starting.delete(input.id); pendingStarts.delete(task) })
  pendingStarts.add(task)
  return headers.promise
}
async function cancel(id: string) {
  starting.get(id)?.abort()
  const response = responses.get(id); responses.delete(id)
  if (response) {
    response.abort.abort()
    try { await response.reader.cancel() } finally { response.reader.releaseLock(); response.done() }
  }
}
const main = new RpcPeer(parentPort, async (method, data: unknown) => {
  await ready
  if (method === "ready") return true
  if(method === "closed-work-lease-target")return closedWorkLeaseTarget(works,data,()=>{
    if(!closedForMaintenance||closing||responses.size||starting.size||pendingStarts.size||localAttemptCount())throw Error("本地数据尚未关闭")
  })
  if(["start","image-asset","create-work","open-work"].includes(method)){
    if(closing)throw Error("本地服务正在关闭")
    closedForMaintenance=false
  }
  if(method==="protected-directories")return works.protectedDirectories()
  if(method==="image-asset"){
    if(closing||typeof data!=="string")throw new Error("本地图片暂不可用")
    const image=localImageRequest(data);if(!image)throw new Error("本地图片标识无效")
    if(image.kind==="work")return works.run(image.workspaceId,()=>currentWorkAssets().read(image.filename))
    const input:LocalRequest={version:1,id:randomUUID(),path:image.path,method:"GET",headers:{}}
    const workspace=await dispatcher.workspaceFor(input)
    return works.run(workspace,async()=>{
      const response=await dispatcher.handle(input,new AbortController().signal)
      if(!response.ok)throw new Error("本地图片不可用")
      const bytes=new Uint8Array(await response.arrayBuffer())
      if(bytes.byteLength>10*1024*1024)throw new Error("本地图片过大")
      return{bytes,mime:response.headers.get("content-type")}
    })
  }
  if (method === "task-status") return {active:localAttemptCount()}
  if (method === "stop-tasks") {
    let active=true
    const timeout=Promise.withResolvers<never>()
    const timer=setTimeout(()=>{active=false;timeout.reject(new Error("创作任务仍在保存停止状态，请稍后重试"))},8000)
    const pending=[...pendingStarts]
    const stopping=(async()=>{
      abortAllLocalAttempts()
      await Promise.all([...responses.keys(),...starting.keys()].map(cancel))
      if(!active)return
      await Promise.all(pending)
      while(active&&localAttemptCount())await delay(25)
    })()
    try{await Promise.race([stopping,timeout.promise]);return true}
    finally{active=false;clearTimeout(timer)}
  }
  if (method === "start") return start(data)
  if (method === "read") {
    const id = data as string; const response = responses.get(id)
    if (!response || response.reading) throw new Error("本地响应不存在或正在读取")
    response.reading = true
    try {
      const chunk = response.remainder ? { done: false, value: response.remainder } : await response.reader.read()
      if (chunk.done) { responses.delete(id); response.reader.releaseLock(); response.done(); return { done: true } }
      response.remainder = chunk.value.byteLength > 65536 ? chunk.value.slice(65536) : undefined
      return { done: false, bytes: chunk.value.slice(0, 65536) }
    } catch (error) { await cancel(id); throw error }
    finally { response.reading = false }
  }
  if (method === "cancel") return cancel(data as string)
  if (method === "create-work") {
    const request = data as { selection: DirectoryProof; input: unknown }
    const record = await works.create(request.selection, request.input)
    return works.run(record.id, async () => ({ novel: await prisma.novel.findUniqueOrThrow({ where: { id: record.novelId } }) }))
  }
  if (method === "open-work") return works.open(data as DirectoryProof)
  if (method === "close") { closedForMaintenance=false;closing = true; try { await Promise.all([...responses.keys(), ...starting.keys()].map(cancel)); await Promise.all(pendingStarts); await works.close();closedForMaintenance=true; return true } finally { closing = false } }
  throw new Error("未知本地服务命令")
})

configureModelTransport((method, value) => main.call(method, value))
