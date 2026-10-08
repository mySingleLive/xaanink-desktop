import type { ModelMessage } from "ai"

import type { Message } from "@/generated/prisma/client"
import { buildNovelContext } from "@/lib/ai/context"
import { renderPrompt } from "@/lib/prompts/render"
import { compactCompletedCall, isReplayableWriteCall } from "./context-protection"
import { STORY_WORKFLOW_PROMPT } from "@/lib/prompts/story-workflow"

/**
 * 未关联小说时注入系统提示的占位上下文。
 * 延迟建档（2026-09）：先共创简报要素、书名经确认（或作者同意暂定）才建书，
 * 禁止替作者起正式风格书名；未确认书名不传 title，服务端用中性占位名。
 */
const NO_NOVEL_CONTEXT =
  "（当前对话未关联小说。作者想开始新故事时，先与他在聊天里共创简报要素——主角是谁、要达成什么、世界大致方向——把故事核心聊成形；要素成形、且书名经作者确认（或作者明确同意先用暂定名）之后，才调用 startNovelFromChat 保存新作品并继续共创。不要替作者起正式风格的书名；书名未确认就不传 title，作品会先用中性占位名「未命名作品·M月D日」并标注暂定，定题后随时可改。一般讨论不必建书；不要让作者先去填写表单。）"

/** @ 引用语法说明：作者用 @[类型/名称] 显式引用小说资源，同名资源靠类型前缀区分 */
const MENTION_SYNTAX_NOTE = `

## 引用语法
作者在消息中用 @[类型/名称] 显式引用小说资源，例如：@[角色/七七]、@[世界观/修真世界]、@[设定·力量体系/灵力修炼体系]、@[大纲/第1章 · 雨夜来客]、@[正文/第1章 · 雨夜来客]。注意同名资源类型不同就是不同的东西（如「@[大纲/第1章 · 雨夜来客]」是该章的大纲、「@[正文/第1章 · 雨夜来客]」是该章的正文）；需要具体内容时用相应工具读取（getOutline / getChapterContent / getCharacter / getSetting / getNovelPlanning 等）。
等级体系里的单个等级引用形态是 @[设定·{设定名}/{设定id}·{等级名}]（如 @[设定·序列阶梯/cmxxxx·序列九·假面学徒]），它指向该等级体系设定中的具体等级节点；用 getSetting 按设定名读取该等级体系内容，在其中按等级名或别名定位节点详情。
引用芯片可带半角括号技术负载 @[类型/名称](标识)——括号内是系统标识（如检查点 key：@[检查点/仙界追凶 · 主题](theme:cmxxxx)），作者界面只看到名称；需要调用对应工具（如 reviewStoryCheckpoint）时用括号里的标识作入参，不要把标识当成名称的一部分。`

/** 计划模式追加指令：只读调研 → 澄清/头脑风暴 → 输出计划 → 等批准 */
const PLAN_MODE_SUFFIX = `

## 计划模式（本轮对话当前生效，优先级最高）
作者已开启「计划模式」。本模式下：
1. 【禁止执行任何修改】写工具不可用，你只能使用只读工具了解现状，不要试图改动任何数据。
2. 先与作者头脑风暴：理解目标后，对含糊之处主动追问澄清（如范围、风格、约束），必要时用只读工具读取相关设定/大纲/正文再提问。
3. 思路理清后，调用 proposePlan 输出只读结构化计划提案，含目标、步骤和预期产出。
4. 计划提案输出后停手等待，作者可批准此版本或暂不执行。在此之前不做任何修改。`

/**
 * 对话前情摘要段（context-compression.ts 的压缩产物注入系统提示，位置稳定在引用语法说明之前）。
 * 注入系统提示而非消息数组：不伪装成对话轮次污染模型行为，也避开
 * 「OpenAI 兼容端点拒绝末尾 system 消息」的已知坑（见 withTurnReminder 注释）。
 */
function summarySection(summary: string): string {
  return `

## 对话前情摘要
更早的对话内容已压缩为以下摘要；其中写明的事实、决定与承诺仍然有效，直接沿用，不要向作者追问摘要里已写明的内容。
${summary}`
}

