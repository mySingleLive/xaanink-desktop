import type { DirectoryProof } from "../main/directory-authority"
import { randomUUID } from "node:crypto"
import { lstatSync, realpathSync } from "node:fs"
import { mkdir, readdir, readFile, realpath, stat, lstat, writeFile, unlink, rmdir } from "node:fs/promises"
import { join } from "node:path"
import { hostname } from "node:os"
import { z } from "zod"
import { PGlite } from "@electric-sql/pglite"
import { PrismaClient } from "../../src/generated/prisma/client"
import { atomicWrite, VersionedStore } from "../core/versioned-store"
import { LocalPGliteAdapter } from "./database/pglite-adapter"
import { loadMigrations, migrateDatabase, type Migration } from "./database/migrations"
import { LOCAL_AUTHOR_ID, getDatabaseContext, runInDatabaseContext } from "./context"
import { requestHash } from "../../src/lib/services/content-commit"
import { ContentError } from "../../src/lib/content-errors"
import { createNovelOnce, novelCreationSchema } from "../../src/lib/services/novel-create"
import {WorkspaceAssets} from "./workspace-assets"
import {workManifestSchema as manifestSchema} from "../shared/workspace"
import {workspaceStorage} from "./workspace-storage"
import {assertDirectory,directoryIdentity,readMetadata,sameIdentity,within} from "../core/root-ownership"
import {CURRENT_NAMES,BRAND_NAMES,type BrandNames} from "../shared/brand-names"
import {readApplicationBrand,readWorkBrand,assertBrandControls,brandRootIdentity,type BrandObservation} from "../core/brand-names"
import {WorkCreationReservations} from "./work-creation-reservations"
import type {RootIdentity} from "../core/data-root"

const identitySchema = z.object({ device: z.string(), inode: z.string() }).strict()
const recordSchema = z.object({ id: z.uuid(), path: z.string(), identity: identitySchema, novelId: z.string(), title: z.string(), requestId: z.string(), requestHash: z.string(), createdAt: z.string() }).strict()
export const catalogSchema = z.array(recordSchema)
export type WorkRecord = z.infer<typeof recordSchema>
interface Connection { engine: PGlite; db: PrismaClient; assets:WorkspaceAssets; unlock: () => Promise<void>; assertCurrent():void; assertLease():Promise<void>; storagePath:string }
interface Slot { connection: Promise<Connection>; active: number; lastUsed: number }
async function identity(path: string) { const info = await stat(path, { bigint: true }); return { device: String(info.dev), inode: String(info.ino) } }
async function regularFile(path: string) { const info = await lstat(path); if (!info.isFile() || info.isSymbolicLink()) throw new Error("作品元数据或数据库路径无效") }
function assertAliasDirectory(path:string,root:RootIdentity){
  const info=lstatSync(path,{bigint:true})
  if(!info.isDirectory()||info.isSymbolicLink()||realpathSync(path)!==root.path||String(info.dev)!==root.device||String(info.ino)!==root.inode)throw Error("WORKSPACE_DIRECTORY_CHANGED")
}
async function canonicalDirectory(path:string){
  const info=await lstat(path,{bigint:true})
  if(!info.isDirectory()||info.isSymbolicLink())throw Error("unsafe directory")
  const root=await directoryIdentity(await realpath(path))
  if(String(info.dev)!==root.device||String(info.ino)!==root.inode)throw Error("WORKSPACE_DIRECTORY_CHANGED")
  assertAliasDirectory(path,root);return root
}

