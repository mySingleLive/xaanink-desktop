"use client"
import type { DesktopCommand, DesktopPlatform } from "@desktop/shared/command-registry"
import type { CommandTarget } from "./command-targets"
import { canonicalKey } from "@desktop/core/shortcuts"
import monacoPackage from "../../../node_modules/monaco-editor/package.json"
import type { editor as MonacoEditor } from "monaco-editor"
import { installMarkdownActions, markdownFormats } from "./markdown-actions"
import {commandScope} from "./command-scope"

export interface MonacoExpression { serialize(): string }
export interface MonacoAction { id: string; label: string; alias?: string; isSupported(): boolean; run(): Promise<void> }
export interface MonacoEditorTarget {
  getId?(): string
  getDomNode(): HTMLElement | null
  getModel(): unknown | null
  getRawOptions(): { readOnly?: boolean }
  getSupportedActions(): MonacoAction[]
  getAction(id: string): MonacoAction | null
  focus(): void
  trigger(source: string, id: string, args: unknown): void
  onDidFocusEditorText?(listener: () => void): { dispose(): void }
  onDidChangeModel?(listener: () => void): { dispose(): void }
  onDidDispose?(listener: () => void): { dispose(): void }
}
export interface MonacoCommandSink {
  publish(owner: unknown, commands: MonacoDesktopCommand[]): () => void
  register(target: CommandTarget<HTMLElement | null>): () => void
}
export function registerMonacoEditorCommands(editor: MonacoEditorTarget, runtime: MonacoRuntime, platform: DesktopPlatform, sink: MonacoCommandSink): () => void {
  let closed = false
  let unpublish: (() => void) | undefined, unregister: (() => void) | undefined
  const subscriptions: { dispose(): void }[] = []
  const refresh = () => {
    if (closed) return
    const rows = buildMonacoCommandCatalog(runtime, platform, editor.getSupportedActions(), editor.getId?.())
    unregister?.(); unpublish?.()
    unpublish = sink.publish(editor, rows)
    unregister = sink.register(createMonacoCommandTarget(editor, runtime, rows))
  }
  const dispose = () => {
    if (closed) return
    closed = true; unregister?.(); unpublish?.()
    for (const listener of subscriptions) listener.dispose()
  }
  try {
    refresh()
    if (editor.onDidFocusEditorText) subscriptions.push(editor.onDidFocusEditorText(refresh))
    if (editor.onDidChangeModel) subscriptions.push(editor.onDidChangeModel(refresh))
    if (editor.onDidDispose) subscriptions.push(editor.onDidDispose(dispose))
    return dispose
  } catch (error) { dispose(); throw error }
}
export interface MonacoRuntimeBinding {
  command: string | null
  keybinding: { chords: { ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean; keyCode: number }[] } | null
  when?: MonacoExpression | null
  commandArgs?: unknown
  weight1?: number
  weight2?: number
}
export interface MonacoRuntime {
  version: string
  actions: { id: string; label: string; alias?: string }[]
  bindings: MonacoRuntimeBinding[]
  keyName(code: number): string
  command(id: string): { precondition?: MonacoExpression | null } | null
  contextMatches(editor: MonacoEditorTarget, expression?: MonacoExpression | null): boolean
}
export interface MonacoRuntimeRegistries {
  version: string
  os: number
  keyName(code: number): string
  keys: { getDefaultKeybindings(): MonacoRuntimeBinding[] }
  editors: { getEditorActions(): MonacoRuntime["actions"]; getEditorCommand(id: string): { precondition?: MonacoExpression | null } | null }
  commands: { getCommand(id: string): unknown }
  contextKeyToken: unknown
}
/** Monaco 0.56.0's internal registry and scoped context APIs. Upgrade only
 * with a reviewed adapter: a changed layout fails closed, never truncates. */