/**
 * 渲染 chat.system 系统提示：关联小说时注入完整创作上下文
 * （与大纲/评审等场景同源的 buildNovelContext 全文）；
 * 计划模式在末尾追加只读与计划流程指令。
 * summary 非空时注入对话前情摘要段（上下文压缩产物，见 context-compression.ts）。
 */
export async function buildChatSystemPrompt(
  novelId: string | null,
  mode: "standard" | "plan" = "standard",
  summary: string = "",
  contextOverride?: string,
  task = ""
): Promise<string> {
  const novelContext = contextOverride ?? (novelId ? await buildNovelContext(novelId, task) : NO_NOVEL_CONTEXT)
  const base =
    (await renderPrompt("chat.system", { novelContext })) +
    (summary.trim() ? summarySection(summary) : "") +
    MENTION_SYNTAX_NOTE + STORY_WORKFLOW_PROMPT
  return mode === "plan" ? base + PLAN_MODE_SUFFIX : base
}

/**
 * 逐轮格式提醒的正文。系统提示离生成点太远，批量轮次（一轮二三十次工具调用）
 * 模型容易跳过计划直接开干，所以每轮把它贴到最后一条用户消息末尾
 * （见 withTurnReminder；只进模型上下文，不落库、界面上看不到）。
 * 注意别改成在消息数组末尾追加 system 消息——OpenAI 兼容端点会直接报错。
 */
export function turnFormatReminder(mode: "standard" | "plan"): string {
  return mode === "plan"
    ? "【本轮契约】计划模式仅只读调研；澄清用 askUserQuestion，方案明确后用 proposePlan 生成只读提案并结束。作者批准对应版本后执行。不要用 Markdown 重复卡片中的清单。"
    : "【本轮契约】用自然语言简述意图，必要时维护唯一 SOP 计划并沿用 itemId；不要在执行前后重复列清单。计划/进度工具只记录进展，内容修订（叙事线、设定、章纲等）必须调用对应写入工具，不得以计划更新代替。结果以实际回执为准，候选不等于正文已提交。内部工具名、参数与 ID 留在工具详情；如实报告未完成项，完成即可收尾。"
}

/** 回放时单个参数值的最大长度，超出截断（正文类参数动辄数千字） */
const REPLAYED_INPUT_MAX = 200

/** 落库的历史工具调用记录 */
export interface StoredToolCall {
  toolCallId: string
  toolName: string
  input: unknown
  output: unknown
}

/**
 * 取历史消息里的写工具调用（失败的也回放，模型才知道哪一步没成）。
 * 读工具结果易过期且冗长，不回放；无返回值的调用（中断等）跳过，
 * 免得回放出没有结果的半截调用。
 */
export function storedWriteCalls(toolCalls: unknown): StoredToolCall[] {
  if (!Array.isArray(toolCalls)) return []
  const calls: StoredToolCall[] = []
  for (const raw of toolCalls) {
    if (!raw || typeof raw !== "object") continue
    const call = raw as Partial<StoredToolCall>
    if (!isReplayableWriteCall(call)) continue
    calls.push({
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      input: call.input ?? {},
      output: call.output,
    })
  }
  return calls
}

/** 压缩回放参数：长文本截断，保留 id/名称等定位信息 */
export function compactInput(value: unknown): unknown {
  if (typeof value === "string") {
    return value.length > REPLAYED_INPUT_MAX
      ? `${value.slice(0, REPLAYED_INPUT_MAX)}…（内容较长已省略）`
      : value
  }
  if (Array.isArray(value)) return value.map(compactInput)
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, compactInput(v)])
    )
  }
  return value
}

/**
 * 会话历史转 AI SDK ModelMessage。
 *
 * 助手轮次按「工具调用 → 工具返回 → 文字总结」的真实顺序还原：
 * 跨轮任务（如分几轮建十几个角色）靠它保持连续，模型能看到自己前几轮
 * 到底落库了什么。注意不能把工具记录拼成文字塞进助手消息——那样模型会
 * 模仿这种"写一段执行日志"的格式，最后不调工具只写"已保存"。
 */
