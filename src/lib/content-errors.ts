/** 可展示的稿件错误；不携带正文、密钥或数据库诊断信息。 */
export class ContentError extends Error {
  constructor(public code: string, message: string, public status = 409) {
    super(message)
    this.name = "ContentError"
  }
}

export function requireVersion(version: unknown): asserts version is number {
  if (version === undefined || version === null) throw new ContentError("PRECONDITION_REQUIRED", "缺少稿件版本。草稿已保留，请刷新后重新比较。", 428)
  if (!Number.isSafeInteger(version) || (version as number) < 1) throw new ContentError("INVALID_VERSION", "稿件版本不合法", 400)
}
