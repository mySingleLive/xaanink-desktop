import {z} from 'zod'
interface CapturePeer {call<T>(method:string,value?:unknown):Promise<T>}
/** Worker-only reverse RPC, inside the engine mutexes. Renderer cannot issue
 * either method or provide a snapshot token. */
export async function withApplicationMetadataSnapshot<T>(peer:CapturePeer,run:()=>Promise<T>):Promise<T>{
 const id=z.uuid().parse(await peer.call('application.capture.acquire'))
 try{return await run()}
 finally{if(await peer.call('application.capture.release',id)!==true)throw Error('APPLICATION_CAPTURE_RELEASE_FAILED')}
}
