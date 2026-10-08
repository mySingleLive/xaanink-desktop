/** 结构化生成的只读文字预览；内部ID与参数不作为小说内容展示。 */
export function storyDraftText(raw: string) {
  const pieces: string[] = []
  for (const match of raw.matchAll(/"(?:description|text|outline|content|brief|personality|bio|ability|limitation|trigger)"\s*:\s*"((?:\\.|[^"\\])*)/g)) {
    try { pieces.push(JSON.parse(`"${match[1]}"`) as string) }
    catch { pieces.push(match[1].replace(/\\n/g, "\n").replace(/\\"/g, '"')) }
  }
  return pieces.join("\n\n").slice(-40000)
}
