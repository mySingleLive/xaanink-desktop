import {contextBridge,ipcRenderer} from 'electron'
import type {RootRelocationBridge,RootRelocationState} from '../shared/root-relocation'
const bridge:RootRelocationBridge={
 state:()=>ipcRenderer.invoke('desktop:relocation-state'),
 command:command=>ipcRenderer.invoke('desktop:relocation-command',command),
 subscribe(listener){const receive=(_event:unknown,state:RootRelocationState)=>listener(state);ipcRenderer.on('desktop:relocation-event',receive);return()=>ipcRenderer.removeListener('desktop:relocation-event',receive)},
}
contextBridge.exposeInMainWorld('desktopRootRelocation',bridge)
