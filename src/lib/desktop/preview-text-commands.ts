import type { MarkdownEditorHandle } from "@/components/editor/use-editor-commands"
import type { CommandTarget } from "./command-targets"
import { registerDesktopCommandTarget } from "./command-runtime"
import { isPreviewBodyTarget } from "@/components/editor/preview-selection"
import { commandScope } from "./command-scope"
export interface PreviewTextOptions {
  preview(): HTMLElement | null
  handle(): MarkdownEditorHandle | null
  registerTarget?: (target: CommandTarget<HTMLElement | null>) => () => void
}
export function installPreviewTextCommands(options: PreviewTextOptions): () => void {
  let alive = true
  const commands = { "text.copy": "copy", "text.cut": "cut", "text.paste": "paste", "text.pastePlain": "pastePlain", "text.selectAll": "selectAll" } as const
  const available = (command: typeof commands[keyof typeof commands]) => {
    const preview = options.preview(), handle = options.handle()
    if (!alive || !handle || !preview?.isConnected || !preview.getClientRects().length) return false
    if (command === "selectAll") return true
    const state = handle.captureSelection()
    return command === "copy" ? state.hasSelection : state.canReplace && (command !== "cut" || state.hasSelection)
  }
  const release = (options.registerTarget ?? registerDesktopCommandTarget)({ owner: {},
    accepts: target => { const preview = options.preview(); return alive && !!target && commandScope(target) === "preview" && !!preview?.isConnected && !!preview.getClientRects().length && isPreviewBodyTarget(preview, target) },
    commands: Object.fromEntries(Object.entries(commands).map(([id, command]) => [id, { enabled: () => available(command), run: async () => {
      if (!available(command)) throw new Error("当前正文选区不可用")
      const handle = options.handle()
      if (!handle) throw new Error("正文已关闭")
      if (command !== "selectAll") handle.captureSelection()
      await handle.executeCommand(command)
    } }])),
  })
  return () => { if (alive) { alive = false; release() } }
}
