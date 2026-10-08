import {join} from 'node:path'
import {z} from 'zod'
import {catalogSchema,type WorkRecord} from './workspaces'
import {workManifestSchema} from '../shared/workspace'
import {assertDirectory,directoryIdentity,readMetadata,sameIdentity} from '../core/root-ownership'
import {readWorkBrand} from '../core/brand-names'

/** Read-only catalog lookup after the trusted worker acknowledged closing all
 * engines. This function never initializes or opens a database to repair it.
 */
export async function closedWorkLeaseTarget(works:{list():Promise<WorkRecord[]>},input:unknown,assertClosed:()=>void){
 const id=z.uuid().parse(input)
 const guard=()=>{const result=(assertClosed as ()=>unknown)();if(result!==undefined){if(result instanceof Promise)void result.catch(()=>{});throw Error('WORK_LEASE_CLOSED_PROOF_INVALID')}}
 guard();const rows=catalogSchema.parse(await works.list()).filter(row=>row.id===id);guard()
 if(rows.length!==1)throw Error(rows.length?'WORK_LEASE_CATALOG_INVALID':'WORK_LEASE_NOT_REGISTERED')
 const record=rows[0],root=await directoryIdentity(record.path);guard()
 if(!sameIdentity(root,record.identity))throw Error('WORK_LEASE_TARGET_CHANGED')
 const brand=await readWorkBrand(root),manifest=brand.value;guard();brand.assertCurrent()
 if(manifest.id!==record.id||manifest.novelId!==record.novelId||manifest.phase!=='ready')throw Error('WORK_LEASE_TARGET_MISMATCH')
 await assertDirectory(root);guard();return root
}
