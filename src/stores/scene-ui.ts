"use client"
import { create } from "zustand"
import { persist } from "zustand/middleware"
import type { EditorMode } from "@/components/editor/MarkdownEditor"
import type { SceneRecord } from "@/components/content/types"
import type { ChipData } from "@/components/chat/composer-editor"
export interface SceneDraft {value: SceneRecord; baseline: number; operationId?: string; saved?: boolean}
export interface SceneImageRequest {kind: "exterior" | "interior"; prompt: string; modelId?: string; operationId: string}
export interface SceneSubmission {accountId: string; batch: import("@/lib/staged-save").StagedBatchPayload}
interface Pref {expanded?: string[]; focus?: string; hidden?: boolean; scope?: string | null; modes?: Record<string, EditorMode>; search?: string; keyboardOpen?: boolean; keyboardTab?: string; focusHeading?: string}
interface State {
 prefs: Record<string, Pref>; drafts: Record<string, SceneDraft>; imageDrafts: Record<string, {prompt: string; modelId: string; revision?: number}>;
 imageRequests: Record<string, SceneImageRequest>; submissions: Record<string, SceneSubmission>; commitErrors: Record<string, string>;
 setImageRequest: (key: string, request: SceneImageRequest | null) => void; setSubmission: (key: string, submission: SceneSubmission | null) => void; setCommitError: (key: string, message: string | null) => void;
 action: {novelId: string; sceneId: string; type: "create" | "move" | "delete"} | null;
 requestAction: (novelId: string, sceneId: string, type: "create" | "move" | "delete") => void; clearAction: () => void;
 reference: {novelId: string; chip: ChipData; nonce: number} | null;
 setPref: (key: string, patch: Pref) => void; setDraft: (key: string, draft: SceneDraft | null) => void;
 setImageDraft: (key: string, value: {prompt: string; modelId: string; revision?: number}) => void;
 quote: (novelId: string, chip: ChipData) => void; consume: () => void;
}
export const useSceneUiStore = create<State>()(persist((set) => ({
 prefs: {}, drafts: {}, imageDrafts: {}, imageRequests: {}, submissions: {}, commitErrors: {},
 setImageRequest: (key, request) => set(s => {const imageRequests = {...s.imageRequests}; if(request) imageRequests[key] = request; else delete imageRequests[key]; return {imageRequests}}),
 setSubmission: (key, submission) => set(s => {const submissions = {...s.submissions}; if(submission) submissions[key] = submission; else delete submissions[key]; return {submissions}}),
 setCommitError: (key, message) => set(s => {const commitErrors = {...s.commitErrors}; if(message) commitErrors[key] = message; else delete commitErrors[key]; return {commitErrors}}),
 reference: null, action: null,
 requestAction: (novelId, sceneId, type) => set({action: {novelId, sceneId, type}}), clearAction: () => set({action: null}),
 setPref: (key, patch) => set(s => ({prefs: {...s.prefs, [key]: {...s.prefs[key], ...patch}}})),
 setDraft: (key, draft) => set(s => {const drafts = {...s.drafts}; if (draft) drafts[key] = draft; else delete drafts[key]; return {drafts}}),
 setImageDraft: (key, value) => set(s => ({imageDrafts: {...s.imageDrafts, [key]: {...value, revision: (s.imageDrafts[key]?.revision ?? 0) + 1}}})),
 quote: (novelId, chip) => set({reference: {novelId, chip, nonce: Date.now()}}), consume: () => set({reference: null}),
}), {name: "scene-workspace-v1", partialize: s => ({prefs: s.prefs, drafts: s.drafts, imageDrafts: s.imageDrafts, imageRequests: s.imageRequests, submissions: s.submissions, commitErrors: s.commitErrors})}))
const guards = new Map<string, () => Promise<void>>()
export function registerSceneLeaveGuard(tabId: string, guard: () => Promise<void>) {guards.set(tabId, guard); return () => {if (guards.get(tabId) === guard) guards.delete(tabId)}}
export function sceneLeaveGuard(tabId: string | null) {return tabId ? guards.get(tabId) : undefined}
