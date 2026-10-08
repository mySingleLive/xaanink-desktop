import {lstatSync,mkdirSync,realpathSync} from "node:fs"
import {isAbsolute,join} from "node:path"

/** Runs synchronously before Electron readiness can create any Chromium files. */
export function prepareSessionDirectory(root:string):string{
 try{
  if(!isAbsolute(root)||realpathSync(root)!==root)throw Error("noncanonical root")
  const before=lstatSync(root,{bigint:true})
  if(!before.isDirectory()||before.isSymbolicLink())throw Error("invalid root")
  const path=join(root,"session")
  try{mkdirSync(path,{mode:0o700})}catch(error){if((error as NodeJS.ErrnoException).code!=="EEXIST")throw error}
  const session=lstatSync(path,{bigint:true})
  if(!session.isDirectory()||session.isSymbolicLink()||realpathSync(path)!==path)throw Error("invalid session")
  const after=lstatSync(root,{bigint:true}),current=lstatSync(path,{bigint:true})
  if(!after.isDirectory()||after.isSymbolicLink()||realpathSync(root)!==root||after.dev!==before.dev||after.ino!==before.ino||!current.isDirectory()||current.isSymbolicLink()||current.dev!==session.dev||current.ino!==session.ino)throw Error("changed root/session")
  return path
 }catch{throw Error("SESSION_DIRECTORY_UNSAFE")}
}
