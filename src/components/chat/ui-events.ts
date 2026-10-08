"use client"

import type { ChatAction } from "@/lib/chat-parts"

/** 对话面板内的轻量 UI 指令事件（错误卡行动按钮 → 输入区/模型选择器），避免跨层 prop 传递。 */
export const CHAT_OPEN_MODEL_PICKER_EVENT = "chat:open-model-picker"
export const CHAT_FOCUS_COMPOSER_EVENT = "chat:focus-composer"
/** 内容面板 → 对话面板：以用户消息发送文本到当前会话（候选稿「以此为基础改进」等），detail={ text, novelId, answer, action } */
export const CHAT_SEND_MESSAGE_EVENT = "chat:send-message"

export function dispatchChatUiEvent(name: string) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(name))
}

/**
 * novelId 用于 ChatPanel 核对会话关联：与当前会话作品不一致时退回新建会话入口，不串戏。
 * answer=true 表示这是对当前待答问题的回答（走 AskUserPanel 同路径：send 自动附
 * pendingQuestion.interaction 提交并退去问答面板），作品不匹配时不退化为新会话消息。
 * action 为随消息上行的回合动作（如正文改进对话框的 improve+draw 载荷）；作品不匹配时随新会话载荷保留。
 */
export function dispatchChatSendMessage(text: string, novelId?: string | null, options?: { answer?: boolean; action?: ChatAction }) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(CHAT_SEND_MESSAGE_EVENT, {
        detail: { text, novelId: novelId ?? null, answer: options?.answer === true, action: options?.action },
      })
    )
  }
}
