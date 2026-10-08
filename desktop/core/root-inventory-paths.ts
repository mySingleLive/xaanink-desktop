// Exact original closed-engine/session ownership classifiers.
// Shared by root migration and portable application package validation.
import {isAbsolute} from 'node:path'
import {z} from 'zod'
import {BRAND_NAMES} from '../shared/brand-names'
export const closedRootCatalogSchema=z.object({schemaVersion:z.literal(1),revision:z.number().int().nonnegative(),value:z.array(z.object({path:z.string().refine(isAbsolute)}).passthrough())}).strict()
const uuid="[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
const fixedRoot=new Set([...BRAND_NAMES.map(names=>names.appMarker),"catalog.json","state.json","drafts.json","backup-plan.json","restore-draft-barrier.json","application-restore-drafts.json"])
const recovery=new RegExp(`^\\.(?:xuanxiang|xaanink)-root-recovery-${uuid}\\.json$`,"i")
const avatar=new RegExp(`^assets/global/${uuid}\\.png$`,"i")
const upgradeSnapshot=new RegExp(`^inbox/snapshots/before-upgrade-\\d{13}-${uuid}\\.tar\\.gz(?:\\.json)?$`,"i")
const pgFixed=new Set(["PG_VERSION","pg_hba.conf","pg_ident.conf","postgresql.conf","postgresql.auto.conf","global/pg_control","global/pg_filenode.map","global/pg_internal.init","pg_logical/replorigin_checkpoint"])
const pgDirs=new Set(["base","global","pg_commit_ts","pg_dynshmem","pg_logical","pg_logical/mappings","pg_logical/snapshots","pg_multixact","pg_multixact/members","pg_multixact/offsets","pg_notify","pg_replslot","pg_serial","pg_snapshots","pg_stat","pg_stat_tmp","pg_subtrans","pg_tblspc","pg_twophase","pg_wal","pg_wal/archive_status","pg_wal/summaries","pg_xact"])
function postgresFile(p:string){
 return pgFixed.has(p)||/^(?:base\/\d+|global)\/\d+(?:_(?:fsm|vm|init))?(?:\.\d+)?$/.test(p)||/^base\/\d+\/(?:PG_VERSION|pg_filenode\.map|pg_internal\.init)$/.test(p)||/^(?:pg_commit_ts|pg_subtrans|pg_xact|pg_multixact\/(?:members|offsets)|pg_serial|pg_notify)\/[0-9A-F]{4,}$/.test(p)||/^pg_wal\/[0-9A-F]{24}$/.test(p)||/^pg_wal\/archive_status\/[0-9A-F]{24}\.(?:ready|done)$/.test(p)||/^pg_wal\/summaries\/[0-9A-F]{40}\.summary$/.test(p)||/^pg_twophase\/[0-9A-F]{8}$/.test(p)||/^pg_stat\/(?:pgstat\.stat|db_\d+\.stat)$/.test(p)
}
const sessionFixed=new Set(["Preferences","Secure Preferences","Local State","Network Persistent State","DIPS","DIPS-wal","DIPS-shm","DIPS-journal","Trust Tokens","Trust Tokens-journal","TransportSecurity","Reporting and NEL","Reporting and NEL-journal","Cookies","Cookies-journal","DevToolsActivePort","declarative_performance_observer.db","declarative_performance_observer.db-journal","Shared Dictionary/db","Shared Dictionary/db-journal"])
const cacheDirs=new Set(["Cache/Cache_Data","Code Cache/js","Code Cache/wasm","GPUCache","DawnGraphiteCache","DawnWebGPUCache","GraphiteDawnCache","Shared Dictionary/cache"])
const leveldbDirs=new Set(["Local Storage/leveldb","Session Storage"])
const leveldbFile=/^(?:CURRENT|LOCK|LOG(?:\.old)?|MANIFEST-\d+|\d+\.(?:log|ldb|sst|dbtmp))$/
function sessionFile(p:string){
 if(sessionFixed.has(p))return true
 const split=p.lastIndexOf("/"),parent=p.slice(0,split),leaf=p.slice(split+1)
 if(leveldbDirs.has(parent))return leveldbFile.test(leaf)
 if(cacheDirs.has(parent))return /^(?:index|data_[0-3]|f_[0-9a-f]{6,}|[0-9a-f]{16}_[0-9]+)$/.test(leaf)
 if(p.endsWith("/index-dir/the-real-index"))return cacheDirs.has(p.slice(0,-"/index-dir/the-real-index".length))
 return /^Code Cache\/electron-preload\/[0-9A-F]{64}-[0-9A-F]{64}\.cache$/.test(p)||/^GPUPersistentCache\/GPUCache\/[A-Z0-9]{32}\/(?:cache\.db(?:-wal|-shm|-journal)?|cache\.journal)$/.test(p)
}
export function ownedRootFile(path:string){return fixedRoot.has(path)||recovery.test(path)||avatar.test(path)||upgradeSnapshot.test(path)||path.startsWith("inbox/database/")&&postgresFile(path.slice(15))||path.startsWith("session/")&&sessionFile(path.slice(8))}
export function ownedRootDirectory(path:string){
 if(["assets","assets/global","inbox","inbox/database","inbox/snapshots","session"].includes(path))return true
 if(path.startsWith("inbox/database/")){const p=path.slice(15);return pgDirs.has(p)||/^base\/\d+$/.test(p)}
 if(!path.startsWith("session/"))return false
 const p=path.slice(8)
 return ["Cache","Cache/No_Vary_Search","Code Cache","Code Cache/electron-preload","Local Storage","Shared Dictionary","GPUPersistentCache","GPUPersistentCache/GPUCache","blob_storage"].includes(p)||cacheDirs.has(p)||leveldbDirs.has(p)||p.endsWith("/index-dir")&&cacheDirs.has(p.slice(0,-10))||/^GPUPersistentCache\/GPUCache\/[A-Z0-9]{32}$/.test(p)
}