export function toModelMessages(messages: Message[], compactCompleted = false): ModelMessage[] {
  const result: ModelMessage[] = []
  // 历史被截断时可能从助手轮次中间开始，掐头对齐到第一条用户消息，
  // 避免整段对话以「工具调用/工具返回」开场（部分供应商会拒绝）
  const start = messages.findIndex((m) => m.role === "USER")
  for (const m of start > 0 ? messages.slice(start) : messages) {
    if (m.role === "USER") {
      if (!m.content.trim()) continue
      result.push({ role: "user", content: m.content })
      continue
    }
    if (m.role !== "ASSISTANT") continue

    const calls = storedWriteCalls(m.toolCalls).map(call => compactCompleted ? compactCompletedCall(call) : call)
    const text = m.content.trim()
    if (calls.length > 0) {
      result.push({
        role: "assistant",
        content: calls.map((c) => ({
          type: "tool-call" as const,
          toolCallId: c.toolCallId,
          toolName: c.toolName,
          input: c.input,
        })),
      })
      result.push({
        role: "tool",
        content: calls.map((c) => ({
          type: "tool-result" as const,
          toolCallId: c.toolCallId,
          toolName: c.toolName,
          output: { type: "json" as const, value: c.output as never },
        })),
      })
    }
    if (text) {
      result.push({ role: "assistant", content: text })
    }
  }
  return result
}

/**
 * 给本轮消息贴上格式提醒：附到最后一条用户消息末尾。
 * 用户消息在库里存的是原文，提醒只存在于发给模型的这份拷贝里。
 */
export function withTurnReminder(
  messages: ModelMessage[],
  mode: "standard" | "plan"
): ModelMessage[] {
  const lastUser = messages.findLastIndex((m) => m.role === "user")
  if (lastUser < 0) return messages
  const target = messages[lastUser]
  if (typeof target.content !== "string") return messages
  const next = [...messages]
  next[lastUser] = {
    role: "user",
    content: `${target.content}\n\n${turnFormatReminder(mode)}`,
  }
  return next
}

/**
 * 发给模型前的消息消毒：供应商流式响应映射回 ModelMessage 时可能产生 schema 不接受的零件
 * （如无 text 的 reasoning 段、content 为 null 的助手消息、缺 content 的工具消息），
 * 续跑/重放再次进 streamText 会在 standardizePrompt 抛 AI_InvalidPromptError 整轮失败。
 * 这里修复或丢弃这些零件，保证数组始终过 modelMessageSchema；丢弃计数供诊断。
 */
export function sanitizeModelMessages(messages: unknown[]): { messages: unknown[]; dropped: number } {
  let dropped = 0
  const out: unknown[] = []
  for (const raw of messages) {
    if (!raw || typeof raw !== "object") { dropped++; continue }
    const m = raw as { role?: unknown; content?: unknown }
    if (!["system", "user", "assistant", "tool"].includes(m.role as string)) { dropped++; continue }
    if (typeof m.content === "string") { out.push(m); continue }
    if (!Array.isArray(m.content)) {
      // content 缺失/null：user/system 无法修复（丢掉会失声，但保留会让整轮失败——记录并跳过）；assistant 丢消息
      dropped++; continue
    }
    const parts = (m.content as unknown[]).filter(part => {
      if (!part || typeof part !== "object") { dropped++; return false }
      const p = part as { type?: unknown; text?: unknown; toolCallId?: unknown; toolName?: unknown; output?: unknown }
      if (p.type === "text") return typeof p.text === "string" || (dropped++, false)
      if (p.type === "reasoning") return typeof p.text === "string" || (dropped++, false)
      if (p.type === "tool-call") return (typeof p.toolCallId === "string" && typeof p.toolName === "string") || (dropped++, false)
      if (p.type === "tool-result") return (typeof p.toolCallId === "string" && typeof p.toolName === "string" && p.output !== undefined) || (dropped++, false)
      if (p.type === "file" || p.type === "image") return true
      dropped++; return false
    })
    if (!parts.length && m.role !== "user") { dropped++; continue }
    out.push(parts.length === (m.content as unknown[]).length ? m : { ...m, content: parts })
  }
  return { messages: out, dropped }
}

/** 落库到 Message.toolCalls 的单条工具调用记录（前端工具卡片直接渲染此结构） */
export interface ToolCallRecord {
  toolCallId: string
  toolName: string
  input: unknown
  output: unknown
}
