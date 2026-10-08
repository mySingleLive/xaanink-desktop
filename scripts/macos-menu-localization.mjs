import {readdir,lstat,readFile,writeFile,realpath,mkdir} from 'node:fs/promises'
import {join} from 'node:path'
export const MAC_MENU_LOCALIZED_BYTES=Buffer.from('"CFBundleName" = "玄印";\n','utf8')
async function nativeResources(application){
 const resources=join(application,'Contents/Resources')
 const info=await lstat(resources)
 if(!info.isDirectory()||info.isSymbolicLink()||await realpath(resources)!==resources)throw Error('Unsafe native resources directory')
 return resources
}
async function localizationDirectories(application){
 const resources=await nativeResources(application)
 const entries=(await readdir(resources,{withFileTypes:true})).filter(row=>row.name.endsWith('.lproj')).sort((a,b)=>a.name.localeCompare(b.name))
 if(!entries.some(row=>row.name==='en.lproj')||!entries.some(row=>row.name==='zh_CN.lproj'))throw Error('Missing required native locale directories')
 for(const entry of entries)if(!entry.isDirectory()||!/^[A-Za-z]+(?:_[A-Za-z0-9]+)*\.lproj$/.test(entry.name))throw Error('Unsafe native locale: '+entry.name)
 return entries.map(row=>join(resources,row.name))
}
/** Build-only bundle metadata. Does not modify Electron's raw runtime/helper name. */
export async function installMacMenuLocalization(application){
 // electron-builder omits the runtime's empty language directories when copying
 // its unpacked distribution. Create only the two required native metadata dirs.
 const resources=await nativeResources(application)
 for(const locale of ['en.lproj','zh_CN.lproj']){
  try{await mkdir(join(resources,locale))}catch(error){if(error.code!=='EEXIST')throw error}
 }
 const directories=await localizationDirectories(application)
 for(const directory of directories)await writeFile(join(directory,'InfoPlist.strings'),MAC_MENU_LOCALIZED_BYTES,{flag:'wx'})
 return verifyMacMenuLocalization(application)
}
export async function verifyMacMenuLocalization(application){
 const directories=await localizationDirectories(application)
 for(const directory of directories){
  const path=join(directory,'InfoPlist.strings'),info=await lstat(path)
  if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.size!==MAC_MENU_LOCALIZED_BYTES.length||(await realpath(path))!==path||!(await readFile(path)).equals(MAC_MENU_LOCALIZED_BYTES))throw Error('Missing or unexpected native menu localization: '+path)
 }
 return{locales:directories.length,menuName:'玄印',runtimeName:'玄印写作'}
}
