/**
 * 思考强度（reasoning effort）能力表：每个 provider 的可用档位单一来源。
 *
 * 设计要点：
 * - value 是稳定字符串（落 Conversation.thinkingEffort、随 API 传递），label 是中文展示名；
 * - 菜单只列「低/中/高」显式档位（2026-09 起去掉「默认」「关闭」选项）；default 不出现在菜单，
 *   它是「点模型行直接选中 / 未选」时的内部语义（Conversation.thinkingEffort=null），
 *   各 provider default 行为：deepseek=思考开（历史行为：chat 路由恒开 thinking）、其他=不传任何思考参数；
 * - 「不同模型有不同的思考强度选择」按各厂商官网信息配置：deepseek=低/高/极三档（官方思考模式
 *   指南，medium/xhigh 兼容映射 high 不列出）、anthropic 三档（按 budgetTokens）、
 *   openai 仅推理模型（o 系 / gpt-5 系）出档位；zhipu 按官方型号区分，
 *   openai-compatible/qwen 不出档位（端点支持不一，保守不给）。
 */

import type { SharedV4ProviderOptions } from "@ai-sdk/provider"
import { providerFamily } from "./provider-family"

export interface ThinkingEffortOption {
  /** 稳定标识（落库/传输用） */
  value: string
  /** 中文展示名 */
  label: string
  /** 档位说明（菜单副标题） */
  description?: string
}

/* 菜单只列显式档位；无档位的 provider 返回空表（选择器不渲染第二层） */
const NO_EFFORTS: ThinkingEffortOption[] = []

/**
 * DeepSeek 官方档位（api-docs.deepseek.com《思考模式》指南 + 2026-08-13 更新日志）：
 * V4-Pro / V4-Flash 思考模式均为 low / high / max 三档（默认 high）——
 * 「简单任务 low、日常 Agent 任务 high、高度复杂任务 max」。
 * 接口出于兼容也接受 medium/xhigh 但均映射为 high，官方明确新请求应只用 low/high/max，
 * 故菜单不提供 medium/xhigh。
 */
const DEEPSEEK_EFFORTS: ThinkingEffortOption[] = [
  { value: "low", label: "低", description: "简单任务，更快更省" },
  { value: "high", label: "高", description: "日常任务（官网默认档）" },
  { value: "max", label: "最高", description: "高度复杂任务，最深推理" },
]

/**
 * Kimi（Moonshot 开放平台官网《使用 reasoning_effort》/ /v1/models think_efforts）：
 * k3 系列为 low / high / max 三档，默认 high（与 DeepSeek 官网三档同名但各自独立核实）；
 * coding 端点的 kimi-for-coding(-highspeed) 实测同样接受 reasoning_effort（2026-09）。
 */
const KIMI_EFFORTS: ThinkingEffortOption[] = [
  { value: "low", label: "低", description: "简单任务，更快更省" },
  { value: "high", label: "高", description: "日常任务（官网默认档）" },
  { value: "max", label: "最高", description: "高度复杂任务，最深推理" },
]

/**
 * 智谱 GLM（docs.bigmodel.cn 官方 model card，2026-09）：
 * GLM-5.3 / GLM-5.3-Flash 思考**始终开启不可禁用**（thinking.type 仅支持 enabled），
 * reasoning_effort 三档 low / high / max，**默认 max**（比 deepseek/kimi 的默认 high 更高），
 * 两者上下文窗口均 1M；5.2 有 high/max 两档；glm-4.x 无强度档。
 */
const ZHIPU_EFFORTS: ThinkingEffortOption[] = [
  { value: "low", label: "低", description: "轻量推理，更快更省" },
  { value: "high", label: "高", description: "增强推理" },
  { value: "max", label: "最高", description: "深度推理（官网默认档）" },
]

/** 官方对话 API：5.2 的 low/medium 映射 high，只展示实际 high/max 两档。 */
const ZHIPU_52_EFFORTS = ZHIPU_EFFORTS.filter(option => option.value !== "low")

const ANTHROPIC_EFFORTS: ThinkingEffortOption[] = [
  { value: "low", label: "低", description: "扩展思考 · 预算 2K tokens" },
  { value: "medium", label: "中", description: "扩展思考 · 预算 8K tokens" },
  { value: "high", label: "高", description: "扩展思考 · 预算 16K tokens" },
]

const OPENAI_REASONING_EFFORTS: ThinkingEffortOption[] = [
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
]

/** OpenAI 推理模型（reasoning_effort 仅这些系列接受，盲传给 gpt-4o 等会 400） */
function isOpenAIReasoningModel(modelId: string): boolean {
  return /^(o\d|gpt-5)/i.test(modelId)
}

