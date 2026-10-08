import {contextBridge,ipcRenderer} from 'electron'
import type {RootMaintenanceBridge,RootMaintenanceState} from '../shared/root-maintenance'
const bridge:RootMaintenanceBridge={
 state:()=>ipcRenderer.invoke('desktop:maintenance-state'),
 command:command=>ipcRenderer.invoke('desktop:maintenance-command',command),
 subscribe(listener){const receive=(_event:unknown,state:RootMaintenanceState)=>listener(state);ipcRenderer.on('desktop:maintenance-event',receive);return()=>ipcRenderer.removeListener('desktop:maintenance-event',receive)},
}
contextBridge.exposeInMainWorld('desktopMaintenance',bridge)
