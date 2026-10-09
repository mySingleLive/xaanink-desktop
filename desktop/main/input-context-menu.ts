import type { BrowserWindow, Menu, MenuItemConstructorOptions } from "electron"
import { inputContextCommands, type InputContextCommand, type InputContextState } from "../shared/input-context-menu"

export class InputContextMenus {
  private readonly pending = new Map<BrowserWindow, () => void>()
  constructor(private readonly build: (template: MenuItemConstructorOptions[]) => Menu) {}
  open(owner: BrowserWindow, state: InputContextState): Promise<InputContextCommand | null> {
    this.pending.get(owner)?.()
    if (owner.isDestroyed() || !owner.isFocused()) return Promise.resolve(null)
    return new Promise(resolve => {
      let done = false
      const finish = (command: InputContextCommand | null) => {
        if (done) return
        done = true; this.pending.delete(owner)
        owner.removeListener("closed",cancel);owner.removeListener("blur",cancel)
        try { menu.closePopup(owner) } catch { /* The owner may already be destroyed. */ }
        resolve(command)
      }
      const cancel = () => finish(null)
      const menu = this.build(inputContextCommands.map(({id,label}) => ({id,label,enabled:state[id],click:()=>finish(owner.isDestroyed() || !owner.isFocused() ? null : id)})))
      this.pending.set(owner,cancel)
      owner.once("closed",cancel);owner.once("blur",cancel)
      try { menu.popup({window:owner,callback:cancel}) } catch { cancel() }
    })
  }
}
