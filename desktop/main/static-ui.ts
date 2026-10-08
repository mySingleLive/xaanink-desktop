import {readFile,realpath} from 'node:fs/promises'
import {join,sep} from 'node:path'
/** Static exported Web UI only; has no database, filesystem-path or API bridge. */
export async function staticUiResponse(request:Request,exportDirectory:string):Promise<Response>{
 const url=new URL(request.url)
 if(url.protocol!=='xaanink:'||url.hostname!=='app'||url.username||url.password||!['GET','HEAD'].includes(request.method))return new Response(null,{status:403})
 try{
  const out=await realpath(exportDirectory),decoded=decodeURIComponent(url.pathname)
  if(/[\\\0]/.test(decoded)||decoded.split('/').includes('..'))return new Response(null,{status:403})
  const path=await realpath(join(out,decoded==='/'?'index.html':decoded))
  if(!path.startsWith(out+sep))return new Response(null,{status:403})
  const extension=path.split('.').at(-1)!
  const types:Record<string,string>={html:'text/html; charset=utf-8',js:'text/javascript',css:'text/css',json:'application/json',svg:'image/svg+xml',png:'image/png',webp:'image/webp',woff2:'font/woff2',ttf:'font/ttf',wasm:'application/wasm',txt:'text/plain'}
  const headers={'Content-Type':types[extension]??'application/octet-stream','Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: xaanink:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-src 'none'",'X-Content-Type-Options':'nosniff'}
  return new Response(request.method==='HEAD'?null:await readFile(path),{headers})
 }catch{return new Response(null,{status:404})}
}
