import { z } from "zod"
import { modelSchema, settingsSchema, onboardingProgressSchema, type OnboardingProgress } from "../core/settings"
export { onboardingProgressSchema }
export type { OnboardingProgress }
export type OnboardingStep = OnboardingProgress["step"]
const common = { revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), sessionId: z.uuid(), flow: z.enum(["full", "models"]), operationId: z.uuid() }
const draftSchema = modelSchema.omit({ id: true, authRevision: true, encryptedKey: true, keyMask: true }).extend({ id: z.uuid().optional(), apiKey: z.string().max(8192) }).strict()
const selectionSchema = z.discriminatedUnion("type", [
 z.object({type:z.literal("existing"),id:z.uuid()}).strict(),
 z.object({type:z.literal("draft"),model:draftSchema,creationId:z.uuid().optional()}).strict().refine(value=>value.model.id ? !value.creationId : !!value.creationId,"新建及编辑模型身份无效"),
])
export const onboardingActionSchema = z.discriminatedUnion("type", [
 z.object({...common,type:z.literal("theme"),theme:settingsSchema.shape.appearance.shape.theme}).strict(),
 z.object({...common,type:z.literal("next-theme")}).strict(),
 z.object({...common,type:z.literal("profile"),user:settingsSchema.shape.user,avatarSessionId:z.uuid(),avatarDraftId:z.uuid().optional()}).strict(),
 z.object({...common,type:z.literal("start-models")}).strict(),
 z.object({...common,type:z.literal("model"),selection:selectionSchema}).strict(),
 z.object({...common,type:z.literal("image-choice"),choice:z.enum(["configure","skip"])}).strict(),
 z.object({...common,type:z.literal("back")}).strict(),
])
export type OnboardingAction = z.infer<typeof onboardingActionSchema>
type Payload<T> = T extends OnboardingAction ? Omit<T,"revision"|"sessionId"> : never
export type OnboardingPayload = Payload<OnboardingAction>
export type OnboardingErrorCode = "INVALID_ACTION" | "INVALID_TRANSITION" | "REVISION_CONFLICT" | "IDENTITY_CHANGED" | "IDENTITY_LIMIT" | "RETRY_UNAVAILABLE" | "MODEL_UNAVAILABLE" | "CREATION_COLLISION" | "AVATAR_UNAVAILABLE" | "OWNER_UNAVAILABLE" | "SAVE_FAILED"
const messages: Record<OnboardingErrorCode,string> = {
 INVALID_ACTION:"引导数据格式无效，请检查后重试", INVALID_TRANSITION:"引导步骤已变化，请重新打开后继续", REVISION_CONFLICT:"设置已变更，请重新读取后保存",
 IDENTITY_CHANGED:"本次提交内容已变化，请重新确认", IDENTITY_LIMIT:"引导操作次数已达上限，请重新启动应用后继续", RETRY_UNAVAILABLE:"此前提交已保存，请重新打开引导继续",
 MODEL_UNAVAILABLE:"请选择仍存在、已启用且类型对应的模型", CREATION_COLLISION:"新模型标识已被使用，请重新确认", AVATAR_UNAVAILABLE:"头像草稿或资料引用已失效，请重新打开后保存",
 OWNER_UNAVAILABLE:"引导所属窗口已变化或正在关闭，请稍后重试", SAVE_FAILED:"引导保存未能确认，当前资料已保留，请重试",
}
export class OnboardingError extends Error { constructor(readonly code:OnboardingErrorCode){super(messages[code]);this.name="OnboardingError"} }
