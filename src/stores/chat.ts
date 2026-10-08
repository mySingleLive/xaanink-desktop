"use client"

import type { NovelPosition } from "@/lib/creation-wizard/position"

import { create, type StateCreator } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"

import type { ChatAction, PlanProposal } from "@/lib/chat-parts"
import type { ChatInteraction } from "@/lib/chat-protocol"
import type { PendingQuestion } from "@/components/chat/types"

/** 对话模式：standard=直接执行；plan=计划模式（先出计划，批准后执行） */
export type ChatMode = "standard" | "plan"

/** 执行中消息排队的队列项（§2.5）：生成中发送的消息在此等待，当前轮流结束后自动按序发出；action 为随消息上行的回合动作（正文改进对话框等），出队发送前置回 draftAction */
export interface QueuedMessage {
  id: string
  text: string
  action?: ChatAction
}

/** 新建会话请求的可选载荷：关联指定小说并预填草稿（创建作品向导的对话入口用） */
export interface NewConversationPayload {
  action?: ChatAction
  /** 关联小说 id；null 表示不关联仅闲聊 */
  novelId: string | null
  /** 预填进输入框的草稿（提示词模板），不自动发送 */
  draft?: string
  /**
   * 预填草稿后立即自动发送（故事板面板等入口）：ChatPanel 消费时走与手动发送
   * 相同的 sendText 入口；生成中/问答面板待回答时降级为只填草稿
   */
  autoSend?: boolean
  /**
   * 待创建小说的书名（创建作品向导的对话入口）：进入聊天时不落库，
   * 首条消息发送时才以此书名创建小说并关联本会话；书名在向导里已解析好（含「未命名作品 N」兜底）
   */
  pendingNovelPosition?: NovelPosition
  pendingNovelTitle?: string
}

/** 会话级模型选择：modelId 为本地模型 ID，显式 null 表示未选择；effort=null 为模型默认档。 */
export interface ModelChoice {
  modelId: string | null
  effort: string | null
}

interface ChatState {
  accountId: string | null
  recoveryStatus: "restoring" | "ready"
  recoveryNotice: string | null
  storageNotice: string | null
  draftId: string
  draftNovelId: string | null
  novelCreationRequestId: string | null
  creatingNovel: boolean
  draftAction: ChatAction | null
  pendingPlan: (ChatInteraction & { turnId: string; payload: PlanProposal }) | null
  suspendedExecution: boolean
  pendingRequest: { clientRequestId: string; body: string } | null

  /** 当前会话 id；null 表示新会话（首条消息发送时由服务端创建） */
  conversationId: string | null
  /** 外部组件（侧栏树会话列表）请求切换的会话 id，ChatPanel 监听并加载后清除 */
  requestedConversationId: string | null
  /** 请求展开 AI 对话面板；重复聚焦当前会话时也生效。 */
  chatFocusNonce: number
  /** 外部组件（侧栏树「创建对话」按钮）请求新建会话的标记，ChatPanel 监听并重置后清除 */
  newConversationRequested: boolean
  /** 新建会话请求携带的载荷；null 表示跟随当前激活 tab（默认行为） */
  newConversationPayload: NewConversationPayload | null
  /** 待创建小说的书名（对话入口延迟建书）；首条消息发送时消费，切换/新建会话时清除 */
  pendingNovelPosition: NovelPosition | null
  pendingNovelTitle: string | null
  /** 输入框草稿 */
  draft: string
  /** 是否正在流式生成 */
  isGenerating: boolean
  queuePaused: boolean
  /** 对话模式（随下一条发送生效，逐轮随请求体提交） */
  mode: ChatMode
  modeExplicit: boolean
  /** Enter 键行为（W7 输入交互）：true=Enter 发送/Shift+Enter 换行；false=反转。persist 持久化 */
  enterToSend: boolean
  /** 当前会话的模型选择（切换/新建会话时从会话记录同步或归零），随发送请求体提交 */
  modelChoice: ModelChoice
  modelChoiceExplicit: boolean
  /**
   * 思考强度记忆（modelId → 上次所选档位）：选择器「再次选择该模型时恢复上次强度」
   * 的数据源，经 persist 落 localStorage（换浏览器/设备不同步）；
   * 仅用户在选择器里的显式选择会写入（loadConversation 等同步不回写，防旧会话值覆盖新选择）
   */
  modelEffortMemory: Record<string, string>
  /**
   * 上次显式选择的模型+强度。只作选择历史，不能覆盖设置中的新任务默认值。
   */
  lastModelChoice: ModelChoice | null
  /** 参谋通过 askUserQuestion 发起的待回答问题；非空且生成结束时问答面板替换输入框 */
  pendingQuestion: PendingQuestion | null
  /** 执行中排队的消息（仅当前会话有效；切换/新建会话时清空，防串会话发送） */
  queuedMessages: QueuedMessage[]
  setConversationId: (id: string | null) => void
  requestConversation: (id: string) => void
  requestChatFocus: () => void
  clearRequestedConversation: () => void
  /** 请求新建会话；带 payload 时关联指定小说并可预填草稿，无参则跟随当前激活 tab */
  requestNewConversation: (payload?: NewConversationPayload) => void
  clearNewConversationRequest: () => void
  setDraft: (draft: string) => void
  setIsGenerating: (generating: boolean) => void
  setMode: (mode: ChatMode) => void
  setEnterToSend: (enterToSend: boolean) => void
  setModelChoice: (choice: ModelChoice) => void
  /** 记录某模型上次选择的思考强度（选择器写入；模型重新登记换 id 后自然失效回默认） */
  rememberModelEffort: (modelId: string, effort: string) => void
  /** 记录上次显式选择的模型+强度。 */
  rememberModelChoice: (choice: ModelChoice) => void
  setPendingQuestion: (pending: PendingQuestion | null) => void
  setPendingNovelTitle: (title: string | null) => void
  enqueueMessage: (msg: QueuedMessage) => void
  removeQueuedMessage: (id: string) => void
  /** 「立即发送」用：把队列项提到队首（随后停止当前流，自动按序机制自然拿起它） */
  moveQueuedToFront: (id: string) => void
  clearQueuedMessages: () => void
}

