import type {FileExportBridge} from "./file-export"
import { z } from "zod"
import {localBodyLimit,MAX_LOCAL_BODY_BYTES} from "./request-limits"
import type {ConfigurationPreview,ConfigurationFileAction} from "./configuration"
import type {DraftSnapshot,DraftReceipt} from "./drafts"
import type {CloseReply,PrepareClose} from "./close"
import type { PublicModel, Settings } from "../core/settings"
import type { ModelDraft } from "../main/model-repository"
import type { DirectoryPurpose } from "../main/directory-authority"
import type { ConfigurationDraft, CatalogResult, ConnectionTestResult, ConfigurationFailure } from "./model-catalog"
import type {WorkLeaseRequest,WorkLeaseResult} from "./work-lease"
import type { ModelTask } from './model-task'

export const requestSchema = z.object({
  version: z.literal(1), id: z.uuid(), path: z.string().min(5).max(4096),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  headers: z.record(z.string().max(100), z.string().max(2048)),
  body: z.union([z.instanceof(Uint8Array).refine(bytes=>bytes.byteLength<=MAX_LOCAL_BODY_BYTES),z.array(z.number().int().min(0).max(255)).max(MAX_LOCAL_BODY_BYTES)]).optional(),
}).strict().superRefine((request, context) => {
  if (!request.path.startsWith("/api/") || /[\\\x00-\x1f#]/.test(request.path)) context.addIssue({ code: "custom", message: "本地请求路径无效" })
  try {
    const url = new URL(request.path, "https://local.invalid")
    if (url.origin !== "https://local.invalid" || url.pathname !== request.path.split("?")[0] || /%(?:2f|5c|00)/i.test(url.pathname) || decodeURIComponent(url.pathname).split("/").some(part => part === "." || part === "..")) context.addIssue({ code: "custom", message: "本地路径不能越界" })
  } catch { context.addIssue({ code: "custom", message: "本地请求路径无效" }) }
  if (Object.keys(request.headers).length > 16 || Object.keys(request.headers).some(name => !["accept", "content-type", "if-match", "x-request-id"].includes(name.toLowerCase()))) context.addIssue({ code: "custom", message: "不支持此请求头" })
  if (new Set(Object.keys(request.headers).map(name => name.toLowerCase())).size !== Object.keys(request.headers).length) context.addIssue({ code: "custom", message: "请求头不能重复" })
  if (request.method === "GET" && request.body?.length) context.addIssue({ code: "custom", message: "读取请求不能包含正文" })
  const contentType=Object.entries(request.headers).find(([name])=>name.toLowerCase()==="content-type")?.[1]
  if((request.body?.length??0)>localBodyLimit(request.method,request.path,contentType))context.addIssue({code:"custom",message:"本地请求正文过大"})
}).transform(request => ({ ...request, headers: Object.fromEntries(Object.entries(request.headers).map(([name, value]) => [name.toLowerCase(), value])) }))
export type LocalRequest = z.infer<typeof requestSchema>
export interface LocalResponse { id: string; status: number; headers: Record<string, string> }
export interface StateSnapshot { revision: number; settings: Settings; models: PublicModel[]; onboarding?: import("./onboarding").OnboardingProgress | null }
export interface Bootstrap extends StateSnapshot { platform: "darwin" | "win32"; version: string; dataRoot: string; draftSessionId: string; systemDark: boolean }
export type DesktopBootstrap=Bootstrap
export interface AvatarDraft { draftId: string; previewDataUrl: string; width: number; height: number; bytes: number }
export interface ModelRequiredNotice { type: "model-required"; role: "text" | "review" | "image"; code: "MODEL_NOT_CONFIGURED" | "MODEL_NOT_SELECTED" | "MODEL_NOT_FOUND" | "MODEL_DISABLED" | "MODEL_KEY_MISSING" | "MODEL_KIND_MISMATCH" | "MODEL_UNAVAILABLE" | "AUTHORIZATION_REVOKED"; task?: ModelTask }
export type SettingsAction = { type: "update"; revision: number; settings: Settings } | { type: "save-profile"; revision: number; sessionId: string; user: Settings["user"]; avatarDraftId?: string } | { type: "save-model"; revision: number; model: ModelDraft } | { type: "remove-model"; revision: number; id: string }
export type DesktopEvent = ModelRequiredNotice | { type: "service-disconnected" } | { type: "state"; state: StateSnapshot } | { type: "command"; id: string } | { type: "theme"; dark: boolean } | PrepareClose | {type:"close-cancelled"} | {type:"migration-cancel-pending"} | {type:"work-lease-pending"}
export interface DesktopBridge extends FileExportBridge {
  bootstrap(): Promise<DesktopBootstrap>
  persistDraft(sessionId:string,snapshot:DraftSnapshot):Promise<DraftReceipt>
  readDraft(sessionId:string):Promise<DraftSnapshot|null>
  markDraftReady(sessionId:string):Promise<void>
  replyClose(sessionId:string,id:string,reply:CloseReply):Promise<boolean>
  exportDraft(sessionId:string,snapshot:DraftSnapshot):Promise<boolean>
  request(request: LocalRequest): Promise<LocalResponse>
  cancelRequest(id: string): Promise<void>
  settings(action: SettingsAction): Promise<StateSnapshot>
  onboarding(action: import("./onboarding").OnboardingAction): Promise<StateSnapshot>
  discoverModels(operationId: string, draft: ConfigurationDraft): Promise<CatalogResult | ConfigurationFailure>
  testModel(operationId: string, draft: ConfigurationDraft): Promise<ConnectionTestResult | ConfigurationFailure>
  cancelModelConfiguration(operationId: string): Promise<void>
  chooseAvatar(sessionId: string, acceptedDraftId?: string | null): Promise<AvatarDraft | null>
  cancelAvatar(sessionId: string): Promise<void>
  cancelAvatarSelection(input: { sessionId: string; draftId: string | null }): Promise<void>
  configuration(action:ConfigurationFileAction):Promise<ConfigurationPreview|StateSnapshot|boolean|null>
  migrateRoot(action:"start"|"cancel"):Promise<boolean>
  repairWorkLease(action:WorkLeaseRequest):Promise<WorkLeaseResult>
  chooseDirectory(purpose: DirectoryPurpose): Promise<{ id: string; path: string } | null>
  command(id: string): Promise<void>
  readClipboardText(): Promise<string>
  writeClipboardText(text: string): Promise<void>
  showInputContextMenu(state: import("./input-context-menu").InputContextState): Promise<import("./input-context-menu").InputContextCommand | null>
  subscribe(listener: (event: DesktopEvent) => void): () => void
}
