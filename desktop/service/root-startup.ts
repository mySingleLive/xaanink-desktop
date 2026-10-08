import { DataRootManager, RootMigrationError, type MigrationHost, type RootPointer } from "../core/data-root"
import { directoryIdentity } from "../core/root-ownership"
import { isRootStartupErrorCode, RootStartupError } from "../shared/root-startup"
import {createRootRelocationRetention,inspectRetainedRootRelocation} from "../core/root-relocation-retention"
import type {RootRelocationRetention} from "../core/data-root"

export interface RootStartupOptions {
  /** Default home root, used only when resolve explicitly needs initialization. */
  root: string
  /** Canonical stable bootstrap; caller holds the single-instance lock. */
  bootstrap?: string
}
export interface StartedRoot<T> { root: string; value: T; pointer: RootPointer | null }
function safeFailure(error: unknown, fallback: "ROOT_STARTUP_FAILED" | "ROOT_INITIALIZATION_FAILED"): RootStartupError {
  if (error instanceof RootStartupError && isRootStartupErrorCode(error.code)) return new RootStartupError(error.code)
  return new RootStartupError(error instanceof RootMigrationError && isRootStartupErrorCode(error.code) ? error.code : fallback)
}
/**
 * Bootstrap must run before Workspaces construction/any engine opening. The
 * caller additionally guarantees the previous process exited and Electron has
 * not created sessionData; a new worker alone cannot prove those facts.
 */
export async function startOwnedRoot<T>(options: RootStartupOptions, initialize: (root: string) => Promise<T>): Promise<StartedRoot<T>> {
  // Explicit compatibility for old isolated worker fixtures without bootstrap.
  // Production main always supplies bootstrap and uses the strict branch below.
  if (options.bootstrap === undefined) return { root: options.root, value: await initialize(options.root), pointer: null }
  let opened = false
  const assertNeverOpened = () => { if (opened) throw new RootStartupError("SOURCE_NOT_CLOSED") }
  const host: MigrationHost = {
    async quiesce(source) {
      assertNeverOpened()
      // Recovery owns its verified durable journal inventory. This host cannot
      // authorize a new migration or infer ownership by scanning arbitrary data.
      return { source: source.root, ownedFiles: [], assertClosed: assertNeverOpened, release: assertNeverOpened }
    },
  }
  // Main established the stable instance lock before constructing this worker.
  // This closure only proves the worker has not opened an engine; it cannot
  // itself prove the previous Electron process/session exited.
  const coldHost={assertStableLock:assertNeverOpened,assertCold:assertNeverOpened}
  const provider=createRootRelocationRetention(options.bootstrap,coldHost)
  const retention:{current:RootRelocationRetention|null}={current:null}
  const retainedRelocation=async(pointer:RootPointer,journalChecksum:string)=>{retention.current=await provider(pointer,journalChecksum);return retention.current}
  const manager = new DataRootManager(options.bootstrap, options.root,{retainedRelocation})
  let resolved
  try { await manager.recover(host); resolved = await manager.resolve() }
  catch (error) { throw safeFailure(error, "ROOT_STARTUP_FAILED") }
  const root = resolved.state === "existing" ? resolved.pointer.root.path : resolved.path
  // resolve() itself awaits filesystem IO. Re-read the exact chain afterwards,
  // then seal synchronously immediately before invalidating the cold lease.
  try{
    const fresh=await inspectRetainedRootRelocation(options.bootstrap,coldHost)
    if(fresh&&(resolved.state!=="existing"||JSON.stringify(fresh.pointer)!==JSON.stringify(resolved.pointer)))throw new RootStartupError("POINTER_CHANGED")
    const prior=retention.current
    if(prior&&(!fresh||fresh.journalChecksum!==prior.journalChecksum))throw new RootStartupError("POINTER_CHANGED")
    fresh?.assertCurrent()
  }catch(error){throw safeFailure(error,"ROOT_STARTUP_FAILED")}
  // Invalidate the startup-only closed lease before the first Workspaces/DB open.
  opened = true
  let value: T
  try { value = await initialize(root) }
  catch (error) { throw safeFailure(error, "ROOT_INITIALIZATION_FAILED") }
  try {
    const identity = await directoryIdentity(root)
    if (resolved.state === "needs-initialize") {
      const pointer = await manager.adopt(identity)
      return { root: identity.path, value, pointer }
    }
    const latest = await manager.resolve()
    if (latest.state !== "existing" || JSON.stringify(latest.pointer) !== JSON.stringify(resolved.pointer)) throw new RootStartupError("POINTER_CHANGED")
    return { root: identity.path, value, pointer: latest.pointer }
  } catch (error) { throw safeFailure(error, "ROOT_STARTUP_FAILED") }
}