/** Per-directory writer lease; never steal a live or foreign-host lease. */
async function lockDirectory(path: string,names:Readonly<BrandNames>,assertRegistration?:()=>void): Promise<(()=>Promise<void>)&{assertHeld():Promise<void>}> {
  assertRegistration?.()
  const leaseRoot=brandRootIdentity(path);assertBrandControls(leaseRoot,names)
  const lock = join(path, names.lock); const token = randomUUID()
  try { await mkdir(lock) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
    if (!(await lstat(lock)).isDirectory() || (await lstat(lock)).isSymbolicLink()) throw new Error("作品目录锁无效")
    const previous = JSON.parse(await readFile(join(lock, "owner.json"), "utf8"))
    if (previous.host !== hostname() || !Number.isSafeInteger(previous.pid) || previous.pid < 1) throw new Error("作品已在其他进程或设备打开")
    try { process.kill(previous.pid, 0); throw new Error("作品已在其他进程打开") }
    catch (cause) { if ((cause as NodeJS.ErrnoException).code !== "ESRCH") throw cause }
    // A pathname rename is not compare-and-swap: another process could have
    // replaced this stale lease. Recovery is a separate explicit operation
    // under the application's instance lock; ordinary opens never steal it.
    throw new ContentError("WORK_LEASE_STALE", "上次进程异常退出，作品目录锁需要恢复；原数据已保留")
  }
  const leaseDirectory=await directoryIdentity(join(await realpath(path),names.lock))
  try { assertRegistration?.();await writeFile(join(lock, "owner.json"), JSON.stringify({ token, pid: process.pid, host: hostname() }), { flag: "wx", mode: 0o600 }) }
  catch (error) { await assertDirectory(leaseDirectory);await rmdir(lock).catch(()=>{});throw error }
  const assertHeld=async()=>{assertBrandControls(leaseRoot,names);await assertDirectory(leaseDirectory);const owner=await readMetadata(join(lock,"owner.json"),4096);if(!owner||typeof owner!=="object"||!("token"in owner)||owner.token!==token)throw Error("作品目录锁归属发生变化")}
  let ownerRemoved=false
  const release=async () => {
    if(ownerRemoved){await assertDirectory(leaseDirectory);if((await readdir(lock)).length)throw Error("作品目录锁包含未知文件，已保留，请移出后重试关闭");await rmdir(lock);return}
    await assertHeld()
    const entries=await readdir(lock)
    if(entries.length!==1||entries[0]!=="owner.json")throw Error("作品目录锁包含未知文件，已保留，请移出后重试关闭")
    await assertHeld()
    await unlink(join(lock,"owner.json"));ownerRemoved=true;await rmdir(lock)
  }
  return Object.assign(release,{assertHeld})
}

