import { globalPrisma as prisma } from "@/lib/db"
import { PromptNotFoundError } from "@/lib/ai/errors"
import { currentPromptCache, clearPromptCache } from "./cache"
import { PROMPT_VARIABLE_PATTERN } from "./variables"
import { localTemplateLibrary } from "@desktop/service/template-library"

/** 模板内存缓存：key -> { content, cachedAt }，TTL 60 秒 */
const CACHE_TTL_MS = 60_000

async function loadTemplateContent(key: string): Promise<string> {
  const templateCache = currentPromptCache()
  const cached = templateCache.get(key)
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.content
  }

  await localTemplateLibrary.ensureReady()
  const template = await prisma.promptTemplate.findFirst({
    where: { key, enabled: true },
  })
  if (!template) {
    throw new PromptNotFoundError(key)
  }

  templateCache.set(key, { content: template.content, cachedAt: Date.now() })
  return template.content
}

/**
 * 渲染提示词模板：从 DB 取 enabled 的模板并替换 {{变量}} 占位符。
 * 模板带 60 秒内存缓存；本地模板保存后立即清除对应库缓存。
 * 模板不存在抛 PromptNotFoundError；缺失变量抛 Error。
 */
export async function renderPrompt(
  key: string,
  vars: Record<string, string> = {}
): Promise<string> {
  const content = await loadTemplateContent(key)

  const missing = new Set<string>()
  const rendered = content.replace(PROMPT_VARIABLE_PATTERN, (raw, name: string) => {
    const value = Object.hasOwn(vars, name) ? vars[name] : undefined
    if (typeof value !== "string") {
      missing.add(name)
      return raw
    }
    return value
  })

  if (missing.size > 0) {
    throw new Error(
      `渲染提示词「${key}」失败，缺少变量：${Array.from(missing).join("、")}`
    )
  }
  return rendered
}

/** 清除模板缓存；不传 key 则清空全部。admin 修改模板后可调用以立即生效。 */
export function invalidatePromptCache(key?: string): void {
  clearPromptCache(key)
}
