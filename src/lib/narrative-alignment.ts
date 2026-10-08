import { z } from "zod"

export const paragraphAlignmentSchema = z.array(z.object({
  from: z.number().int().positive(),
  to: z.number().int().positive(),
  cardId: z.string().min(1),
  supported: z.boolean(),
  reason: z.string().min(1).max(1000),
})).max(3000)
export type ParagraphAlignment = z.infer<typeof paragraphAlignmentSchema>
export const proseParagraphs = (text: string) => text.split(/\n\s*\n/u).map(part => part.trim()).filter(Boolean)

/** 校验评审覆盖，不把模型的语义判断伪装成确定性事实。卡片顺序取正式章投影。 */
export function alignmentCoverageIssues(text: string, cardIds: string[], ranges: ParagraphAlignment) {
  if (!cardIds.length) return []
  const count = proseParagraphs(text).length, issues: string[] = []
  let next = 1, previousCard = -1
  const covered = new Set<string>()
  for (const range of ranges) {
    const order = cardIds.indexOf(range.cardId)
    if (range.from !== next || range.to < range.from || range.to > count) issues.push(`段落范围${range.from}–${range.to}不连续、重复或越界；下一段应为${next}，全章共${count}段`)
    if (order < 0) issues.push(`卡片${range.cardId}不属于本章实际讲述卡`)
    else {
      if (order < previousCard) issues.push(`卡片${range.cardId}顺序倒退，与章投影不符`)
      previousCard = order
      covered.add(range.cardId)
    }
    next = range.to + 1
  }
  if (next !== count + 1) issues.push(`评审未完整覆盖正文${count}段，已覆盖至${next - 1}段`)
  for (const id of cardIds) if (!covered.has(id)) issues.push(`本章讲述卡${id}没有对应正文段落`)
  return issues
}
