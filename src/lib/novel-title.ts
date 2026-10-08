/**
 * 脑洞延迟建档的中性占位名：书名未定前建书用「未命名作品·M月D日」（取当前日期）。
 * 作品名显示处对占位名渲染「暂定」徽标；定题经 upsertTheme / renameNovelTitle
 * 同步后不再匹配前缀，徽标自然消失。
 */
export const TENTATIVE_NOVEL_TITLE_PREFIX = "未命名作品·"

/** 生成当天中性占位名「未命名作品·M月D日」 */
export function tentativeNovelTitle(date: Date = new Date()): string {
  return `${TENTATIVE_NOVEL_TITLE_PREFIX}${date.getMonth() + 1}月${date.getDate()}日`
}

/** 作品名是否仍是中性占位名 */
export function isTentativeNovelTitle(title: string | null | undefined): boolean {
  return !!title?.startsWith(TENTATIVE_NOVEL_TITLE_PREFIX)
}