/** 某模型在模型选择器里展示的思考强度档位（provider+modelId 共同决定） */
export function thinkingEffortOptionsFor(
  provider: string,
  modelId: string
): ThinkingEffortOption[] {
  switch (providerFamily(provider)) {
    case "deepseek":
      return DEEPSEEK_EFFORTS
    case "kimi":
      return KIMI_EFFORTS
    case "zhipu":
      // 官方 model card 与对话 API：5.3 三档、5.2 两档，其余无强度档。
      return modelId.startsWith("glm-5.3") ? ZHIPU_EFFORTS : modelId === "glm-5.2" ? ZHIPU_52_EFFORTS : NO_EFFORTS
    case "anthropic":
      return ANTHROPIC_EFFORTS
    case "openai":
      return isOpenAIReasoningModel(modelId) ? OPENAI_REASONING_EFFORTS : NO_EFFORTS
    default:
      return NO_EFFORTS
  }
}

/** 校验 effort value 对该模型是否合法（落在档位表内） */
export function isValidThinkingEffort(
  provider: string,
  modelId: string,
  effort: string
): boolean {
  return thinkingEffortOptionsFor(provider, modelId).some((o) => o.value === effort)
}

/** Anthropic 扩展思考预算（budgetTokens）映射 */
const ANTHROPIC_BUDGETS: Record<string, number> = {
  low: 2048,
  medium: 8192,
  high: 16384,
}

/**
 * 把思考强度档位翻译成 AI SDK providerOptions（streamText 的 providerOptions 入参）。
 * effort 为 null（点模型行/未选的默认档）时返回各 provider 的现状行为：
 * - deepseek：thinking enabled（历史行为，思维链随流回传给对话区「思考行」）；
 * - 其他：undefined（不传任何思考参数）。
 * "off"/"default" 已不在菜单档位表内（isValidThinkingEffort 会拦下，落库旧值按默认档处理），
 * 这里的 off 分支仅作防御性兜底。返回 undefined 时调用方不要把 providerOptions 传给 streamText。
 */
export function buildThinkingProviderOptions(
  provider: string,
  effort: string | null,
  modelId?: string
): SharedV4ProviderOptions | undefined {
  const level = effort ?? "default"
  switch (providerFamily(provider)) {
    case "deepseek": {
      if (level === "off") {
        return { deepseek: { thinking: { type: "disabled" } } }
      }
      /* 官网三档 low/high/max；null(default) 不传 reasoningEffort（API 默认即为 high） */
      const reasoningEffort =
        level === "low" || level === "high" || level === "max" ? level : undefined
      return {
        deepseek: {
          thinking: { type: "enabled" },
          ...(reasoningEffort ? { reasoningEffort } : {}),
        },
      }
    }
    case "kimi": {
      /* kimi 复用 deepseek SDK 实例，providerOptions 键跟随实例=deepseek；
         线形与 Kimi 官方一致（顶层 reasoning_effort + thinking:{type}） */
      const kimiEffort =
        level === "low" || level === "high" || level === "max" ? level : undefined
      return {
        deepseek: {
          thinking: { type: "enabled" },
          ...(kimiEffort ? { reasoningEffort: kimiEffort } : {}),
        },
      }
    }
    case "zhipu": {
      // 旧 GLM-4-Long/Flash 与视觉非思考型号不接受该参数。
      if (!modelId || !/^glm-(?:5(?:[.-]|v|-|$)|4\.[567](?:v)?(?:-|$))/.test(modelId)) return undefined
      /* 复用 deepseek SDK 实例（providerOptions 键=deepseek）；GLM-5.3 思考常开（仅支持 enabled，
         发 disabled 会请求失败），强度 low/high/max、缺省即官网默认 max */
      const glmEffort = modelId.startsWith("glm-5.3") && ["low", "high", "max"].includes(level) ? level :
        modelId === "glm-5.2" && ["low", "high", "max"].includes(level) ? (level === "low" ? "high" : level) : undefined
      return {
        deepseek: {
          thinking: { type: "enabled" },
          ...(glmEffort ? { reasoningEffort: glmEffort } : {}),
        },
      }
    }
    case "anthropic": {
      const budget = ANTHROPIC_BUDGETS[level]
      return budget ? { anthropic: { thinking: { type: "enabled", budgetTokens: budget } } } : undefined
    }
    case "openai": {
      return level === "low" || level === "medium" || level === "high"
        ? { openai: { reasoningEffort: level } }
        : undefined
    }
    default:
      return undefined
  }
}
