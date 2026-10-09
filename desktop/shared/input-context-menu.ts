import { z } from "zod"
export const inputContextStateSchema = z.object({
  "text.undo": z.boolean(), "text.redo": z.boolean(),
  "text.cut": z.boolean(), "text.copy": z.boolean(),
  "text.paste": z.boolean(), "text.selectAll": z.boolean(),
}).strict()
export type InputContextState = z.infer<typeof inputContextStateSchema>
export type InputContextCommand = keyof InputContextState
export const inputContextCommands: ReadonlyArray<{ id: InputContextCommand; label: string }> = [
  { id: "text.undo", label: "撤销" }, { id: "text.redo", label: "重做" },
  { id: "text.cut", label: "剪切" }, { id: "text.copy", label: "复制" },
  { id: "text.paste", label: "粘贴" }, { id: "text.selectAll", label: "全选" },
]
