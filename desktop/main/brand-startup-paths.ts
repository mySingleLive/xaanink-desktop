import { lstatSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { DataRootManager } from "../core/data-root"
import { brandRootIdentity, readApplicationBrandImmediately } from "../core/brand-names"
import { assertRootAuthorityFile, observeRootAuthority } from "../core/root-authority"
import { CURRENT_NAMES, LEGACY_NAMES, type BrandFamily } from "../shared/brand-names"

export interface BrandStartupPaths { bootstrap: string; defaultRoot: string; encryptionFamily: BrandFamily }
export class BrandStartupPathError extends Error {
  constructor(readonly code: string, readonly recoveryPaths: BrandStartupPaths | null = null) { super(code); this.name = "BrandStartupPathError" }
}
// Electron initializes its macOS Keychain identity before ready. Retain this
// historical identity when reading existing encrypted settings; after ready
// the visible application name is always the current name.
export const legacyEncryptionName = "玄香印"
const exists = (path: string) => { try { lstatSync(path); return true } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error } }
const hasHistory = (entries: string[]) => entries.some(name => ["data-root.json", "root-migration.json", "root-migration-request.json"].includes(name) || name.startsWith("root-relocation-") || name.startsWith("application-restore-"))
function bootstrapHistory(path: string) {
  if (!exists(path)) return null
  const identity = brandRootIdentity(path), entries = readdirSync(path)
  return { identity, authoritative: hasHistory(entries) }
}

/** Pure, bounded startup selection. It creates no directories or databases.
 * Recovery paths permit only the existing relocation/maintenance entry; the
 * caller must never open its ordinary worker after a selection error. */
export function selectBrandStartupPaths(input: { appData: string; home: string; isolatedRoot: string | null }): BrandStartupPaths {
  if (input.isolatedRoot) {
    const paths:BrandStartupPaths={ bootstrap: input.isolatedRoot + "-bootstrap", defaultRoot: input.isolatedRoot, encryptionFamily: "current" }
    try {
      if (exists(input.isolatedRoot)) {
        const identity=brandRootIdentity(input.isolatedRoot)
        if(readdirSync(input.isolatedRoot).length)paths.encryptionFamily=readApplicationBrandImmediately(identity).names.family
      }
      return paths
    } catch { throw new BrandStartupPathError("BRAND_ISOLATED_ROOT_INVALID",paths) }
  }
  const legacyBootstrap = join(input.appData, LEGACY_NAMES.appIdentity), currentBootstrap = join(input.appData, CURRENT_NAMES.appIdentity)
  const legacy = bootstrapHistory(legacyBootstrap), current = bootstrapHistory(currentBootstrap)
  if (legacy?.authoritative && current?.authoritative) throw new BrandStartupPathError("BRAND_BOOTSTRAP_CONFLICT")
  const family: BrandFamily = legacy?.authoritative ? "legacy" : current?.authoritative ? "current" : "current"
  const bootstrap = family === "legacy" ? legacyBootstrap : currentBootstrap
  const history = family === "legacy" ? legacy : current
  const fallbackRoot = join(input.home, family === "legacy" ? ".xuanxiang" : ".xaanink")
  if (history?.authoritative) {
    const recoveryPaths = { bootstrap, defaultRoot: fallbackRoot, encryptionFamily: family }
    try {
      const observed = observeRootAuthority(history.identity, "data-root.json", 16 * 1024, true)
      if (!observed) throw Error("BRAND_POINTER_REQUIRED")
      const pointer = DataRootManager.parsePointer(JSON.parse(observed.text))
      recoveryPaths.defaultRoot = pointer.root.path
      const brand = readApplicationBrandImmediately(pointer.root)
      if (brand.value.id !== pointer.rootId || brand.value.phase !== "ready" || !brand.value.inboxReady) throw Error("BRAND_POINTER_INVALID")
      brand.assertCurrent(); assertRootAuthorityFile(history.identity, "data-root.json", observed.proof)
      // The persisted app marker owns encryption identity; directory basenames
      // may change through an authorized migration or relocation.
      recoveryPaths.encryptionFamily=brand.names.family
      return recoveryPaths
    } catch { throw new BrandStartupPathError("BRAND_POINTER_INVALID", recoveryPaths) }
  }
  for (const [root, names, boot] of [[join(input.home, ".xuanxiang"), LEGACY_NAMES, legacyBootstrap], [join(input.home, ".xaanink"), CURRENT_NAMES, currentBootstrap]] as const) {
    if (!exists(root)) continue
    const identity = brandRootIdentity(root)
    if (!readdirSync(root).length) continue
    const brand = readApplicationBrandImmediately(identity)
    // An owned ready marker with inboxReady=false is the existing initializer's
    // resumable state. Only the worker may finish it and publish its pointer.
    if (brand.names.family !== names.family || brand.value.phase !== "ready") throw new BrandStartupPathError("BRAND_DEFAULT_INVALID")
    brand.assertCurrent()
    return { bootstrap: boot, defaultRoot: root, encryptionFamily: names.family }
  }
  return { bootstrap: currentBootstrap, defaultRoot: join(input.home, ".xaanink"), encryptionFamily: "current" }
}
