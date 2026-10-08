import {contextBridge,ipcRenderer} from 'electron'
import {applicationRestoreEntryCommandSchema,applicationRestoreEntryStateSchema,type ApplicationRestoreEntryBridge,type ApplicationRestoreEntryCommand,type ApplicationRestoreEntryState} from '../shared/application-restore-entry'

const bridge:ApplicationRestoreEntryBridge=Object.freeze({
 async state(){return applicationRestoreEntryStateSchema.parse(await ipcRenderer.invoke('desktop:application-recovery-state'))},
 async command(command:ApplicationRestoreEntryCommand){await ipcRenderer.invoke('desktop:application-recovery-command',applicationRestoreEntryCommandSchema.parse(command))},
 subscribe(listener:(state:ApplicationRestoreEntryState)=>void){
  let alive=true
  const receive=(_event:unknown,input:unknown)=>{if(!alive)return;const state=applicationRestoreEntryStateSchema.safeParse(input);if(state.success)listener(state.data)}
  ipcRenderer.on('desktop:application-recovery-event',receive)
  return()=>{alive=false;ipcRenderer.removeListener('desktop:application-recovery-event',receive)}
 },
})
contextBridge.exposeInMainWorld('desktopApplicationRestore',bridge)
