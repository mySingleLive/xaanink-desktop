import type {RootIdentity} from './data-root'
import type {ApplicationBackup} from '../shared/application-backup'
import {hashRegular,managedPath} from './root-ownership'
import type {StoredFile} from './application-backup-files'
/** Read-only evidence, not a candidate/activation capability. Full candidate
 * checks bound the entire IO phase; per-chunk checks protect the cold host and
 * each actual source file without O(files × candidate files) synchronous stats.
 * The caller's original immutable tree must still pass after the final await. */
export async function inspectClosedApplicationSnapshotSource(source:RootIdentity,expected:readonly ApplicationBackup['files'][number][],guard:()=>void|Promise<void>,assertCandidateImmediately:()=>void):Promise<StoredFile[]>{
 const files:StoredFile[]=[];assertCandidateImmediately();await guard()
 for(const file of expected){const observed=await hashRegular(await managedPath(source,file.path),guard);if(observed.sha256!==file.sha256||observed.size!==file.size)throw Error('APPLICATION_RESTORE_BEFORE_SNAPSHOT_NOT_CURRENT');files.push({path:file.path,...observed})}
 await guard();assertCandidateImmediately();return files
}
