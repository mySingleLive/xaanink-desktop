"use client"

/**
 * 待答问答桥（候选稿采用 ↔ 对话问答联动）：内容面板据此判断「当前会话是否挂着
 * 命中本候选的待答问题」，命中时把对应选项拼装为问答回答（与 AskUserPanel 提交
 * 同格式同路径——send 自动附 pendingQuestion.interaction 并退去问答面板），
 * 不再另行 REST accept，避免与问答链重复提交。
 */
import { useChatStore } from "@/stores/chat"

import { dispatchChatSendMessage } from "./ui-events"

export interface PendingAnswerMatch {
  question: string
  option: string
}

/**
 * 当前会话待答问题中命中某候选的选项：选项文本含 candidateId 或任一角度名
 * （中文 label 或 variant key）即认定为对应选项。
 * 不计入的情形：无待答问题 / 问题属另一作品的会话 / 故事导航面板（schemaVersion 2
 * 的选择语义是 StorySelection，不按文本选项匹配）——这些交给调用方回退处理。
 * pendingQuestion 仅在为当前会话待答时存在（切换/加载会话即清空），非空即 pending。
 */
export function usePendingAnswerMatch(
  novelId: string,
  candidateId: string | undefined,
  labels: (string | null | undefined)[]
): PendingAnswerMatch | null {
  const pending = useChatStore((s) => s.pendingQuestion)
  const chatNovelId = useChatStore((s) => s.draftNovelId)
  if (!pending || pending.storyNavigation || !candidateId) return null
  if (chatNovelId !== novelId) return null
  const needles = labels.filter((l): l is string => !!l)
  for (const q of pending.questions) {
    for (const option of q.options) {
      if (option.includes(candidateId) || needles.some((l) => option.includes(l))) {
        return { question: q.question, option }
      }
    }
  }
  return null
}

/** 提交命中选项为问答回答：文本格式同 AskUserPanel（历史据此渲染「已回答」摘要） */
export function dispatchPendingAnswer(match: PendingAnswerMatch, novelId: string) {
  dispatchChatSendMessage(`【回答问题】${match.question}\n我的回答：${match.option}`, novelId, { answer: true })
}
