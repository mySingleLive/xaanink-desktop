import catalog from "./commands.json"
import { bindingsFor, validShortcut, type ShortcutCommand, type ShortcutScope } from "../core/shortcuts"
export type DesktopPlatform = "darwin" | "win32"
export interface DesktopCommand extends ShortcutCommand { group: string }
export interface DesktopMenuItem { id: string; label: string; binding?: string; enabled: boolean }
export interface DesktopMenu { id: string; label: string; items: DesktopMenuItem[] }

export function platformCommands(platform: DesktopPlatform): DesktopCommand[] {
  return catalog.commands.filter(command => command.platform !== "mac" || platform === "darwin").map(command => {
    const key = platform === "darwin" ? command.mac : command.win
    const defaults=command.id==="ai.mentionConfirm" ? ["Tab","Enter"] : command.id==="ai.mentionClose" ? ["Escape"] : key ? [key] : []
    const contexts=command.id.startsWith("ai.mention")&&command.id!=="ai.mention" ? {mention:true} : ["ai.send","ai.newline","ai.stop"].includes(command.id) ? {mention:false} : undefined
    return { id:command.id, label:command.label, group:command.group, scope:command.scope as ShortcutScope, locked:command.locked, defaults, ...(contexts ? {contexts} : {}) }
  })
}
export function desktopMenu(platform: DesktopPlatform, overrides: Record<string,string[]>): DesktopMenu[] {
  const commands = platformCommands(platform)
  const labels: Record<string,string> = {app:"玄印",file:"文件",edit:"编辑",view:"视图",window:"窗口",help:"帮助"}
  return Object.entries(catalog.menus).filter(([group]) => group !== "app" || platform === "darwin").map(([group,source]) => {
    const ids = [...source]
    if (platform === "win32" && group === "file") ids.push("app.settings","app.quit")
    if (platform === "win32" && group === "help") ids.push("app.about")
    return { id:group, label:labels[group], items:ids.flatMap(id => {
      const command=commands.find(command=>command.id===id)
      if (!command) return []
      const binding=(command.locked ? command.defaults : bindingsFor(command,overrides))[0]
      return [{id,label:command.label,binding:binding && validShortcut(binding) ? binding : undefined,enabled:id!=="help.docs"}]
    }) }
  })
}
export function electronAccelerator(binding?: string): string | undefined {
  if (!binding || !validShortcut(binding) || binding.includes(" ")) return undefined
  const names: Record<string,string> = {ArrowLeft:"Left",ArrowRight:"Right",ArrowUp:"Up",ArrowDown:"Down",Equal:"=",Minus:"-",Slash:"/",BracketLeft:"[",BracketRight:"]",Backslash:"\\",Quote:"'",Win:"Super",NumpadAdd:"numadd",NumpadSubtract:"numsub",NumpadMultiply:"nummult",NumpadDivide:"numdiv",NumpadDecimal:"numdec",NumpadEnter:"Enter"}
  // Keys that Electron cannot represent are still handled by the renderer
  // runtime; show their physical binding in the menu's label instead.
  if (/(?:IntlBackslash|NumpadEqual|NumpadComma)/i.test(binding)) return undefined
  return binding.split("+").map(part=>names[part] ?? (/^Numpad\d$/.test(part) ? `num${part.slice(-1)}` : part)).join("+")
}
