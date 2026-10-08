import {z} from 'zod'
import type {BackupReceipt} from '../core/work-backups'
import type {ApplicationBackupControlResult} from './application-backup-control'
export const workBackupActionSchema=z.discriminatedUnion('type',[
 z.object({type:z.literal('works')}).strict(),
 z.object({type:z.literal('list'),workId:z.uuid()}).strict(),
 z.object({type:z.literal('now'),retention:z.number().int().min(1).max(1000)}).strict(),
 z.object({type:z.literal('prepare'),workId:z.uuid(),backupId:z.uuid()}).strict(),
 z.object({type:z.literal('cancel'),workId:z.uuid(),candidateId:z.uuid()}).strict(),
 z.object({type:z.literal('activate'),workId:z.uuid(),candidateId:z.uuid(),revision:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)}).strict(),
])
export type WorkBackupAction=z.infer<typeof workBackupActionSchema>
export const workBackupRequestSchema=z.discriminatedUnion('type',[
 z.object({type:z.literal('works')}).strict(),
 z.object({type:z.literal('list'),workId:z.uuid()}).strict(),
 z.object({type:z.literal('now')}).strict(),
])
export type WorkBackupRequest=z.infer<typeof workBackupRequestSchema>
export interface PreparedWorkRestore{id:string;revision:number;backupId:string;createdAt:string}
export type ApplicationBackupOutcome={status:'saved';backup:Extract<ApplicationBackupControlResult,{type:'now'}>['backup']}|{status:'failed';message:string}
export interface WorkBackupBatch{type:'now';saved:BackupReceipt[];failed:Array<{workId:string;title:string;message:string}>;application?:ApplicationBackupOutcome;workError?:string}
export interface DesktopBackupBatch extends WorkBackupBatch{application:ApplicationBackupOutcome}
export function applicationBackupCompletion(outcome:ApplicationBackupOutcome|undefined){return outcome?.status==='saved'?`已完成应用数据备份${outcome.backup.cleanupPending?`；${outcome.backup.cleanupPending} 项临时数据待清理`:''}`:''}
export type WorkBackupResult={type:'works';works:Array<{id:string;title:string}>}|{type:'list';backups:BackupReceipt[]}|WorkBackupBatch|{type:'prepare';candidate:PreparedWorkRestore}|{type:'cancel'}|{type:'activate';revision:number}
