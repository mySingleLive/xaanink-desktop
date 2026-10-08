import { AsyncLocalStorage } from "node:async_hooks"
import type { Prisma, PrismaClient } from "../../src/generated/prisma/client"
import type {WorkspaceAssets} from "./workspace-assets"
export const LOCAL_AUTHOR_ID = "local-author"
export interface DatabaseAuthority {
  execute<T>(operation:(context:DatabaseContext)=>Promise<T>):Promise<T>
  retainTask?():()=>void
}
export interface DatabaseContext { requestOrigin?:import('../shared/conversation-task').ConversationRequestOrigin; workspaceId: string; database: PrismaClient; assets?:WorkspaceAssets; transactionActive?: boolean; allowNovelCreation?: boolean; globalDatabase?: PrismaClient; retainTask?: () => () => void; authority?:DatabaseAuthority; authorityPhase?:boolean }
const storage = new AsyncLocalStorage<DatabaseContext>()
export function runInDatabaseContext<T>(context: DatabaseContext, run: () => T): T {
  if (!context.workspaceId || !context.database) throw new Error("Invalid trusted database context")
  return storage.run(Object.freeze({ ...context }), run)
}
export function getDatabaseContext(): DatabaseContext {
  const current = storage.getStore()
  if (!current) throw new Error("No trusted database context")
  return current
}
/** A detached executor keeps every database it may access alive until its final write. */
export function retainDatabaseTask(): () => void {
  const context=storage.getStore()
  return context?.authority?.retainTask?.()??context?.retainTask?.()??(()=>{})
}
export function createScopedClient(target: "request" | "global" = "request"): PrismaClient {
  const delegates = new Map<PropertyKey, object>()
  const owners = new WeakMap<object, PrismaClient>()
  const pending=new WeakMap<object,{authority:DatabaseAuthority;invoke:(context:DatabaseContext)=>unknown;started:boolean}>()
  const checkedContext = () => {
    const context = getDatabaseContext()
    if (context.transactionActive) throw new Error("Use the supplied transaction; borrowing this database again would deadlock")
    if (target === "global") {
      const database = context.globalDatabase ?? (context.workspaceId === "inbox" ? context.database : undefined)
      if (!database) throw new Error("No trusted global database context")
      return { ...context, database }
    }
    return context
  }
  const remember = <T>(value: T, db: PrismaClient) => {
    if (value && typeof value === "object") owners.set(value, db)
    return value
  }
  const bound=(context:DatabaseContext)=>target==='request'&&context.authority&&!context.authorityPhase?context.authority:undefined
  const execute=<T>(context:DatabaseContext,invoke:(fixed:DatabaseContext)=>T|PromiseLike<T>):Promise<T>=>{
    const authority=bound(context)
    if(!authority)return Promise.resolve(invoke(context))
    return authority.execute(fixed=>storage.run(Object.freeze({...fixed,globalDatabase:context.globalDatabase??fixed.globalDatabase,authority,authorityPhase:true}),()=>Promise.resolve(invoke(getDatabaseContext()))))
  }
  /** Preserve lazy PrismaPromise construction. A batch materializes native
   * promises only after one fixed authority/connection has been selected. */
  const query=(context:DatabaseContext,invoke:(fixed:DatabaseContext)=>unknown)=>{
    const authority=bound(context)
    if(!authority)return remember(invoke(context),context.database)
    const metadata={authority,invoke,started:false};let promise:Promise<unknown>|undefined
    const start=()=>{metadata.started=true;return promise??=execute(context,invoke)}
    const value={
      [Symbol.toStringTag]:'PrismaPromise',
      then:(ok?:((value:unknown)=>unknown)|null,failed?:((error:unknown)=>unknown)|null)=>start().then(ok,failed),
      catch:(failed:(error:unknown)=>unknown)=>start().catch(failed),
      finally:(settled:()=>void)=>start().finally(settled),
    }
    pending.set(value,metadata);return value
  }
  return new Proxy({} as PrismaClient, { get(_target, key) {
    if (key === "then" || typeof key !== "string") return undefined
    if (key === "$transaction") return (run: ((tx: Prisma.TransactionClient) => Promise<unknown>) | Prisma.PrismaPromise<unknown>[], options?: { maxWait?: number; timeout?: number; isolationLevel?: Prisma.TransactionIsolationLevel }) => {
      const context = checkedContext(); const db = context.database
      if (Array.isArray(run)) {
        const authority=bound(context)
        if(authority){
          const entries=run.map(value=>pending.get(value))
          if(entries.some(entry=>!entry||entry.authority!==authority||entry.started))throw new Error("Batch transaction contains a query from another database context or an already executed query")
          entries.forEach(entry=>{entry!.started=true})
          return execute(context,fixed=>fixed.database.$transaction(entries.map(entry=>entry!.invoke(fixed)) as Prisma.PrismaPromise<unknown>[],options))
        }
        if (run.some(query => owners.get(query) !== db)) throw new Error("Batch transaction contains a query from another database context")
        return db.$transaction(run, options)
      }
      if (typeof run !== "function") throw new Error("Invalid local transaction callback")
      return execute(context,fixed=>fixed.database.$transaction(tx => storage.run(Object.freeze({ ...fixed, transactionActive: true,authorityPhase:true }), () => run(tx)), options))
    }
    if (key.startsWith("$")) return (...args: unknown[]) => {
      const context=checkedContext()
      return query(context,({database})=>{
        const value = Reflect.get(database, key)
        if (typeof value !== "function") throw new Error("Unsupported database operation")
        return value.apply(database,args)
      })
    }
    if (!delegates.has(key)) delegates.set(key, new Proxy({}, { get(_model, operation) {
      if (typeof operation !== "string" || operation === "then") return undefined
      return (...args: unknown[]) => {
        const context=checkedContext()
        return query(context,({database})=>{
          const model = Reflect.get(database, key)
          const method = model && Reflect.get(model, operation)
          if (typeof method !== "function") throw new Error("Unsupported database model operation")
          return method.apply(model,args)
        })
      }
    } }))
    return delegates.get(key)
  } })
}
