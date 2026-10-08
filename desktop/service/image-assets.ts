import {getDatabaseContext} from "./context"
/** Paths never come from a renderer; Workspaces supplies the owned directory. */
export function currentWorkAssets(){const context=getDatabaseContext();if(context.workspaceId==="inbox"||!context.assets)throw Error("图片需要已打开的本地作品目录");return context.assets}
export async function saveWorkImage(bytes:Buffer,mime?:string){const image=await currentWorkAssets().save(bytes,mime);return{...image,url:`/_desktop/assets/${getDatabaseContext().workspaceId}/${image.filename}`}}
