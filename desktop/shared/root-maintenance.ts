/** Public read-only progress, never a directory grant or filesystem capability. */
export type RootMaintenancePhase="preparing"|"validating"|"copying"|"verifying"|"committing"|"cleanup"|"complete"|"cleanup-pending"|"rollback-pending"|"cancelled"|"failed"|"recovery-required"
export interface RootMaintenanceState {
 version:1
 revision:number
 phase:RootMaintenancePhase
 theme:"paper"|"ink"
 sourcePath:string|null
 targetPath:string|null
 /** Fresh relocation proof only; source/target above remain migration history. */
 currentRootPath?:string|null
 copiedFiles:number
 totalFiles:number|null
 canCancel:boolean
 canContinue:boolean
 pendingCount:number
 /** null means details could not be correlated; an empty array means none. */
 pendingItems?:string[]|null
}
export interface RootMaintenanceBridge {
 state():Promise<RootMaintenanceState>
 subscribe(listener:(state:RootMaintenanceState)=>void):()=>void
 command(command:"cancel"|"continue"|"quit"):Promise<void>
}

const pendingLabels:Record<string,string>={
 UNOWNED_TARGET_REMAINS:"目标目录中有非本次迁移创建的内容，已保留。",
 NEW_ROOT_CHANGED:"新目录已有后续修改，旧副本已保留。",
 LEGACY_DIRECTORY_CLEANUP:"旧记录缺少目录身份，原目录已保留。",
 DIRECTORY_CLEANUP:"旧目录尚未清理完成。",
 POINTER_DURABILITY:"数据目录切换的写盘结果尚未确认。",
 CLEANUP_INTERRUPTED:"清理被中断，剩余原文件已保留。",
}
export function validMaintenancePendingItem(value:unknown):value is string{
 return typeof value==="string"&&value.length>0&&value.length<=4096&&!/[\x00-\x1f\x7f\\]/.test(value)&&!value.startsWith("/")&&!value.includes(":")&&value.split("/").every(part=>part!==""&&part!=="."&&part!=="..")
}
export function maintenancePendingLabel(value:string):string{return Object.hasOwn(pendingLabels,value)?pendingLabels[value]:value}
