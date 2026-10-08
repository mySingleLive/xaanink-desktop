/**
 * 软停顿检测（W5 回合收尾不变量，ISS-010）：
 * 模型在文本尾部宣布「我现在就 X」却没有任何工具调用就收尾时，
 * 回合在原回合内自动续跑有限次数；正则宁保守（宁可漏判不多判），
 * 误判成本 = 一次额外模型步。
 */

/** 每回合自动续跑上限 */
export const MAX_AUTO_CONTINUATIONS = 2

/** 自动续跑时追加的续跑消息（仅进模型上下文，不落库、作者不可见） */
export const AUTO_CONTINUATION_MESSAGE = "你刚才宣布要执行的动作未执行，请立即执行或明确说明为何不再执行。"

/** 行动宣告检测的文本窗口（最后一步文本尾部 ~500 字） */
export const SOFT_STOP_TAIL_CHARS = 500

/**
 * 第一人称即时表述 + 动作动词：「我现在/接下来/马上（就/将/要）+ 评审/保存/更新/创建/生成/提交…」。
 * 只匹配写/执行类动作（读操作未执行不视为软停顿）；另允许句首明确的
 * 「现在先/按依赖顺序先…」行动宣告，给作者的选项与完成汇报不匹配。
 */
const ACTION_DECLARATION_PATTERN =
  /(?:我\s*(?:现在|接下来|马上|立即|这就|随后|紧接着)|(?:现在|接下来|马上|立即|这就|随后|紧接着)\s*我)\s*(?:就|将|要|开始|先)?\s*(?:重新|立即|马上|接着)?\s*(?:评审|重评|保存|更新|创建|生成|提交|写入|落库|召唤|发起|执行|处理|修改|登记|补齐|重跑)/u

/** 最后一步文本尾部是否命中行动宣告模式（调用方保证该步之后无任何工具调用） */
export function detectSoftStop(stepText: string): boolean {
  const tail = stepText.slice(-SOFT_STOP_TAIL_CHARS)
  return ACTION_DECLARATION_PATTERN.test(tail)
    || /(?:^|[。！\n：])\s*现在(?:按依赖顺序)?(?:先|开始|立即)(?:复评|评审|重评|生成|创建|更新|提交)/u.test(tail)
}

/** 只检查最后一个模型步骤：前一步的成功写入不能抵消后一步的新行动宣告。 */
export function hasUnexecutedDeclaration(steps: readonly { text: string; toolCalls: readonly unknown[] }[]): boolean {
  const last = steps.at(-1)
  return !!last && last.toolCalls.length === 0 && detectSoftStop(last.text)
}