/** Worker-owned catalog and connection pool. Paths only come from main's native grants. */
export class Workspaces {
  private readonly catalog: VersionedStore<WorkRecord[]>
  private readonly slots = new Map<string, Slot>()
  private readonly retiring = new Map<string, Promise<void>>()
  private readonly failedRetirements = new Map<string, Slot>()
  private migrations: Migration[] = []
  private queue: Promise<unknown> = Promise.resolve()
  private closing = false
  private closingPromise: Promise<void> | undefined
  private readonly creationReservations = new WorkCreationReservations(run=>this.run('inbox',()=>run(getDatabaseContext().database)))
  constructor(readonly root: string, readonly migrationsPath: string) {
    this.catalog = new VersionedStore(join(root, "catalog.json"), [], value => catalogSchema.parse(value))
  }
  private serialize<T>(run: () => Promise<T>): Promise<T> { if (this.closing) return Promise.reject(new Error("正在关闭本地数据库，请稍后重试")); const pending = this.queue.then(run); this.queue = pending.catch(() => undefined); return pending }
  async initialize(): Promise<void> {
    // Validate bundled resources before creating any authoritative state.
    this.migrations = await loadMigrations(this.migrationsPath)
    await mkdir(this.root, { recursive: true })
    await canonicalDirectory(this.root)
    const contents=await readdir(this.root)
    const names=BRAND_NAMES.some(names=>contents.includes(names.appMarker))?(await this.rootBrand()).names:CURRENT_NAMES
    const markerPath = join(this.root, names.appMarker)
    let exists = true
    try { await regularFile(markerPath) } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") exists = false; else throw error }
    if (!exists) {
      if ((await readdir(this.root)).length) throw new Error("应用数据目录不是空目录，请选择其他位置或恢复原目录")
      await writeFile(markerPath, JSON.stringify({ schemaVersion: 1, app: names.appIdentity, id: randomUUID(), phase: "initializing", inboxReady: false }), { flag: "wx", mode: 0o600 })
    }
    const markerBrand = await this.rootBrand(),marker=markerBrand.value
    if (marker.phase === "initializing") {
      let hasCatalog = true
      try { await regularFile(this.catalog.path) } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") hasCatalog = false; else throw error }
      if (!hasCatalog) await this.catalog.update(0, [])
      await mkdir(join(this.root, "inbox"), { recursive: true })
      await atomicWrite(markerPath, JSON.stringify({ ...marker, phase: "ready" }),{beforeRename:async()=>markerBrand.assertCurrent()})
    }
    await regularFile(this.catalog.path); await this.catalog.read()
    const info = await lstat(join(this.root, "inbox"))
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("全局收件箱目录缺失或已变化")
  }
  private async rootBrand(){
    const root=await canonicalDirectory(this.root),observation=await readApplicationBrand(root)
    const assertCurrent=()=>{assertAliasDirectory(this.root,root);observation.assertCurrent()}
    assertCurrent();return{...observation,assertCurrent}
  }
  private async rootMarker() {
    return (await this.rootBrand()).value
  }
  private async verifySelection(selection: DirectoryProof) {
    try {
      const actual = await realpath(selection.path); const info = await identity(actual)
      if (actual !== selection.path || info.device !== selection.device || info.inode !== selection.inode || !(await lstat(actual)).isDirectory()) throw new Error("changed")
      return actual
    } catch { throw new Error("所选目录的授权身份已变化，请重新选择") }
  }
  private async assertWorkDataBoundary(path:string){
    const root=await directoryIdentity(await realpath(this.root))
    const guard=()=>{
      try{
        const actual=realpathSync(this.root),info=lstatSync(root.path,{bigint:true})
        if(actual!==root.path||!info.isDirectory()||info.isSymbolicLink()||String(info.dev)!==root.device||String(info.ino)!==root.inode)throw Error('changed')
      }catch{throw Error('WORKSPACE_APP_ROOT_CHANGED')}
      // Native work grants cannot claim the application, inbox, cache or any
      // managed descendant, including retained legacy backup directories.
      if(within(path,root.path)||within(root.path,path))throw Error('WORKSPACE_APP_NAMESPACE_OVERLAP')
    }
    guard();return guard
  }
  async list(): Promise<WorkRecord[]> { return (await this.catalog.read()).value }
  async protectedDirectories(): Promise<string[]> { return [...new Set([...(await this.list()).map(record=>record.path),...await this.creationReservations.directories()])] }
  assertNoPendingCreation(requestId:string):Promise<void>{return this.creationReservations.assertNoPendingCreation(requestId)}
  async create(selection: DirectoryProof, input: unknown,assertCreation?:()=>void): Promise<WorkRecord> {
    assertCreation?.()
    const path = selection.path
    const parsed = novelCreationSchema.parse(input)
    const fingerprint = requestHash({ title: parsed.title, ...(parsed.position ? { position: parsed.position } : {}) })
    return this.serialize(async () => {
      assertCreation?.()
      const canonical = await this.verifySelection(selection)
      assertCreation?.()
      const assertWorkPath=await this.assertWorkDataBoundary(canonical)
      let manifestObservation:BrandObservation<z.infer<typeof manifestSchema>>|undefined
      const assertRegistration=()=>{assertCreation?.();assertWorkPath();manifestObservation?.assertCurrent()}
      assertRegistration()
      const before = await this.catalog.read()
      assertRegistration()
      const reservation={requestId:parsed.requestId,requestHash:fingerprint,selection:{path:canonical,device:selection.device,inode:selection.inode}}
      const previous = before.value.find(row => row.requestId === parsed.requestId)
      if (previous) {
        if (previous.path !== canonical || previous.requestHash !== fingerprint) throw new ContentError("REQUEST_CONFLICT","建书请求已用于其他作品或目录")
        if (previous.identity.device !== selection.device || previous.identity.inode !== selection.inode) throw new Error("作品目录身份已变化，请重新关联")
        manifestObservation=await readWorkBrand(await directoryIdentity(canonical));const manifest=manifestObservation.value
        if (manifest.id !== previous.id || manifest.novelId !== previous.novelId || manifest.phase !== "ready") throw new Error("作品目录身份不匹配")
        await this.validateWorkDatabase(canonical)
        assertRegistration()
        await this.creationReservations.reserve(reservation,assertRegistration)
        assertRegistration()
        await this.creationReservations.complete(reservation,assertRegistration)
        assertRegistration()
        return previous
      }
      let manifest: z.infer<typeof manifestSchema>,names:Readonly<BrandNames>=CURRENT_NAMES
      const contents = await readdir(canonical)
      assertRegistration()
      if (contents.length) {
        if (!BRAND_NAMES.some(names=>contents.includes(names.workManifest))) throw new Error("创建作品需要空目录，现有作品请使用打开")
        const brand=manifestObservation=await readWorkBrand(await directoryIdentity(canonical));names=brand.names;manifest=brand.value;brand.assertCurrent()
        if (manifest.requestId !== parsed.requestId || manifest.requestHash !== fingerprint) throw new ContentError("REQUEST_CONFLICT","此目录属于其他建书请求，请核对原请求")
        await this.creationReservations.reserve(reservation,assertRegistration)
        assertRegistration()
      } else {
        manifest = { schemaVersion: 1, id: randomUUID(), phase: "creating", novelId: null, title: parsed.title, requestId: parsed.requestId, requestHash: fingerprint, createdAt: new Date().toISOString() }
        await this.verifySelection(selection)
        assertRegistration()
        // Bind before the first target file write. Unknown outcomes keep this
        // exact directory; invalid selections never reserve a new request.
        await this.creationReservations.reserve(reservation,assertRegistration)
        assertRegistration()
        await writeFile(join(canonical, names.workManifest), JSON.stringify(manifest), { flag: "wx", mode: 0o600 })
      }
      manifestObservation=await readWorkBrand(await directoryIdentity(canonical))
      for (const name of ["assets"]) {
        await this.verifySelection(selection)
        assertRegistration()
        await mkdir(join(canonical, name), { recursive: true })
        const info = await lstat(join(canonical, name))
        if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("作品资源目录无效")
      }
      await this.verifySelection(selection)
      assertRegistration()
      const connection = await this.connect(canonical, manifest.phase === "creating",assertRegistration)
      try {
        assertRegistration()
        const result = await runInDatabaseContext({ workspaceId: manifest.id, database: connection.db, allowNovelCreation: true }, () => createNovelOnce(LOCAL_AUTHOR_ID, parsed,assertRegistration))
        manifest.novelId = result.id; manifest.phase = "ready"
        assertRegistration()
        await atomicWrite(join(canonical, names.workManifest), JSON.stringify(manifest),{beforeRename:async()=>assertRegistration()})
        manifestObservation=await readWorkBrand(await directoryIdentity(canonical))
        if(manifestObservation.names.family!==names.family||manifestObservation.value.id!==manifest.id||manifestObservation.value.novelId!==manifest.novelId||manifestObservation.value.phase!=="ready")throw Error("作品目录身份不匹配")
        const record: WorkRecord = { id: manifest.id, path: canonical, identity: await identity(canonical), novelId: result.id, title: result.title, requestId: parsed.requestId, requestHash: fingerprint, createdAt: manifest.createdAt }
        assertRegistration()
        await this.catalog.update(before.revision, [...before.value, record],assertRegistration)
        assertRegistration()
        await this.creationReservations.complete(reservation,assertRegistration)
        assertRegistration()
        return record
      } finally { await connection.db.$disconnect(); await connection.engine.close(); await connection.unlock() }
    })
  }
  async open(selection: DirectoryProof): Promise<WorkRecord> {
    const path = selection.path
    return this.serialize(async () => {
      const canonical = await this.verifySelection(selection)
      const assertPath=await this.assertWorkDataBoundary(canonical)
      const brand=await readWorkBrand(await directoryIdentity(canonical)),manifest=brand.value;brand.assertCurrent()
      const assertRegistration=()=>{assertPath();brand.assertCurrent()}
      if (manifest.phase !== "ready" || !manifest.novelId) throw new Error("作品创建未完成，请保留原创建请求并重试")
      await this.validateWorkDatabase(canonical)
      assertRegistration()
      const before = await this.catalog.read()
      assertRegistration()
      const previous = before.value.find(row => row.id === manifest.id || row.novelId === manifest.novelId)
      const fileId = await identity(canonical)
      if (previous && (previous.path !== canonical || previous.identity.device !== fileId.device || previous.identity.inode !== fileId.inode)) throw new Error("检测到重复作品，需要作者确认重新关联")
      const record: WorkRecord = { id: manifest.id, path: canonical, identity: fileId, novelId: manifest.novelId, title: manifest.title, requestId: manifest.requestId, requestHash: manifest.requestHash, createdAt: manifest.createdAt }
      const validate = async (db: PrismaClient) => {
        const novel = await db.novel.findFirst({ where: { id: record.novelId, userId: LOCAL_AUTHOR_ID, status: { not: "DELETED" } } })
        if (!novel || await db.novel.count() !== 1) throw new Error("作品目录与数据库不匹配")
        record.title = novel.title
      }
      if (previous && this.slots.has(previous.id)) {
        assertRegistration()
        await this.run(previous.id, async () => { const { getDatabaseContext } = await import("./context"); await validate(getDatabaseContext().database) })
      } else {
        await this.retiring.get(record.id)
        assertRegistration()
        const connection = await this.connect(canonical, false,assertRegistration)
        try { await validate(connection.db) } finally { await connection.db.$disconnect(); await connection.engine.close(); await connection.unlock() }
      }
      assertRegistration()
      await this.catalog.update(before.revision, [...before.value.filter(row => row.id !== record.id), record],assertRegistration)
      return record
    })
  }
  private async validateDatabase(path: string) {
    try {
      const info = await lstat(join(path, "database"))
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("invalid")
      await regularFile(join(path, "database", "PG_VERSION"))
    } catch { throw new Error("作品数据库缺失或路径无效，原作品已保留") }
  }
  private async dataPath(path:string,assertOwner?:()=>Promise<void>){
    if(path===join(this.root,"inbox"))return path
    const storage=await workspaceStorage(path,assertOwner),state=await storage.resolve()
    return state.active.kind==='candidate'?state.active.directory.path:path
  }
  private async validateWorkDatabase(path:string){await this.validateDatabase(await this.dataPath(path))}
  private async connect(path: string, create: boolean,assertRegistration?:()=>void): Promise<Connection> {
    assertRegistration?.()
    const connectionRoot=await canonicalDirectory(path)
    const names=path===join(this.root,"inbox")?(await this.rootBrand()).names:(await readWorkBrand(connectionRoot)).names
    const unlock = await lockDirectory(connectionRoot.path,names,assertRegistration)
    const assertCurrent=()=>{assertAliasDirectory(path,connectionRoot);assertRegistration?.();assertBrandControls(connectionRoot,names)}
    const assertLease=async()=>{assertCurrent();await unlock.assertHeld();assertCurrent()}
    let engine: PGlite | undefined; let db: PrismaClient | undefined
    try {
    const storagePath=path===join(this.root,"inbox")?connectionRoot.path:await this.dataPath(path,()=>unlock.assertHeld())
    assertRegistration?.()
    if (!create) await this.validateDatabase(storagePath)
    else {
      try {
        const info = await lstat(join(storagePath, "database"))
        if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("作品数据库路径无效")
        if ((await readdir(join(storagePath, "database"))).length) await this.validateDatabase(storagePath)
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error }
    }
      await unlock.assertHeld()
      assertRegistration?.()
      engine = await PGlite.create({ dataDir: join(storagePath, "database"), relaxedDurability: false })
      assertRegistration?.();await migrateDatabase(engine, this.migrations,assertRegistration)
      assertRegistration?.()
      db = new PrismaClient({ adapter: new LocalPGliteAdapter(engine,assertLease) })
      if (create) {assertRegistration?.();await db.user.upsert({ where: { id: LOCAL_AUTHOR_ID }, create: { id: LOCAL_AUTHOR_ID, name: "作者", email: "local-author@localhost.invalid", passwordHash: "" }, update: {} })}
      assertRegistration?.()
      return { engine, db, assets:new WorkspaceAssets(storagePath), unlock,assertCurrent,assertLease,storagePath }
    } catch (error) { await db?.$disconnect(); await engine?.close(); await unlock(); throw error }
  }
  async run<T>(id: string, run: () => Promise<T>): Promise<T> {
    if (this.closing) throw new Error("正在关闭本地数据库，请稍后重试")
    if (this.failedRetirements.has(id)) throw new Error("数据库关闭未完成，请重试关闭后重新打开作品")
    let slot = this.slots.get(id)
    if (!slot) {
      const connection = (async () => {
        await this.retiring.get(id)
        if (id === "inbox") {
          const path = join(this.root, "inbox")
          let create = false
          let markerObservation=await this.rootBrand()
          const marker = markerObservation.value,assertRegistration=()=>markerObservation.assertCurrent()
          try { await this.validateDatabase(path) } catch {
            if (marker.inboxReady || (await readdir(path)).length) throw new Error("全局收件箱数据库缺失，不能自动重建")
            create = true
          }
          assertRegistration()
          const connection = await this.connect(path, create || !marker.inboxReady,assertRegistration)
          try {
            if (!marker.inboxReady) {
              if (!await connection.db.user.findUnique({ where: { id: LOCAL_AUTHOR_ID } })) throw new Error("全局收件箱初始化未完成，请恢复数据")
              await atomicWrite(join(this.root, markerObservation.filename), JSON.stringify({ ...marker, inboxReady: true }),{beforeRename:async()=>assertRegistration()})
              markerObservation=await this.rootBrand()
              if(markerObservation.value.id!==marker.id||markerObservation.value.app!==marker.app||!markerObservation.value.inboxReady||markerObservation.value.phase!=="ready")throw Error("全局收件箱目录身份已变化")
            }
            return connection
          } catch (error) { await connection.db.$disconnect(); await connection.engine.close(); await connection.unlock(); throw error }
        }
        const row = (await this.list()).find(work => work.id === id)
        if (!row) throw new Error("作品不在本地目录索引中")
        const info = await identity(row.path)
        if (info.device !== row.identity.device || info.inode !== row.identity.inode || await realpath(row.path) !== row.path) throw new Error("作品目录发生变化，请重新关联")
        const brand=await readWorkBrand(await directoryIdentity(row.path)),manifest=brand.value;brand.assertCurrent()
        if (manifest.id !== row.id || manifest.novelId !== row.novelId || manifest.phase !== "ready") throw new Error("作品目录身份不匹配")
        return this.connect(row.path, false,()=>brand.assertCurrent())
      })()
      slot = { connection, active: 0, lastUsed: Date.now() }; this.slots.set(id, slot)
      connection.catch(() => { if (this.slots.get(id) === slot) this.slots.delete(id) })
    }
    slot.active++
    try {
      const connection = await slot.connection
      await connection.assertLease()
      const { db,assets } = connection
      const retainedSlot = slot
      const retainTask = () => {
        connection.assertCurrent()
        if (this.closing || this.slots.get(id) !== retainedSlot || retainedSlot.active === 0) throw new Error("任务不能借用已关闭的数据库")
        retainedSlot.active++
        let released = false
        return () => { if (!released) { released = true; retainedSlot.active--; retainedSlot.lastUsed = Date.now() } }
      }
      return await runInDatabaseContext({ workspaceId: id, database: db, assets, retainTask }, run)
    }
    finally {
      slot.active--; slot.lastUsed = Date.now()
      // Active scopes retain their connection; only idle instances can leave the LRU.
      if (this.slots.size > 4) {
        const idle = [...this.slots.entries()].filter(([, value]) => value.active === 0).sort((a,b) => a[1].lastUsed-b[1].lastUsed)[0]
        if (idle) {
          this.slots.delete(idle[0]); const retiring = this.disconnect(idle[1]); this.retiring.set(idle[0], retiring)
          try { await retiring } catch (error) { this.failedRetirements.set(idle[0], idle[1]); throw error } finally { this.retiring.delete(idle[0]) }
        }
      }
    }
  }
  async runWithGlobal<T>(id: string, run: () => Promise<T>): Promise<T> {
    return this.run("inbox", async () => {
      const globalContext = getDatabaseContext()
      const globalDatabase = globalContext.database
      if (id === "inbox") return runInDatabaseContext({ ...getDatabaseContext(), globalDatabase }, run)
      return this.run(id, () => {
        const context = getDatabaseContext()
        const retainTask = () => {
          const releaseGlobal = globalContext.retainTask!()
          try {
            const releaseWork = context.retainTask!()
            return () => { releaseWork(); releaseGlobal() }
          } catch (error) { releaseGlobal(); throw error }
        }
        return runInDatabaseContext({ ...context, globalDatabase, retainTask }, run)
      })
    })
  }
  private async disconnect(slot: Slot) {
    const connection = await slot.connection.catch(() => null)
    if (connection) { await connection.db.$disconnect(); if(!connection.engine.closed)await connection.engine.close(); await connection.unlock() }
  }
  close(): Promise<void> {
    if (this.closingPromise) return this.closingPromise
    this.closing = true
    this.closingPromise = this.closeConnections().finally(() => { this.closing = false; this.closingPromise = undefined })
    return this.closingPromise
  }
  private async closeConnections(): Promise<void> {
    await this.queue
    await Promise.allSettled(this.retiring.values())
    if ([...this.slots.values()].some(slot => slot.active)) throw new Error("仍有创作任务运行，暂不能关闭数据库")
    const entries = [...this.slots.entries(), ...this.failedRetirements.entries()]
    const results = await Promise.allSettled(entries.map(async ([id, slot]) => {
      await this.disconnect(slot)
      if (this.slots.get(id) === slot) this.slots.delete(id)
      if (this.failedRetirements.get(id) === slot) this.failedRetirements.delete(id)
    }))
    const failed = results.find(result => result.status === "rejected")
    if (failed?.status === "rejected") throw failed.reason
  }
}
