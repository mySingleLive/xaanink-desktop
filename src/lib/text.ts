/** 中文字数统计：非空白字符数（中文按字、英文按非空白字符近似）。服务端与客户端共用。 */
export function countChineseWords(text: string): number {
  return Array.from(text.replace(/\s/g, "")).length
}
