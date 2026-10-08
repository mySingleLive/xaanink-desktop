import { constants, lstatSync, realpathSync, openSync, fstatSync, readSync, closeSync, readdirSync, type BigIntStats } from "node:fs"
import { isAbsolute, join } from "node:path"
import { z } from "zod"
import type { RootIdentity } from "./data-root"
import { BRAND_NAMES, otherBrandNames, type BrandNames } from "../shared/brand-names"
import { workManifestSchema, type WorkManifest } from "../shared/workspace"

const appSchema = z.object({ schemaVersion: z.literal(1), app: z.enum(["Xuanxiangxiezuo-Desktop", "XaanInk"]), id: z.uuid(), phase: z.enum(["initializing", "ready"]), inboxReady: z.boolean() }).strict()
export type ApplicationMarker = z.infer<typeof appSchema>
export interface BrandObservation<T> { names: Readonly<BrandNames>; filename: string; value: T; assertCurrent(): void }
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT"
export function brandRootIdentity(path: string): RootIdentity {
  const stat = lstatSync(path, { bigint: true })
  if (!isAbsolute(path) || !stat.isDirectory() || stat.isSymbolicLink() || realpathSync(path) !== path) throw Error("BRAND_DIRECTORY_INVALID")
  return { path, device: String(stat.dev), inode: String(stat.ino) }
}
function assertRoot(root: RootIdentity) { const actual = brandRootIdentity(root.path); if (actual.device !== root.device || actual.inode !== root.inode) throw Error("BRAND_DIRECTORY_CHANGED") }
function exists(path: string) { try { lstatSync(path); return true } catch (error) { if (missing(error)) return false; throw error } }
const sameStat = (a: BigIntStats, b: BigIntStats) => a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs
function snapshot(root: RootIdentity, filename: string, limit: number) {
  assertRoot(root); const path = join(root.path, filename), before = lstatSync(path, { bigint: true })
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.size < 1n || before.size > BigInt(limit)) throw Error("BRAND_MARKER_INVALID")
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const opened = fstatSync(fd, { bigint: true }); if (!sameStat(before, opened)) throw Error("BRAND_MARKER_CHANGED")
    const bytes = Buffer.alloc(Number(opened.size)); let offset = 0
    while (offset < bytes.length) { const size = readSync(fd, bytes, offset, bytes.length - offset, null); if (!size) throw Error("BRAND_MARKER_CHANGED"); offset += size }
    const after = fstatSync(fd, { bigint: true }), leaf = lstatSync(path, { bigint: true })
    if (!sameStat(opened, after) || !sameStat(after, leaf) || leaf.nlink !== 1n || !leaf.isFile() || leaf.isSymbolicLink()) throw Error("BRAND_MARKER_CHANGED")
    assertRoot(root); return { stat: after, bytes }
  } finally { closeSync(fd) }
}
/** Also called at lease acquisition/commit; an opposite-family lock can never
 * authorize another independent writer for the same directory. */
export function assertBrandControls(root: RootIdentity, names: Readonly<BrandNames>, kind: "work" | "application" = "work") {
  assertRoot(root); const other = otherBrandNames(names)
  const forbidden = kind === "work" ? [other.workManifest, other.storage, other.storageRequired, other.lock, other.audit, other.restores, other.preserved] : [other.appMarker]
  const entries = readdirSync(root.path).map(name=>name.toLowerCase())
  if (forbidden.some(filename => entries.includes(filename)) || kind === "work" && entries.some(filename => filename.startsWith(other.leaseTemporaryPrefix) && filename.endsWith(".tmp"))) throw Error("BRAND_CONTROL_CONFLICT")
  assertRoot(root)
}
function observe<T>(root: RootIdentity, kind: "work" | "application", parse: (raw: unknown) => T): BrandObservation<T> {
  root = Object.freeze({ ...root }); assertRoot(root)
  const found = BRAND_NAMES.filter(names => exists(join(root.path, kind === "work" ? names.workManifest : names.appMarker)))
  if (found.length !== 1) throw Error(found.length ? "BRAND_MARKER_CONFLICT" : "BRAND_MARKER_MISSING")
  const names = found[0], filename = kind === "work" ? names.workManifest : names.appMarker, limit = kind === "work" ? 4 * 1024 * 1024 : 16 * 1024
  assertBrandControls(root, names, kind)
  const original = snapshot(root, filename, limit), value = parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(original.bytes)))
  if (kind === "application" && (value as ApplicationMarker).app !== names.appIdentity) throw Error("BRAND_MARKER_INVALID")
  const assertCurrent = () => {
    assertBrandControls(root, names, kind); const current = snapshot(root, filename, limit)
    if (!sameStat(current.stat, original.stat) || !current.bytes.equals(original.bytes)) throw Error("BRAND_MARKER_CHANGED")
  }
  assertCurrent(); return { names, filename, value, assertCurrent }
}
export function readApplicationBrandImmediately(root: RootIdentity) { return observe(root, "application", raw => appSchema.parse(raw)) }
export function readWorkBrandImmediately(root: RootIdentity) { return observe(root, "work", raw => workManifestSchema.parse(raw)) }
export async function readApplicationBrand(root: RootIdentity) { return readApplicationBrandImmediately(root) }
export async function readWorkBrand(root: RootIdentity) { return readWorkBrandImmediately(root) }
export function applicationNames(root: RootIdentity | string) { return readApplicationBrandImmediately(typeof root === "string" ? brandRootIdentity(root) : root).names }
export function workNames(root: RootIdentity | string) { return readWorkBrandImmediately(typeof root === "string" ? brandRootIdentity(root) : root).names }
