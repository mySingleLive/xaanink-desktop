export type RootRelocationPhase='checking'|'unavailable'|'picking'|'confirming'|'writing'|'cancelled'|'complete'|'blocked'
export type RootRelocationNotice='root-unavailable'|'pointer-invalid'|'history-needs-recovery'|'target-not-original'|'target-invalid'|'confirmation-failed'|'write-unconfirmed'|'operation-failed'|'owner-expired'|null
/** Read-only display state: no grant, receipt capabilities, Key or renderer path input. */
export interface RootRelocationState{version:1;revision:number;phase:RootRelocationPhase;theme:'paper'|'ink';platform?:'darwin'|'win32'|'linux';sourcePath:string|null;targetPath:string|null;notice:RootRelocationNotice;unreadResultCount:number|null;canChoose:boolean;canCancel:boolean;canRestart:boolean}
export type RootRelocationCommand='choose'|'cancel'|'restart'|'quit'|'menu'
export interface RootRelocationBridge{state():Promise<RootRelocationState>;subscribe(listener:(state:RootRelocationState)=>void):()=>void;command(command:RootRelocationCommand):Promise<void>}
