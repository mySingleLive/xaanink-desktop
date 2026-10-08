import { withChatWriteFence } from "@/lib/chat-execution"
import { createScopedClient } from "@desktop/service/context"

/** 仅聊天控制面使用原始客户端；业务写入统一经执行门控。 */
export const controlPrisma = createScopedClient()
export const prisma = withChatWriteFence(controlPrisma)

/** App-wide templates/config; never a per-work copy or credential store. */
export const globalPrisma = createScopedClient("global")