const chatStore: StateCreator<ChatState> = (set) => ({
  accountId: null,
  recoveryStatus: "restoring",
  recoveryNotice: null,
  storageNotice: null,
  draftId: "",
  draftNovelId: null,
  novelCreationRequestId: null,
  creatingNovel: false,
  suspendedExecution: false,
  draftAction: null,
  pendingPlan: null,
  pendingRequest: null,
  conversationId: null,
  requestedConversationId: null,
  chatFocusNonce: 0,
  newConversationRequested: false,
  newConversationPayload: null,
  pendingNovelTitle: null,
  pendingNovelPosition: null,
  draft: "",
  isGenerating: false,
  queuePaused: false,
  mode: "standard",
  modeExplicit: false,
  enterToSend: true,
  modelChoice: { modelId: null, effort: null },
  modelChoiceExplicit: false,
  modelEffortMemory: {},
  lastModelChoice: null,
  pendingQuestion: null,
  queuedMessages: [],
  setConversationId: (conversationId) => set({ conversationId }),
  requestConversation: (id) => set({ requestedConversationId: id }),
  requestChatFocus: () => set(s => ({ chatFocusNonce: s.chatFocusNonce + 1 })),
  clearRequestedConversation: () => set({ requestedConversationId: null }),
  requestNewConversation: (payload) =>
    set({
      newConversationRequested: true,
      newConversationPayload: payload ?? null,
      // 无载荷（「创建对话」）或载荷不带书名时一律清掉上一轮的待创建书名
      pendingNovelTitle: payload?.pendingNovelTitle ?? null,
      pendingNovelPosition: payload?.pendingNovelPosition ?? null,
      novelCreationRequestId: payload?.pendingNovelTitle ? crypto.randomUUID() : null,
    }),
  clearNewConversationRequest: () =>
    set({ newConversationRequested: false, newConversationPayload: null }),
  setDraft: (draft) => set({ draft }),
  setIsGenerating: (isGenerating) => set({ isGenerating }),
  setMode: (mode) => set({ mode, modeExplicit: true }),
  setEnterToSend: (enterToSend) => set({ enterToSend }),
  setModelChoice: (modelChoice) => set({ modelChoice, modelChoiceExplicit: true }),
  rememberModelEffort: (modelId, effort) =>
    set((s) => ({ modelEffortMemory: { ...s.modelEffortMemory, [modelId]: effort } })),
  rememberModelChoice: (lastModelChoice) => set({ lastModelChoice }),
  setPendingQuestion: (pendingQuestion) => set({ pendingQuestion }),
  setPendingNovelTitle: (pendingNovelTitle) => set({ pendingNovelTitle, ...(pendingNovelTitle === null ? { novelCreationRequestId: null, pendingNovelPosition: null } : {}) }),
  enqueueMessage: (msg) => set((s) => ({ queuedMessages: [...s.queuedMessages, msg] })),
  removeQueuedMessage: (id) =>
    set((s) => ({ queuedMessages: s.queuedMessages.filter((q) => q.id !== id) })),
  moveQueuedToFront: (id) =>
    set((s) => {
      const target = s.queuedMessages.find((q) => q.id === id)
      if (!target) return s
      return { queuedMessages: [target, ...s.queuedMessages.filter((q) => q.id !== id)] }
    }),
  clearQueuedMessages: () => set({ queuedMessages: [] }),
})

export const useChatStore = create<ChatState>()(
  persist(chatStore, {
    name: "chat-model-effort-memory",
    partialize: (s) => ({ modelEffortMemory: s.modelEffortMemory, lastModelChoice: s.lastModelChoice, enterToSend: s.enterToSend }),
    storage: createJSONStorage(() => localStorage),
  })
)
