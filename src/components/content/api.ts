/** 面板共用的轻量 fetch 封装：统一错误信息读取 */
import { tryStageRequest } from "@/stores/staged-changes"

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message) }
}

export async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string }
    return data.error ?? fallback
  } catch {
    return fallback
  }
}

export async function apiGet<T>(url: string, fallback = "读取失败"): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new ApiError(await readError(res, fallback), res.status)
  return (await res.json()) as T
}

export async function apiSend<T>(
  url: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: unknown,
  fallback = "操作失败"
): Promise<T> {
  // 三阶段保存：命中白名单的「面板修改/删除/世界观内创建」零网络暂存并返回合成回执；
  // 未命中（生成/候选/级联/评论/图像等显式动作）直接放行走真实请求。
  const staged = await tryStageRequest(url, method, body)
  if (staged) return staged as T
  const res = await fetch(url, {
    method,
    ...(body !== undefined
      ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
      : {}),
  })
  if (!res.ok) {
    const error = await res.json().catch(() => null) as { error?: string; code?: string } | null
    throw new ApiError(error?.error ?? fallback, res.status, error?.code)
  }
  return (await res.json()) as T
}
