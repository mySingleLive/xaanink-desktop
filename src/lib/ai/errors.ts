import { NextResponse } from "next/server"
import { ContentError } from "@/lib/content-errors"
import { ERROR_TEXT } from "@/lib/ai/error-classification"

/** 没有可用模型（未配置 / 全部被禁用 / 对应分级缺失） */
export class NoModelAvailableError extends Error {
  constructor(message = "当前没有可用的 AI 模型，请联系管理员在后台配置模型") {
    super(message)
    this.name = "NoModelAvailableError"
  }
}

/** 用户墨滴额度已用尽 */
export class QuotaExceededError extends Error {
  constructor(message = "本月墨滴额度已用尽，请升级套餐或联系管理员补充墨滴") {
    super(message)
    this.name = "QuotaExceededError"
  }
}

/** 提示词模板不存在或已禁用 */
export class PromptNotFoundError extends Error {
  constructor(key: string) {
    super(`提示词模板「${key}」不存在或已禁用，请联系管理员检查提示词配置`)
    this.name = "PromptNotFoundError"
  }
}

/** 当前套餐不允许使用该功能/模型分级 */
export class PlanRestrictedError extends Error {
  constructor(message = "当前套餐不支持该功能，请升级套餐后重试") {
    super(message)
    this.name = "PlanRestrictedError"
  }
}

/**
 * 把已知业务错误映射为 HTTP 响应（API 路由统一使用）。
 * 未知错误统一返回 500，避免内部细节外泄。
 */
export function toErrorResponse(err: unknown): NextResponse {
  if (err instanceof ContentError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: err.status })
  }
  if (err instanceof QuotaExceededError) {
    return NextResponse.json({ error: err.message }, { status: 402 })
  }
  if (err instanceof PlanRestrictedError) {
    return NextResponse.json({ error: err.message }, { status: 403 })
  }
  if (err instanceof NoModelAvailableError) {
    return NextResponse.json({ error: err.message }, { status: 503 })
  }
  if (err instanceof PromptNotFoundError) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
  console.error("[api] 未处理的错误：", err)
  return NextResponse.json({ error: ERROR_TEXT.internalServer }, { status: 500 })
}
