import { contextBridge, ipcRenderer } from "electron"
import type { DesktopBridge, DesktopEvent } from "../shared/ipc"
const bridge: DesktopBridge = {
  bootstrap: () => ipcRenderer.invoke("desktop:bootstrap"),
  persistDraft: (sessionId,snapshot) => ipcRenderer.invoke("desktop:draft-persist",sessionId,snapshot),
  readDraft: sessionId => ipcRenderer.invoke("desktop:draft-read",sessionId),
  markDraftReady: sessionId => ipcRenderer.invoke("desktop:draft-ready",sessionId),
  replyClose: (sessionId,id,reply) => ipcRenderer.invoke("desktop:close-reply",sessionId,id,reply),
  exportFile: request=>ipcRenderer.invoke("desktop:file-export",request),
  cancelFileExport: id=>ipcRenderer.invoke("desktop:file-export-cancel",id),
  exportDraft: (sessionId,snapshot) => ipcRenderer.invoke("desktop:draft-export",sessionId,snapshot),
  request: request => ipcRenderer.invoke("desktop:request", request),
  cancelRequest: id => ipcRenderer.invoke("desktop:cancel", id),
  settings: action => ipcRenderer.invoke("desktop:settings", action),
  discoverModels: (id, draft) => ipcRenderer.invoke("desktop:model-discover", id, draft),
  testModel: (id, draft) => ipcRenderer.invoke("desktop:model-test", id, draft),
  cancelModelConfiguration: id => ipcRenderer.invoke("desktop:model-cancel", id),
  chooseAvatar: id => ipcRenderer.invoke("desktop:avatar-choose", id),
  cancelAvatar: id => ipcRenderer.invoke("desktop:avatar-cancel", id),
  configuration: action=>ipcRenderer.invoke("desktop:configuration",action),
  migrateRoot: action=>ipcRenderer.invoke("desktop:migrate-root",action),
  repairWorkLease: action=>ipcRenderer.invoke("desktop:work-lease",action),
  chooseDirectory: purpose => ipcRenderer.invoke("desktop:directory", purpose),
  command: id => ipcRenderer.invoke("desktop:command", id),
  readClipboardText: () => ipcRenderer.invoke("desktop:clipboard-read"),
  writeClipboardText: text => ipcRenderer.invoke("desktop:clipboard-write", text),
  showInputContextMenu: state => ipcRenderer.invoke("desktop:input-context-menu", state),
  subscribe(listener) {
    const receive = (_event: unknown, event: DesktopEvent) => listener(event)
    ipcRenderer.on("desktop:event", receive)
    return () => { ipcRenderer.removeListener("desktop:event", receive) }
  },
}
ipcRenderer.on("desktop:response-port", (event, data: { id: string }) => {
  if (event.ports.length === 1) window.postMessage({ type: "xaanink-response-port", id: data.id }, window.location.origin, event.ports)
})
contextBridge.exposeInMainWorld("desktop", bridge)
