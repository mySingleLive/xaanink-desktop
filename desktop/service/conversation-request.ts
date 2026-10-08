import {z} from 'zod'
import {requestSchema,type LocalRequest} from '../shared/ipc'
import {conversationRequestOriginSchema,type ConversationRequestOrigin} from '../shared/conversation-task'

const envelope=z.object({request:requestSchema,origin:conversationRequestOriginSchema}).strict().refine(value=>
 value.request.method==='POST'&&new URL(value.request.path,'https://local.invalid').pathname==='/api/chat'&&value.origin.requestId===value.request.id,
 {message:'目录授权只能属于原聊天请求'},
)
/** Only the main/worker RPC has an envelope. Ordinary requests retain their
 * strict renderer schema and cannot supply a task origin of their own. */
export function parseConversationWorkerRequest(value:unknown):{request:LocalRequest;origin?:ConversationRequestOrigin}{
 if(value&&typeof value==='object'&&'request'in value)return envelope.parse(value)
 return{request:requestSchema.parse(value)}
}