export function monacoRuntimeFromRegistries(registries: MonacoRuntimeRegistries, platform: DesktopPlatform): MonacoRuntime {
  if (registries.version !== "0.56.0") throw new Error("MONACO_RUNTIME_VERSION_UNSUPPORTED")
  if (registries.os !== (platform === "darwin" ? 2 : 1)) throw new Error("MONACO_RUNTIME_PLATFORM_MISMATCH")
  if (typeof registries.keys?.getDefaultKeybindings !== "function" || typeof registries.editors?.getEditorActions !== "function" || typeof registries.editors?.getEditorCommand !== "function" || typeof registries.commands?.getCommand !== "function") throw new Error("MONACO_RUNTIME_SHAPE_UNSUPPORTED")
  const runtime: MonacoRuntime = {
    version: registries.version, actions: [...registries.editors.getEditorActions()], bindings: registries.keys.getDefaultKeybindings(), keyName: registries.keyName,
    command: id => registries.editors.getEditorCommand(id) ?? (registries.commands.getCommand(id) ? {} : null),
    contextMatches: (editor, expression) => {
      if (!expression) return true
      const scoped = editor as MonacoEditorTarget & { invokeWithinContext?: (run: (accessor: { get(token: unknown): unknown }) => boolean) => boolean }
      if (typeof scoped.invokeWithinContext !== "function") return false
      try {
        return scoped.invokeWithinContext(accessor => {
          const context = accessor.get(registries.contextKeyToken) as { contextMatchesRules?: (rule: MonacoExpression) => boolean } | null
          return typeof context?.contextMatchesRules === "function" && context.contextMatchesRules(expression) === true
        }) === true
      } catch { return false }
    },
  }
  assertRuntime(runtime)
  return runtime
}
export interface MonacoDesktopCommand extends DesktopCommand {
  monacoId: string
  monacoArgs?: unknown
  monacoBindings: { binding: string; when: string | null; args?: unknown; weight: number; secondaryWeight: number }[]
}
const aliases: Record<string, string> = {
  undo: "text.undo", redo: "text.redo", "editor.action.selectAll": "text.selectAll",
  "editor.action.clipboardCutAction": "text.cut", "editor.action.clipboardCopyAction": "text.copy", "editor.action.clipboardPasteAction": "text.paste",
  "actions.find": "md.find", "editor.action.startFindReplaceAction": "md.replace", "editor.action.nextMatchFindAction": "md.findNext", "editor.action.previousMatchFindAction": "md.findPrevious",
  "editor.action.gotoLine": "md.gotoLine", "editor.action.quickCommand": "md.commandPalette", "editor.action.indentLines": "md.indent", "editor.action.outdentLines": "md.outdent",
  "editor.action.moveLinesUpAction": "md.moveUp", "editor.action.moveLinesDownAction": "md.moveDown", "editor.action.copyLinesUpAction": "md.duplicateUp", "editor.action.copyLinesDownAction": "md.duplicateDown",
  "editor.action.deleteLines": "md.deleteLine", "editor.action.insertLineAfter": "md.insertLineAfter", "editor.action.insertLineBefore": "md.insertLineBefore", "editor.action.joinLines": "md.joinLines",
  "expandLineSelection": "md.selectLine", "editor.action.addSelectionToNextFindMatch": "md.selectNextOccurrence", "editor.action.selectHighlights": "md.selectAllOccurrences",
  "editor.action.insertCursorAbove": "md.cursorAbove", "editor.action.insertCursorBelow": "md.cursorBelow", "editor.action.commentLine": "md.toggleComment", "editor.action.blockComment": "md.blockComment",
  "editor.fold": "md.fold", "editor.unfold": "md.unfold", "editor.foldAll": "md.foldAll", "editor.unfoldAll": "md.unfoldAll", "editor.action.trimTrailingWhitespace": "md.trimWhitespace", "removeSecondaryCursors": "md.selectionCancel",
}
const readOnlyBlocked = new Set(["undo", "redo", "editor.action.clipboardCutAction", "editor.action.clipboardPasteAction", "type", "paste", "cut", "replacePreviousChar", "compositionType"])
function assertRuntime(runtime: MonacoRuntime) {
  if (runtime.version !== "0.56.0") throw new Error("MONACO_RUNTIME_VERSION_UNSUPPORTED")
  if (!Array.isArray(runtime.actions) || !Array.isArray(runtime.bindings) || typeof runtime.command !== "function" || typeof runtime.contextMatches !== "function" || typeof runtime.keyName !== "function") throw new Error("MONACO_RUNTIME_SHAPE_UNSUPPORTED")
}
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(",")}}`
  return JSON.stringify(value) ?? "undefined"
}
const markdownFormatIds = new Set(markdownFormats.map(([id]) => id))
function desktopId(id: string, args?: unknown) { return args === undefined ? aliases[id] ?? (markdownFormatIds.has(id) ? id : `monaco.${id}`) : `monaco.${id}.args.${encodeURIComponent(stableJson(args))}` }
export function monacoBinding(binding: MonacoRuntimeBinding["keybinding"], runtime: MonacoRuntime, platform: DesktopPlatform): string | null {
  if (!binding?.chords.length) return null
  const physical: Record<string, string> = { left: "ArrowLeft", right: "ArrowRight", up: "ArrowUp", down: "ArrowDown", "-": "Minus", "=": "Equal", "/": "Slash", "[": "BracketLeft", "]": "BracketRight", "\\": "Backslash", "'": "Quote", oem_102: "IntlBackslash", pausebreak: "Pause", del: "Delete" }
  const strokes: string[] = []
  for (const chord of binding.chords) {
    const raw = runtime.keyName(chord.keyCode)
    const key = physical[raw?.toLowerCase()] ?? (/^numpad[_]?/i.test(raw) ? raw.replace(/^numpad[_]?/i, "Numpad") : raw)
    // Unknown/modifier-only registrations are still catalogued, without a
    // fabricated executable binding. All real chord strokes remain intact.
    if (!key || ["unknown", "ctrl", "shift", "alt", "meta"].includes(key.toLowerCase())) return null
    strokes.push([chord.metaKey && (platform === "darwin" ? "Cmd" : "Win"), chord.ctrlKey && "Ctrl", chord.altKey && "Alt", chord.shiftKey && "Shift", key].filter(Boolean).join("+"))
  }
  return strokes.join(" ")
}
export function buildMonacoCommandCatalog(runtime: MonacoRuntime, platform: DesktopPlatform, supported: MonacoAction[] = [], instanceId?: string): MonacoDesktopCommand[] {
  assertRuntime(runtime)
  // Standalone addAction stores getAction(descriptor.id) but exposes an
  // InternalEditorAction id of getId()+':'+descriptor.id. Strip only this
  // exact public instance prefix, or our fixed format descriptors when a
  // standalone catalog caller has no editor. Arbitrary colon IDs stay intact.
  const actions = supported.map(action => {
    const prefix = instanceId && `${instanceId}:`
    const format = markdownFormats.find(([id]) => action.id.endsWith(`:${id}`))?.[0]
    const id = prefix && action.id.startsWith(prefix) ? action.id.slice(prefix.length) : format ?? action.id
    return { ...action, id }
  })
  const rows = new Map<string, MonacoDesktopCommand>()
  const labels = new Map([...runtime.actions, ...actions].map(action => [action.id, action.label]))
  const row = (id: string, args?: unknown) => {
    const key = desktopId(id, args)
    if (!rows.has(key)) rows.set(key, { id: key, monacoId: id, ...(args !== undefined ? { monacoArgs: structuredClone(args) } : {}), label: `${labels.get(id) ?? id}${args !== undefined ? ` · ${stableJson(args)}` : ""}`, group: "Monaco 编辑器", scope: key.startsWith("text.") ? "text" : "markdown", locked: false, defaults: [], monacoBindings: [] })
    return rows.get(key)!
  }
  for (const action of [...runtime.actions, ...actions]) row(action.id)
  for (const item of runtime.bindings) {
    if (!item.command) continue
    const command = row(item.command, item.commandArgs)
    const binding = monacoBinding(item.keybinding, runtime, platform)
    if (!binding) continue
    if (!command.defaults.some(value => canonicalKey(value) === canonicalKey(binding))) command.defaults.push(binding)
    const metadata = { binding, when: item.when?.serialize() ?? null, ...(item.commandArgs !== undefined ? { args: structuredClone(item.commandArgs) } : {}), weight: item.weight1 ?? 0, secondaryWeight: item.weight2 ?? 0 }
    if (!command.monacoBindings.some(value => stableJson(value) === stableJson(metadata))) command.monacoBindings.push(metadata)
  }
  return [...rows.values()]
}
export function createMonacoCommandTarget(editor: MonacoEditorTarget, runtime: MonacoRuntime, commands: MonacoDesktopCommand[]): CommandTarget<HTMLElement | null> {
  assertRuntime(runtime)
  const alive = () => !!editor.getDomNode()?.isConnected && !!editor.getDomNode()?.getClientRects().length && !!editor.getModel()
  const available = (row: MonacoDesktopCommand) => {
    if (!alive() || editor.getRawOptions().readOnly && readOnlyBlocked.has(row.monacoId)) return false
    const action = editor.getAction(row.monacoId)
    if (action && !action.isSupported()) return false
    const command = runtime.command(row.monacoId)
    if (!action && !command || !runtime.contextMatches(editor, command?.precondition)) return false
    if (action && row.monacoArgs === undefined) return true
    const registrations = runtime.bindings.filter(item => item.command === row.monacoId && stableJson(item.commandArgs) === stableJson(row.monacoArgs))
    return !registrations.length || registrations.some(item => runtime.contextMatches(editor, item.when))
  }
  const handlers: CommandTarget<HTMLElement | null>["commands"] = Object.fromEntries(commands.map(row => [row.id, {
    enabled: () => available(row),
    run: async () => {
      if (!available(row)) return
      const model = editor.getModel(), dom = editor.getDomNode()
      editor.focus()
      if (editor.getModel() !== model || editor.getDomNode() !== dom || !available(row)) return
      const action = editor.getAction(row.monacoId)
      // Native actions and trigger retain Monaco's edit stack, comments and
      // readonly checks; this adapter never replaces the model or its text.
      if (action && row.monacoArgs === undefined) await action.run()
      else editor.trigger("desktop-shortcut", row.monacoId, row.monacoArgs === undefined ? {} : structuredClone(row.monacoArgs))
    },
  }]))
  if (handlers["text.paste"]) handlers["text.pastePlain"] = handlers["text.paste"]
  return { owner: editor, accepts: target => alive() && !!target && commandScope(target) === "markdown" && !!editor.getDomNode()?.contains(target), commands: handlers }
}

let assembledRegistries: Promise<MonacoRuntimeRegistries> | undefined
async function loadRuntime(platform: DesktopPlatform) {
  // Import the same local assembly as the real editor, before inspecting any
  // registry. No hidden editor, text model, CDN request or user data is needed.
  assembledRegistries ??= (async () => {
    await import("@/components/editor/monaco-setup")
    const [keys, extensions, commands, contexts, codes, os] = await Promise.all([
      // These version-pinned internal entry points are deliberately guarded.
      // @ts-expect-error Internal Monaco JavaScript has no published declarations.
      import("monaco-editor/platform/keybinding/common/keybindingsRegistry.js"),
      // @ts-expect-error Internal Monaco JavaScript has no published declarations.
      import("monaco-editor/editor/browser/editorExtensions.js"),
      // @ts-expect-error Internal Monaco JavaScript has no published declarations.
      import("monaco-editor/platform/commands/common/commands.js"),
      // @ts-expect-error Internal Monaco JavaScript has no published declarations.
      import("monaco-editor/platform/contextkey/common/contextkey.js"),
      // @ts-expect-error Internal Monaco JavaScript has no published declarations.
      import("monaco-editor/base/common/keyCodes.js"),
      // @ts-expect-error Internal Monaco JavaScript has no published declarations.
      import("monaco-editor/base/common/platform.js"),
    ])
    return { version: monacoPackage.version, os: os.OS, keys: keys.KeybindingsRegistry, editors: extensions.EditorExtensionsRegistry, commands: commands.CommandsRegistry, contextKeyToken: contexts.IContextKeyService, keyName: codes.KeyCodeUtils.toUserSettingsUS } as MonacoRuntimeRegistries
  })()
  return monacoRuntimeFromRegistries(await assembledRegistries, platform)
}
/** Call once after desktop bootstrap, before first opening ShortcutSettings.
 * A rejected version/shape/platform must be shown as unavailable by the caller;
 * do not present the static fallback as a complete runtime catalog. */
export async function initializeMonacoCommandCatalog(platform: DesktopPlatform): Promise<() => void> {
  const runtime = await loadRuntime(platform)
  const { publishDesktopCommands } = await import("./command-runtime")
  return publishDesktopCommands(Symbol("monaco-assembled-catalog"), buildMonacoCommandCatalog(withMarkdownFormats(runtime), platform))
}
function withMarkdownFormats(runtime: MonacoRuntime): MonacoRuntime { return { ...runtime, actions: [...runtime.actions, ...markdownFormats.map(([id, label]) => ({ id, label }))] } }
export async function bindMonacoCommandTarget(editor: MonacoEditorTarget, platform: DesktopPlatform): Promise<() => void> {
  const runtime = await loadRuntime(platform)
  const { publishDesktopCommands, registerDesktopCommandTarget } = await import("./command-runtime")
  const releaseFormats = installMarkdownActions(editor as MonacoEditor.IStandaloneCodeEditor)
  try {
    const releaseTarget = registerMonacoEditorCommands(editor, withMarkdownFormats(runtime), platform, { publish: publishDesktopCommands, register: registerDesktopCommandTarget })
    return () => { releaseTarget(); releaseFormats() }
  } catch (error) { releaseFormats(); throw error }
}
