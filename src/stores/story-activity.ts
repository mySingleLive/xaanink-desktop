"use client"
import { create } from "zustand"

export interface StoryActivity { novelId: string; conversationId: string; toolCallId: string; title: string; text: string; artifactKey?: string; targetTabId?: string; state: "working" | "saved" | "uncommitted" }
export const useStoryActivityStore = create<{ activity: StoryActivity | null }>(() => ({ activity: null }))
