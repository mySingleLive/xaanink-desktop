import type { PGlite } from "@electric-sql/pglite"
import type { IsolationLevel, SqlDriverAdapter, SqlDriverAdapterFactory, Transaction } from "@prisma/driver-adapter-utils"
import { PrismaPGlite } from "pglite-prisma-adapter"

const isolationLevels = new Set(["READ UNCOMMITTED", "READ COMMITTED", "REPEATABLE READ", "SERIALIZABLE"])
class ConnectionClosed extends Error { constructor() { super("Database connection is closed"); this.name = "ConnectionClosed" } }
type OwnedTransaction = Transaction & { finishForDisposal(): Promise<void>; isSettled(): boolean }
function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

/** Reuse upstream conversions; let PGlite own its exclusive transaction lease.
 * The database repository, rather than an individual Prisma client, owns close().
 */
export class LocalPGliteAdapter implements SqlDriverAdapterFactory {
  readonly provider = "postgres" as const
  readonly adapterName = "xaanink-pglite"
  constructor(private readonly engine: PGlite,private readonly assertAuthority?:()=>Promise<void>) {}

  async connect(): Promise<SqlDriverAdapter> {
    const base = await new PrismaPGlite(this.engine).connect()
    const active = new Set<OwnedTransaction>()
    const pending = new Set<Promise<unknown>>()
    let closed = false
    let disposing: Promise<void> | undefined
    // Workspaces injects its writer authority. Recheck after the engine's
    // transaction queue is acquired, and before commit; a check made before
    // waiting for another transaction would allow a later control change.
    const guarded=<T>(run:(engine:PGlite)=>Promise<T>):Promise<T>=>{
      if(!this.assertAuthority)return run(this.engine)
      return this.engine.transaction(async tx=>{
        await this.assertAuthority!()
        const value=await run(tx as unknown as PGlite)
        await this.assertAuthority!()
        return value
      })
    }
    const track = <T>(run: () => Promise<T>): Promise<T> => {
      if (closed) return Promise.reject(new ConnectionClosed())
      const operation = (async()=>{await this.assertAuthority?.();if(closed)throw new ConnectionClosed();return run()})()
      pending.add(operation)
      // Observe failures without changing the Promise returned to the caller.
      void operation.then(() => pending.delete(operation), () => pending.delete(operation))
      return operation
    }
    return {
      provider: this.provider, adapterName: this.adapterName,
      queryRaw: query => track(() => this.assertAuthority?guarded(async engine=>(await new PrismaPGlite(engine).connect()).queryRaw(query)):base.queryRaw(query)),
      executeRaw: query => track(() => this.assertAuthority?guarded(async engine=>(await new PrismaPGlite(engine).connect()).executeRaw(query)):base.executeRaw(query)),
      getConnectionInfo: () => ({ supportsRelationJoins: true }),
      executeScript: script => track(() => guarded(async engine => { await engine.exec(script) })),
      startTransaction: level => track(async () => {
        const transaction = await this.startTransaction(level)
        if (closed) { await transaction.finishForDisposal(); throw new ConnectionClosed() }
        active.add(transaction)
        const finish = (method: "commit" | "rollback") => async () => {
          try { await transaction[method]() } finally { if (transaction.isSettled()) active.delete(transaction) }
        }
        return { ...transaction, commit: finish("commit"), rollback: finish("rollback") }
      }),
      dispose: () => {
        if (disposing) return disposing
        closed = true
        disposing = (async () => {
          const finishing = await Promise.allSettled([...active].map(tx => tx.finishForDisposal()))
          const waiting = await Promise.allSettled([...pending])
          active.clear()
          const failure = [...finishing, ...waiting].find(result => result.status === "rejected" && !(result.reason instanceof ConnectionClosed))
          if (failure?.status === "rejected") throw failure.reason
        })()
        return disposing
      },
    }
  }

  private async startTransaction(level?: IsolationLevel): Promise<OwnedTransaction> {
    if (level && !isolationLevels.has(level)) throw new RangeError("Unsupported transaction isolation level")
    const opened = deferred<OwnedTransaction>()
    const decision = deferred<"commit" | "rollback">()
    const rollback = new Error("Intentional local transaction rollback")
    let settled = false
    // Retain the original engine promise: a catch that only rejects `opened`
    // would swallow COMMIT errors after the transaction has been handed out.
    const completion = this.engine.transaction(async tx => {
      await this.assertAuthority?.()
      if (level) await tx.exec(`SET TRANSACTION ISOLATION LEVEL ${level}`)
      // Only queryRaw/executeRaw are used: they need the transaction's query(),
      // not a root PGlite connection (which would wait for our own lease).
      const queryable = await new PrismaPGlite(tx as unknown as PGlite).connect()
      let finishing: Promise<void> | undefined
      let finishKind: "commit" | "rollback" | undefined
      const finish = (kind: "commit" | "rollback") => {
        if (finishKind && finishKind !== kind) return Promise.reject(new Error("Transaction already finishing with a different outcome"))
        if (!finishing) {
          finishKind = kind
          decision.resolve(kind)
          finishing = completion.catch(error => { if (error !== rollback) throw error })
        }
        return finishing
      }
      const assertOpen = () => { if (finishKind) throw new Error("Transaction is closed or finishing") }
      opened.resolve({
        provider: this.provider, adapterName: this.adapterName,
        options: { usePhantomQuery: true },
        queryRaw: async query => { assertOpen();await this.assertAuthority?.();assertOpen();return queryable.queryRaw(query) },
        executeRaw: async query => { assertOpen();await this.assertAuthority?.();assertOpen();return queryable.executeRaw(query) },
        commit: async () => {
          if(finishKind)return finish("commit")
          assertOpen()
          try { await this.assertAuthority?.() }
          catch(error){await finish("rollback");throw error}
          return finish("commit")
        }, rollback: () => finish("rollback"),
        finishForDisposal: () => finishing ?? finish("rollback"),
        isSettled: () => settled,
      })
      if (await decision.promise === "rollback") throw rollback
      await this.assertAuthority?.()
    })
    // Install an observer immediately, including failures before `opened`.
    // This does not replace `completion` and never hides a later commit failure.
    void completion.then(() => { settled = true }, error => { settled = true; opened.reject(error) })
    return opened.promise
  }
}
