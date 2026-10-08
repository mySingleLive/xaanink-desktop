"use client"

import { create } from "zustand"

/**
 * 抽卡候选卡的会话内选中态（card-select F1）：点击组卡候选 → 记录选中，对话区输入框
 * 槽位切换为「选卡操作面板」。不写库、不持久化；切换会话由 ChatPanel 效果清空。
 * conversationId 用于归属校验：非当前会话的选中不渲染（双保险）。
 */
export interface CardSelection {
  conversationId: string | null
  novelId: string
  chapterId: string
  chapterTitle: string
  candidateId: string
  label: string
}

interface CardSelectionState {
  selection: CardSelection | null
  selectCard: (selection: CardSelection) => void
  clearCard: () => void
}

export const useCardSelection = create<CardSelectionState>((set) => ({
  selection: null,
  selectCard: (selection) => set({ selection }),
  clearCard: () => set({ selection: null }),
}))
