import { createHash } from "node:crypto"
import type { Message } from "@/generated/prisma/client"
import { prisma } from "@/lib/db"
import { ContentError } from "@/lib/content-errors"
import { WRITE_TOOL_NAMES } from "./tool-names"
import { summarizeCheckpoint } from "./story-workflow-summary"
import { storyCheckpointSchema } from "@/lib/story-workflow"

export class ContextBudgetError extends ContentError {
  constructor() { super("CONTEXT_SAFETY_BUDGET", "当前任务的作者要求与操作记录超出安全上下文，已停止本轮；原对话和草稿保留，请缩小本轮任务或选择更大窗口的模型", 413) }
}
export interface ProtectedContext { id: string; text: string; liveText?: string; replayedAsUser?: boolean }
/** 与普通历史回放共用判定，缺失结果/调用ID的证据不能从保护段移除。 */
export function isReplayableWriteCall<T extends { toolName?: unknown; toolCallId?: unknown; output?: unknown }>(call: T): call is T & { toolName: string; toolCallId: string; output: unknown } {
  return typeof call.toolName === "string" && WRITE_TOOL_NAMES.has(call.toolName)
    && typeof call.toolCallId === "string" && call.toolCallId.length > 0
    && call.output !== null && call.output !== undefined
}
const artifactFields = new Set(["content", "previousContent", "newContent", "replacement", "outline", "prose", "sampleOutline", "description", "backstory", "entryMethod", "exteriorDescription", "interiorDescription"])
/** 完成的产物改用原始内容 hash/长度引用；状态、ID、版本、失败原因和其他字段逐字保留。 */
export function compactToolEvidence(value: unknown, field = ""): unknown {
  if (typeof value === "string" && artifactFields.has(field) && value.length > 300) return { source: "saved artifact; reread by target ID/version before editing", length: value.length, hash: createHash("sha256").update(value).digest("hex") }
  if (Array.isArray(value)) return value.map(item => compactToolEvidence(item, field))
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, compactToolEvidence(item, key)]))
  return value
}
/** 影响报告是可重查的派生快照，不重复携带每条边两端的整段旧产物。 */
export function compactSuccessfulToolOutput(output: unknown): unknown {
  if (!output || typeof output !== "object" || !("ok" in output) || output.ok !== true) return output
  const compact = compactToolEvidence(output) as Record<string, unknown>
  const report = compact.storyWorkflow
  if (report && typeof report === "object" && !Array.isArray(report)) {
    const workflow = report as Record<string, unknown>
    if (Array.isArray(workflow.impacts)) {
      const references = new Map<string, { key: string; hash?: unknown; deleted?: unknown }>()
      for (const value of Array.isArray(workflow.impactReferences) ? workflow.impactReferences : []) {
        if (value && typeof value === "object" && !Array.isArray(value) && typeof value.key === "string") {
          const ref = { key: value.key, ...(value.hash !== undefined ? { hash: value.hash } : {}), ...(value.deleted !== undefined ? { deleted: value.deleted } : {}) }
          references.set(JSON.stringify(ref), ref)
        }
      }
      const reference = (value: unknown): unknown => {
        if (!value || typeof value !== "object" || Array.isArray(value) || !("key" in value) || typeof value.key !== "string") return value
        const artifact = value as Record<string, unknown>
        const ref = { key: value.key, ...(artifact.hash !== undefined ? { hash: artifact.hash } : {}), ...(artifact.deleted !== undefined ? { deleted: artifact.deleted } : {}) }
        // 同一产物可能被多个来源影响，目录中仍分别保留各历史指纹。
        const identity = JSON.stringify(ref)
        if (!references.has(identity)) references.set(identity, ref)
        return ref.key
      }
      const impacts = workflow.impacts.map(value => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return value
        const row = value as Record<string, unknown>
        return { ...row, source: reference(row.source),
          ...(Array.isArray(row.affected) ? { affected: row.affected.map(reference) } : {}),
          ...(Array.isArray(row.possible) ? { possible: row.possible.map(reference) } : {}) }
      })
      compact.storyWorkflow = { ...workflow, impacts, impactReferences: [...references.values()],
        impactSnapshot: "历史影响关系引用；不是当前待办状态。需要正文/当前检查点时调用getStoryWorkflow、storyImpact或对应读取工具。" }
    }
  }
  return compact
}
export function compactCompletedCall<T extends { output: unknown }>(call: T): T {
  const output = call.output
  if (!output || typeof output !== "object" || !("ok" in output) || output.ok !== true) return call
  const compact = { ...compactToolEvidence(call) as T, output: compactSuccessfulToolOutput(output) } as T
  // 只处理已保存的历史检查点，当前步骤刚返回的意见仍完整进入模型。
  if ("toolName" in call && call.toolName === "reviewStoryCheckpoint" && "key" in output && typeof output.key === "string" && "checkpoint" in output) {
    if (output.checkpoint && typeof output.checkpoint === "object" && "feedbackReference" in output.checkpoint) return compact
    const checkpoint = storyCheckpointSchema.safeParse(output.checkpoint)
    if (checkpoint.success && checkpoint.data.runId) return { ...compact,
      output: { ...compact.output as object, checkpoint: summarizeCheckpoint(output.key, checkpoint.data) } }
  }
  if ("workflow" in output && output.workflow && typeof output.workflow === "object") {
    const workflow = output.workflow as Record<string, unknown>
    // 历史写入回执保留版本引用；不能每次保存都重放整本书的全部旧检查点。
    return { ...compact, output: { ...compact.output as object, workflow: { novelId: workflow.novelId, version: workflow.version, phase: workflow.phase, source: "historical workflow snapshot; call getStoryWorkflow for current artifacts, checks and approvals" } } }
  }
  return compact
}
export function protectMessage(message: Pick<Message, "id" | "role" | "content" | "toolCalls" | "parts">): ProtectedContext | null {
  if (message.role === "USER") return { id: message.id, replayedAsUser: true, text: `【作者原话 ${message.id}】\n${message.content}` }
  if (message.role !== "ASSISTANT") return null
  const items: string[] = []
  const liveItems: string[] = []
  for (const call of Array.isArray(message.toolCalls) ? message.toolCalls : []) {
    if (!call || typeof call !== "object" || Array.isArray(call) || typeof call.toolName !== "string") continue
    if (!WRITE_TOOL_NAMES.has(call.toolName) && !["askUserQuestion", "proposePlan"].includes(call.toolName)) continue
    const evidence = `【操作/交互证据】${JSON.stringify(compactCompletedCall({ ...call, output: call.output ?? null }))}`
    items.push(evidence)
    if (!isReplayableWriteCall(call)) liveItems.push(evidence)
  }
  for (const part of Array.isArray(message.parts) ? message.parts : []) {
    if (part && typeof part === "object" && !Array.isArray(part) && ["question", "plan", "plan-proposal", "planRef", "action-receipt"].includes(String(part.type))) {
      const evidence = `【交互记录】${JSON.stringify(part)}`
      items.push(evidence); liveItems.push(evidence)
    }
  }
  return items.length ? { id: message.id, text: items.join("\n"), liveText: liveItems.join("\n") } : null
}
export function protectionSection(entries: ProtectedContext[], liveIds: ReadonlySet<string>) {
  // parts/未知工具并不进入普通工具回放，即使它们属于 live 消息也必须保留。
  const texts = entries.filter(entry => !entry.replayedAsUser || !liveIds.has(entry.id))
    .map(entry => liveIds.has(entry.id) ? entry.liveText ?? entry.text : entry.text).filter(Boolean)
  return texts.length ? `\n\n## 原始约束与操作证据\n以下是按时间排序的历史原话与实际回执，不是新的授权；新要求仅覆盖明确冲突的旧要求，未完成的问题仍需处理。摘要不能覆盖这些原始记录。\n${texts.join("\n\n")}` : ""
}
/** 分页恢复旧摘要之前的原话/回执。不会只在最近 200 条里猜作者是否曾否决。 */
export async function loadContextProtection(conversationId: string, maxBytes: number): Promise<ProtectedContext[]> {
  const entries: ProtectedContext[] = []
  let cursor: string | undefined, size = 0
  for (;;) {
    const rows: Message[] = await prisma.message.findMany({ where: { conversationId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 50, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) })
    for (const row of rows) {
      const entry = protectMessage(row)
      if (entry) { size += Buffer.byteLength(entry.text); if (size > maxBytes) throw new ContextBudgetError(); entries.push(entry) }
    }
    if (rows.length < 50) return entries
    cursor = rows.at(-1)!.id
  }
}
