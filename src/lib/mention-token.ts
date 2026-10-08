/** 引用序列 @[组标签/展示名] 的可选技术负载 @[组标签/展示名](标识)：负载随草稿与消息发给模型，展示层（芯片/标题）不呈现。本模块为前后端共用的纯函数。 */

/** 芯片序列（含可选负载）的匹配正则；组 1=展示段（组/名），组 2=技术负载（可缺省） */
export const MENTION_TOKEN_RE = /@\[([^\]\n]{1,200})\](?:\(([^\)\n]{1,300})\))?/g

/** 拆出引用序列的展示段与技术负载（无负载时 payload 为 undefined） */
export function splitMentionToken(token: string): { inner: string; payload?: string } {
  const match = /^@\[([^\]\n]{1,200})\](?:\(([^\)\n]{1,300})\))?$/.exec(token)
  if (!match) return { inner: token.slice(2, -1) }
  return { inner: match[1], payload: match[2] }
}

/** 展示用途（如会话标题）剥离负载：@[组/名](标识) → @[组/名]；模型消息原文不受影响 */
export function stripMentionPayloads(text: string): string {
  return text.replace(/@\[([^\]\n]{1,200})\]\([^\)\n]{1,300}\)/g, "@[$1]")
}
