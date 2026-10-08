import { z } from "zod"

/** Only the server creates this context from a stored answer and a real pending proposal receipt. */
export const planningAdjustmentSchema = z.object({
  proposalId: z.string().min(1), originTurnId: z.string().min(1), originInteractionId: z.string().min(1),
  expectedVersion: z.number().int().nonnegative(), focusKeys: z.array(z.string().min(1)).min(1).max(20),
  phase: z.enum(["clarify", "refine"]), answer: z.string().max(4000).optional(),
})
export type PlanningAdjustment = z.infer<typeof planningAdjustmentSchema>
type RecordValue = Record<string, unknown>
function object(value: unknown): RecordValue | null { return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : null }
export function planningAdjustmentOf(action: unknown): PlanningAdjustment | null {
  const row = object(action)
  const parsed = row?.kind === "question" ? planningAdjustmentSchema.safeParse(row.planningAdjustment) : null
  return parsed?.success ? parsed.data : null
}
export function questionAnswer(payload: unknown, message: string): string | null {
  const row = object(payload), questions = row?.questions
  if (!Array.isArray(questions) || questions.length !== 1) return null
  const question = object(questions[0])
  if (typeof question?.question !== "string" || !Array.isArray(question.options)) return null
  const prefix = `【回答问题】${question.question}\n我的回答：`
  if (!message.startsWith(prefix)) return null
  return message.slice(prefix.length).trim() || null
}
/** Text alone is insufficient: the caller must supply the same-book, current, unapplied database proposal. */
export function bindPlanningAdjustment(input: {
  origin: { id: string; action: unknown; interaction: unknown }; answer: string;
  calls: readonly { toolName: string; status: string; input: unknown; output: unknown }[];
  proposal: { id: string; expectedVersion: number; operations: unknown[] }; currentVersion: number;
}): PlanningAdjustment | null {
  const interaction = object(input.origin.interaction), payload = object(interaction?.payload)
  if (interaction?.kind !== "question" || !["pending", "answered"].includes(String(interaction.state)) || typeof interaction.id !== "string" || !payload || payload.storyApproval || payload.contentApproval || payload.storyNavigation) return null
  const questions = payload.questions
  if (!Array.isArray(questions) || questions.length !== 1) return null
  const question = object(questions[0]), options = question?.options
  if (!Array.isArray(options) || !options.every(option => typeof option === "string")) return null
  const answer = questionAnswer(payload, input.answer)
  const markers = payload.markerStyle === "numbers" ? ["1", "2", "3", "4", "5"] : payload.markerStyle === "stems" ? ["甲", "乙", "丙", "丁", "戊"] : ["A", "B", "C", "D", "E"]
  const selected = options.find((option, index) => option === answer || markers[index] === answer)
  const adjust = (option: string) => /需要调整|(?:先)?不采用.*调整/.test(option)
  const hasAdjustmentChoice = options.some(adjust) && options.some(option => /采用/.test(option) && !adjust(option))
  // A real proposal question also offers Other: an explicit adjustment with feedback is already refine,
  // while an exact option/marker remains clarify. The stored receipt/proposal checks below still apply.
  const otherPrefix = typeof answer === "string" ? answer.match(/^(?:需要调整|(?:先|暂)?不采用[^。；;\n]{0,80}调整)(?:[：:，,。；;\s]|$)/u)?.[0] : undefined
  const adoptionDirective = /(?:^|[，,。；;\n])\s*(?:但是?|同时|并|然后)?\s*(?:我)?\s*(?:请|先|仍然?|还是|直接|现在|立即|同意)?\s*(?:采用(?:这份|此|该|原|当前|本次)?(?:提案|候选)|认可这一版|直接落库)/u.test(answer ?? "")
  const otherFeedback = selected === undefined && !!otherPrefix && typeof answer === "string"
    && !adoptionDirective && answer.length <= 4000 && answer.slice(otherPrefix.length).trim().length > 0
  if (!hasAdjustmentChoice || !(typeof selected === "string" && adjust(selected)) && !otherFeedback) return null
  if (input.proposal.expectedVersion !== input.currentVersion) return null
  const proposed = input.calls.filter(call => call.status === "succeeded" && call.toolName === "proposeNovelPlanning").at(-1)
  const output = object(proposed?.output), result = object(output?.result)
  if (output?.ok !== true || result?.id !== input.proposal.id || result.expectedVersion !== input.proposal.expectedVersion
    || JSON.stringify(result.operations) !== JSON.stringify(input.proposal.operations)) return null
  // The actual tool-created question (or the server's exact proposal safety-net) must be the answered card.
  const asked = input.calls.some(call => call.status === "succeeded" && call.toolName === "askUserQuestion"
    && object(call.output)?.ok === true && JSON.stringify(object(call.input)?.questions) === JSON.stringify(questions))
  if (!asked && !String(question?.question).includes(`本次确认提案 ${input.proposal.id}（`)) return null
  const source = object(input.origin.action)
  const priorContext = planningAdjustmentOf(input.origin.action)
  const focusKeys = source?.kind === "storyTask" && typeof source.targetKey === "string" ? [source.targetKey] : priorContext?.focusKeys ?? [`planning:${input.proposal.id}`]
  return { proposalId: input.proposal.id, expectedVersion: input.proposal.expectedVersion, originTurnId: input.origin.id,
    originInteractionId: interaction.id, focusKeys, phase: otherFeedback ? "refine" : "clarify", ...(otherFeedback && answer ? { answer } : {}) }
}
export function planningAdjustmentQuestion(context: PlanningAdjustment) {
  return { planningAdjustment: { proposalId: context.proposalId, originTurnId: context.originTurnId, originInteractionId: context.originInteractionId, expectedVersion: context.expectedVersion, focusKeys: context.focusKeys, phase: "clarify" as const }, markerStyle: "letters" as const,
    questions: [{ question: "这份规划提案暂不采用。本次只调整原提案涉及的候选内容，请选择需要核对的方面：",
      options: ["节拍与讲述顺序", "资料与事件关联", "范围或事实一致性", "暂不调整，保留候选"] }] }
}
export function misplacedPlanningAdjustment(input: { status: string; interaction: unknown; action: unknown; calls: readonly unknown[] }, context: PlanningAdjustment | null) {
  const interaction = object(input.interaction), payload = object(interaction?.payload)
  // Historical migration is limited to an effect-free, unanswered global approval substituted for a real adjustment.
  return !!context && input.status === "waiting_user" && !input.action && input.calls.length === 0
    && interaction?.kind === "question" && interaction.state === "pending" && !!payload?.storyApproval
}
export function planningAdjustmentToolAllowed(context: PlanningAdjustment, name: string, isWrite: boolean) {
  return !["requestStoryApproval", "requestContentApproval", "requestStoryRemoval", "completeStoryTask", "proposePlan", "applyNovelPlanningProposal"].includes(name)
    && (!isWrite || context.phase === "refine" && context.answer !== "暂不调整，保留候选" && name === "proposeNovelPlanning")
}
/** A recovery request only restarts the recorded answer; it cannot also answer the misplaced card. */
export function planningAdjustmentRecoveryRequestAllowed(input: { interaction?: unknown; message?: unknown; storySelection?: unknown; action?: unknown; stagedChanges?: unknown; mode?: string }) {
  return input.mode !== "plan" && [input.interaction, input.message, input.storySelection, input.action, input.stagedChanges].every(value => value === undefined)
}
