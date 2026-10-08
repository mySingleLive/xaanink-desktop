/** 任意 chunk 边界/CRLF/末帧无空行均可解析；语法异常交给调用方处理，不能假报完成。 */
export async function* readSSE(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  const parse = (event: string) => {
    const data = event.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).replace(/^ /, "")).join("\n")
    return !data || data.trim() === "[DONE]" ? null : JSON.parse(data) as Record<string, unknown>
  }
  try {
    for (;;) {
      const { done, value } = await reader.read()
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
      const frames = buffer.split(/\r?\n\r?\n/)
      buffer = frames.pop() ?? ""
      for (const frame of frames) { const event = parse(frame); if (event) yield event }
      if (done) { if (buffer.trim()) { const event = parse(buffer); if (event) yield event }; break }
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}
