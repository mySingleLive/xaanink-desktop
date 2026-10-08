/**
 * 统一 Markdown 渲染：marked(GFM) + highlight.js 语法高亮。
 * 编辑器预览（MarkdownPreview）与对话面板（ChatPanel）共用同一份配置；
 * 令牌色在 globals.css 的 .hljs 规则中按 paper / ink 双主题定义。
 */
import hljs from "highlight.js/lib/common"
import { marked } from "marked"
import { markedHighlight } from "marked-highlight"

marked.setOptions({ gfm: true, breaks: false })
marked.use(
  markedHighlight({
    langPrefix: "hljs language-",
    highlight(code, lang) {
      // 仅指定且识别语言时高亮；否则按纯文本（plaintext 只做转义，不着色）
      const language = lang && hljs.getLanguage(lang) ? lang : "plaintext"
      return hljs.highlight(code, { language }).value
    },
  })
)

/** Markdown → HTML。渲染内容为用户自己的创作/AI 回复，不做额外 sanitize。 */
export function renderMarkdown(source: string): string {
  return marked.parse(source, { async: false }) as string
}

/** 完整 GFM token 分块；引用链接在 lexer 阶段解析，已结束块缓存，保留表格/列表/围栏边界。 */
const blockCache = new Map<string, string>()
export function renderMarkdownBlocks(source: string): string[] {
  const tokens = marked.lexer(source)
  const linksKey = JSON.stringify(tokens.links)
  return tokens.filter(token => token.type !== "space").map(token => {
    const key = token.raw + "\u0000" + linksKey
    const cached = blockCache.get(key)
    if (cached !== undefined) return cached
    if (marked.defaults.walkTokens) marked.walkTokens([token], marked.defaults.walkTokens)
    const html = marked.parser([token], { ...marked.defaults, async: false }) as string
    blockCache.set(key, html)
    if (blockCache.size > 256) blockCache.delete(blockCache.keys().next().value!)
    return html
  })
}
