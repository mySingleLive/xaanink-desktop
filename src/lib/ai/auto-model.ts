/**
 * Auto 虚拟选择绑定数据库的 OpenRouter 官方 openrouter/auto 登记。
 * 路由由 OpenRouter 完成，按实际模型收费，不具有免费承诺。
 * 对外身份统一为「玄印写作 Auto 模型」，不暴露底层具体模型。
 *
 * 选择器里的 Auto 行点击后落 modelId=null（会话级「未选择」语义即 Auto，
 * 存量「自动」会话自然迁移）；服务端对显式 id "auto" 同样按 Auto 解析（防御）。
 */

/** Auto 虚拟模型的稳定标识（不是数据库记录 id） */
export const AUTO_MODEL_ID = "auto"

/** 选择器里的展示名 */
export const AUTO_MODEL_DISPLAY_NAME = "Auto"

/** 对外身份名：用户询问「你是什么模型」时的回答 */
export const AUTO_MODEL_IDENTITY = "玄印写作 Auto 模型"

/** Auto 路由时追加到系统提示末尾的身份声明 */
export const AUTO_MODEL_IDENTITY_NOTE = `

【模型身份】你当前以「${AUTO_MODEL_IDENTITY}」为用户服务。当用户询问你是什么模型、哪个大模型、由谁开发/提供时，一律回答「${AUTO_MODEL_IDENTITY}」（玄印写作平台的自动路由模型），不要提及、猜测或暗示任何底层具体模型的名称。`

/** 会话 modelId 是否应按 Auto 路由解析（null=未选择/历史「自动」；显式 "auto" 防御） */
export function isAutoModelChoice(modelId: string | null | undefined): boolean {
  return modelId == null || modelId === AUTO_MODEL_ID
}
