"use client"

import { create } from "zustand"

import { REDRAW_DEFAULT_COUNT, type DrawRedrawSettings } from "@/lib/draw-redraw"

/**
 * 抽卡设置悬浮框的会话内记忆：按 chapterId 记住最近一次设置；不写库、不持久化。
 * 无记录时回落默认（3 张、组卡携带的本章规划字数档）。
 */
interface DrawRedrawSettingsState {
  byChapter: Record<string, DrawRedrawSettings>
  setSettings: (chapterId: string, settings: DrawRedrawSettings) => void
  resetSettings: (chapterId: string) => void
}

export const useDrawRedrawSettings = create<DrawRedrawSettingsState>((set) => ({
  byChapter: {},
  setSettings: (chapterId, settings) => set((s) => ({ byChapter: { ...s.byChapter, [chapterId]: settings } })),
  resetSettings: (chapterId) =>
    set((s) => {
      const next = { ...s.byChapter }
      delete next[chapterId]
      return { byChapter: next }
    }),
}))

/** 当前生效设置：有记忆用记忆，否则默认（3 张、组卡携带的本章规划档） */
export function drawRedrawSettingsOf(
  byChapter: Record<string, DrawRedrawSettings>,
  chapterId: string,
  defaults: { wordMin: number; wordBudget: number }
): DrawRedrawSettings {
  return byChapter[chapterId] ?? { count: REDRAW_DEFAULT_COUNT, wordMin: defaults.wordMin, wordBudget: defaults.wordBudget }
}
