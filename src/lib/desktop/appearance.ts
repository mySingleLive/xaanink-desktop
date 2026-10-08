const sans = 'system-ui, -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif'
const serif = '"Noto Serif SC", "Songti SC", "STSong", "SimSun", serif'
const mono = '"SF Mono", Menlo, Consolas, "Microsoft YaHei", monospace'
export function desktopFontFamily(font: string, body = false): string {
  if (font === "system" || font === "sans-serif") return sans
  if (font === "serif") return serif
  if (font === "monospace") return mono
  const escaped = font.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\\/g, "\\\\").replace(/"/g, '\\"')
  return escaped ? `"${escaped}", ${body ? serif : sans}` : body ? serif : sans
}
export async function localFontFamilies(): Promise<string[]> {
  const browser = window as Window & { queryLocalFonts?: () => Promise<Array<{ family: string }>> }
  if (!browser.queryLocalFonts) throw new Error("当前系统无法列出本机字体，可使用系统字体或通用字体")
  const fonts = await browser.queryLocalFonts()
  return [...new Set(fonts.map(font => font.family).filter(name => name && name.length <= 200))].sort((a, b) => a.localeCompare(b, 'zh-CN'))
}
