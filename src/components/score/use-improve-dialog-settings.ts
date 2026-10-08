"use client"

import { create } from "zustand"

/**
 * 正文改进对话框的会话内记忆：按 targetId 记住最近一次配置；不写库、不持久化。
 * 无记录时回落默认（3 张、聚合载荷的本章规划字数档、默认勾选规则）。
 */
export interface ImproveDialogCustomItem {
  id: string
  text: string
}

export interface ImproveDialogSettings {
  count: number
  wordMin: number
  wordBudget: number
  customItems: ImproveDialogCustomItem[]
  /** 被取消勾选的改进项 id 集（默认勾选规则之外的作者改动） */
  uncheckedIds: string[]
}

interface ImproveDialogSettingsState {
  byTarget: Record<string, ImproveDialogSettings>
  setSettings: (targetId: string, settings: ImproveDialogSettings) => void
  resetSettings: (targetId: string) => void
}

export const useImproveDialogSettings = create<ImproveDialogSettingsState>((set) => ({
  byTarget: {},
  setSettings: (targetId, settings) => set((s) => ({ byTarget: { ...s.byTarget, [targetId]: settings } })),
  resetSettings: (targetId) =>
    set((s) => {
      const next = { ...s.byTarget }
      delete next[targetId]
      return { byTarget: next }
    }),
}))
