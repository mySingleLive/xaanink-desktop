import type {PGlite} from '@electric-sql/pglite'
import type {WorkspaceAssets} from '../workspace-assets'
import type {WorkManifest} from '../../shared/workspace'
import type {BackupSnapshot} from '../../core/work-backups'
import packageInfo from '../../../package.json'

/** PGlite 0.5.8 dumpDataDir itself does not acquire either engine mutex.
 * Retain the transaction mutex and then the query mutex while exporting the
 * complete WAL/data image. Never query the root engine from inside that lease.
 * Versions/migrations are immutable for the lifetime of an initialized engine.
 */
export async function captureWorkBackup(engine:PGlite,assets:WorkspaceAssets,work:WorkManifest):Promise<BackupSnapshot>{
 const postgres=(await engine.query<{server_version:string}>('SHOW server_version')).rows[0].server_version
 const migrations=(await engine.query<{id:string;checksum:string}>('SELECT id,checksum FROM "_desktop_migrations" ORDER BY id')).rows
 return assets.snapshot(files=>engine._runExclusiveTransaction(()=>engine.runExclusive(async()=>{
  await engine.syncToFs()
  const dump=await engine.dumpDataDir('gzip')
  return{work:structuredClone(work),engine:{pglite:packageInfo.dependencies['@electric-sql/pglite'],postgres,migrations},database:Buffer.from(await dump.arrayBuffer()),assets:files}
 })))
}
