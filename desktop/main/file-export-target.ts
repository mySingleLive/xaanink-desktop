import {BRAND_NAMES} from '../shared/brand-names'
import {lstat,realpath} from 'node:fs/promises'
import {basename,dirname,isAbsolute,join,relative,resolve,sep} from 'node:path'
const internals=new Set([...BRAND_NAMES.flatMap(names=>[names.workManifest,names.storage,names.storageRequired,names.lock,names.audit,names.restores,names.preserved]),'database','assets','backups','snapshots'])
const leaseTemporary=/^\.(?:xuanxiang|xaanink)-lease-recovery-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/i
function inside(path:string,root:string){const value=relative(root,path);return value===''||value!=='..'&&!value.startsWith('..'+sep)&&!isAbsolute(value)}
async function canonicalRoot(path:string){try{return await realpath(path)}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return resolve(path);throw error}}
async function exists(path:string){try{await lstat(path);return true}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error}}
const blocked=()=>{throw Error('EXPORT_TARGET_PROTECTED')}
function workTarget(path:string,root:string){if(inside(path,root)){const part=relative(root,path).split(sep)[0].toLowerCase();if(!part||internals.has(part)||leaseTemporary.test(part))blocked()}}
/** Only native-dialog targets enter this guard. Exporting ordinary documents
 * into a work folder is allowed; the app's private data is never an export. */
export async function guardFileExportTarget(selected:string,roots:{dataRoots:readonly string[];workRoots:readonly string[]}){
 if(!isAbsolute(selected)||/[\x00-\x1f]/.test(selected))blocked()
 const target=join(await realpath(dirname(selected)),basename(selected))
 for(const root of roots.dataRoots)if(inside(target,await canonicalRoot(root)))blocked()
 for(const root of roots.workRoots)workTarget(target,await canonicalRoot(root))
 // Protect an offline/unregistered work or a previous application root too.
 // A corrupt marker still reserves its internal paths; it is not read here.
 for(let directory=dirname(target);;directory=dirname(directory)){
  for(const names of BRAND_NAMES)if(await exists(join(directory,names.appMarker)))blocked()
  for(const names of BRAND_NAMES)if(await exists(join(directory,names.workManifest)))workTarget(target,directory)
  if(dirname(directory)===directory)break
 }
}
