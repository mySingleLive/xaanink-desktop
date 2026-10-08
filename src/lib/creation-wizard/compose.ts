import { type WizardCategory, type WizardTemplate } from "./taxonomy"
import { WIZARD_CATEGORIES, type WizardFilters } from "./filter"
import { composePositionBlock } from "./position"

/**
 * 拼贴草稿：首行固定；定位块显式包含默认值，发送前可确定地校验作者编辑；
 * 四环节按 theme→world→character→plot 拼接所选模板 prompt（null 环节省略），段间 \n\n。
 */
export function composeWizardDraft(
  f: WizardFilters,
  picks: Record<WizardCategory, WizardTemplate | null>,
): string {
  const sections = ["我想创作一部新小说，请带我一步步完成它。"]
  sections.push(composePositionBlock(f))
  for (const cat of WIZARD_CATEGORIES) {
    const t = picks[cat]
    if (t) sections.push(t.prompt)
  }
  return sections.join("\n\n")
}
