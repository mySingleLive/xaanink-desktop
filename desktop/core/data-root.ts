import {readApplicationBrand,applicationNames} from "./brand-names";
import {BRAND_NAMES,migrationBrandNames} from "../shared/brand-names";
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, lstat, mkdir, open, readdir, rename, rmdir, statfs, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { z } from 'zod';
import { atomicWrite, CommitDurabilityError } from './versioned-store';
import {ROOT_MIGRATION_LIMITS as limits} from './root-inventory-limits';
import {inspectApplicationBackupInventory,type ApplicationBackupInventory} from './application-backup-inventory';
import {assertDirectoryImmediately,assertFileImmediately} from './application-backup-files';
import {lstatSync,unlinkSync,rmdirSync} from 'node:fs';
import { allowedManagedDirectory, allowedManagedFile, assertDirectory, directoryIdentity, hashRegular, managedPath, overlapping, readMetadata, regularIdentity, rootIdentitySchema, rootMarkerSchema, sameIdentity, safeRelative, syncDirectory, within, type FileIdentity } from './root-ownership';
export interface RootIdentity {
    path: string;
    device: string;
    inode: string;
}
export interface RootPointer {
    schemaVersion: 1;
    revision: number;
    rootId: string;
    migrationId: string | null;
    root: RootIdentity;
}
export type RootResolution = {
    state: 'needs-initialize';
    path: string;
} | {
    state: 'existing';
    pointer: RootPointer;
};
export interface ClosedRootLease {
    source: RootIdentity;
    /** Exact, trusted application ownership inventory; never renderer input. */
    ownedFiles: readonly string[];
    /** Empty engine/session directories are data layout, not inferred file parents. */
    ownedDirectories?: readonly string[];
    /** Observed foreign/failed items: retained at source, never copied or deleted. */
    preserved?: readonly string[];
    assertClosed(): void | Promise<void>;
    release(outcome: 'old-root' | 'new-root'): void | Promise<void>;
}
export interface MigrationHost {
    quiesce(source: RootPointer): Promise<ClosedRootLease>;
}
export type MigrationStatus = 'complete' | 'cleanup-pending' | 'rolled-back' | 'rollback-pending';
export interface MigrationResult {
    status: MigrationStatus;
    migrationId: string;
    root: RootPointer;
    pending: string[];
}
export interface RootOptions {
    /** Cold-only, trusted proof provider. No path/boolean capability from IPC. */
    retainedRelocation?(pointer: RootPointer, journalChecksum: string): Promise<RootRelocationRetention | null>;
    /** Main-owned durable execution nonce, never renderer input. */
    migrationId?: string;
    hook?(phase: string, path?: string): void | Promise<void>;
    availableBytes?(path: string): Promise<number>;
    beforePointerRename?(): Promise<void>;
    beforePointerDirectorySync?(): Promise<void>;
}
export interface RootRelocationRetention {
    pointer: RootPointer;
    journalChecksum: string;
    /** Recheck all original proofs synchronously after the last durability await. */
    assertCurrent(): void;
}
export const rootAuthorityFileSchema=z.object({device:z.string().regex(/^\d+$/),inode:z.string().regex(/^\d+$/),size:z.string().regex(/^\d+$/),mtimeNs:z.string().regex(/^\d+$/),ctimeNs:z.string().regex(/^\d+$/),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict()
export class RootMigrationError extends Error {
    constructor(readonly code: string, options?: ErrorOptions) { super(code, options); this.name = 'RootMigrationError'; }
}
/** Test-only crash marker simulates loss of process without invoking rollback. */
export class RootMigrationCrash extends Error {
}
const pointerSchema = z.object({ schemaVersion: z.literal(1), revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), rootId: z.uuid(), migrationId: z.uuid().nullable(), root: rootIdentitySchema }).strict();
const fileIdentitySchema = z.object({ device: z.string().regex(/^\d+$/), inode: z.string().regex(/^\d+$/) }).strict();
const entrySchema = z.object({ path: z.string().max(1024), size: z.number().int().nonnegative().max(2 ** 40), sha256: z.string().regex(/^[a-f0-9]{64}$/), sourceIdentity: fileIdentitySchema, stageIdentity: fileIdentitySchema.optional(), targetIdentity: fileIdentitySchema.optional() }).strict();
type Entry = z.infer<typeof entrySchema>;
const directoryEntrySchema=z.object({path:z.string().max(1024),sourceIdentity:fileIdentitySchema,targetIdentity:fileIdentitySchema.optional()}).strict();
type DirectoryEntry=z.infer<typeof directoryEntrySchema>;
const journalSchema = z.object({ schemaVersion: z.literal(1), migrationId: z.uuid(), phase: z.enum(['copying', 'verified', 'committed', 'cleanup-pending', 'rolled-back', 'rollback-pending', 'complete']), source: pointerSchema, authoritySourcePointerFile:rootAuthorityFileSchema.optional(), target: rootIdentitySchema, stage: z.string(), stageIdentity: rootIdentitySchema.optional(), sourceInboxIdentity: rootIdentitySchema, targetInboxIdentity: rootIdentitySchema.optional(), files: z.array(entrySchema).max(limits.files), directories:z.array(directoryEntrySchema).max(limits.directories).optional(), preserved:z.array(z.string().refine(safeRelative)).max(limits.entries).optional(), recovery: entrySchema.optional(), createdAt: z.string(), pending: z.array(z.string()).max(limits.pending) }).strict();
type Journal = z.infer<typeof journalSchema>;
function journalNames(j:Journal){try{const names=migrationBrandNames(j.stage,j.migrationId),markers=BRAND_NAMES.filter(value=>j.files.some(file=>file.path===value.appMarker));if(markers.length>1||markers.length===1&&markers[0].family!==names.family)throw Error('mixed namespace');return names}catch(cause){failure('JOURNAL_INVALID',cause)}}
type CatalogProof={file:{device:string;inode:string;size:string;mtimeNs:string;ctimeNs:string}|null;allowMissing:boolean};
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, canonical(v)])) : value;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
function failure(code: string, cause?: unknown): never { throw new RootMigrationError(code, { cause }); }
function cancelled(signal?: AbortSignal) {
    if (signal?.aborted)
        failure('MIGRATION_CANCELLED');
}
/** Main-process use only, under the stable application instance lock. */
export class DataRootManager {
    /** Pure authority-format validation shared by the cold root locator. */
    static parsePointer(value: unknown): RootPointer { return pointerSchema.parse(value); }
    /** Pure validation for exact copied historical journal bytes. No recovery,
     * current-path reads, cleanup or root adoption is authorized here. */
    static parseMigrationSnapshot(value:unknown){
        const envelope=z.object({journal:journalSchema,sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(value),j=envelope.journal;
        if(digest(j)!==envelope.sha256||j.files.length+(j.directories?.length??0)+(j.preserved?.length??0)>limits.entries||j.recovery?.stageIdentity||j.preserved&&(new Set(j.preserved).size!==j.preserved.length||j.preserved.some(path=>j.files.some(file=>file.path===path||file.path.startsWith(path+'/'))||j.directories?.some(directory=>directory.path===path||directory.path.startsWith(path+'/')))))failure('JOURNAL_INVALID');
        if(j.directories&&(new Set(j.directories.map(d=>d.path)).size!==j.directories.length||j.directories.some(d=>!allowedManagedDirectory(d.path)||j.files.some(f=>f.path===d.path))))failure('JOURNAL_INVALID');
        if(j.stage!==`${journalNames(j).migrationStagePrefix}${j.migrationId}`||new Set(j.files.map(f=>f.path)).size!==j.files.length||!j.files.every(f=>allowedManagedFile(f.path))||j.recovery?.path!==`${journalNames(j).rootRecoveryPrefix}${j.migrationId}.json`&&j.recovery!==undefined||j.stageIdentity&&j.stageIdentity.path!==join(j.target.path,j.stage)||j.sourceInboxIdentity.path!==join(j.source.root.path,'inbox')||j.targetInboxIdentity&&j.targetInboxIdentity.path!==join(j.target.path,'inbox')||within(j.source.root.path,j.target.path)||within(j.target.path,j.source.root.path)||sameIdentity(j.source.root,j.target))failure('JOURNAL_INVALID');
        return structuredClone(envelope);
    }
    private busy = false;
    private readonly catalogs=new WeakMap<ClosedRootLease,CatalogProof>();
    constructor(readonly bootstrap: string, readonly defaultRoot: string, readonly options: RootOptions = {}) { }
    private get pointerPath() { return join(this.bootstrap, 'data-root.json'); }
    private get journalPath() { return join(this.bootstrap, 'root-migration.json'); }
    private async boot() {
        try {
            return await directoryIdentity(this.bootstrap);
        }
        catch (cause) {
            failure('BOOTSTRAP_UNAVAILABLE', cause);
        }
    }
    private async metadata(path: string) {
        await this.boot();
        try {
            return await readMetadata(path,path===this.journalPath?limits.journalBytes:undefined);
        }
        catch (cause) {
            if (missing(cause))
                return null;
            failure('METADATA_UNSAFE', cause);
        }
    }
    private async pointer() {
        const value = await this.metadata(this.pointerPath);
        if (value === null)
            return null;
        try {
            return pointerSchema.parse(value);
        }
        catch (cause) {
            failure('POINTER_INVALID', cause);
        }
    }
    private async marker(root: RootIdentity) {
        try {
            await assertDirectory(root);
            return (await readApplicationBrand(root)).value;
        }
        catch (cause) {
            failure('ROOT_MARKER_INVALID', cause);
        }
    }
    private async validatePointer(pointer: RootPointer) {
        try {
            await assertDirectory(pointer.root);
            const marker = await this.marker(pointer.root);
            if (marker.phase !== 'ready' || marker.id !== pointer.rootId)
                throw Error('marker mismatch');
        }
        catch (cause) {
            failure('ROOT_UNAVAILABLE', cause);
        }
    }
    private async assertNoHistoryWithoutPointer(){
        const boot=await this.boot(),entries=await readdir(boot.path);
        assertDirectoryImmediately(boot);
        if(entries.some(name=>name==='root-migration-request.json'||name.startsWith('root-relocation-')||name.startsWith('application-restore-')))failure('MIGRATION_RECOVERY_REQUIRED');
    }
    async resolve(): Promise<RootResolution> {
        const p = await this.pointer();
        if (p) {
            await this.validatePointer(p);
            return { state: 'existing', pointer: p };
        }
        const j = await this.readJournal();
        if (j)
            failure('MIGRATION_RECOVERY_REQUIRED');
        await this.assertNoHistoryWithoutPointer();
        if (!isAbsolute(this.defaultRoot))
            failure('ROOT_PATH_INVALID');
        try {
            const root = await directoryIdentity(this.defaultRoot);
            if ((await readdir(root.path)).length) {
                const marker = await this.marker(root);
                if (marker.phase !== 'ready')
                    failure('ROOT_MARKER_INVALID');
            }
        }
        catch (cause) {
            if (!missing(cause))
                throw cause;
        }
        return { state: 'needs-initialize', path: this.defaultRoot };
    }
    async adopt(root: RootIdentity): Promise<RootPointer> {
        if (this.busy)
            failure('MIGRATION_BUSY');
        this.busy = true;
        try {
            if (await this.pointer())
                failure('POINTER_ALREADY_EXISTS');
            const journal = await this.readJournal();
            if (journal)
                failure('MIGRATION_RECOVERY_REQUIRED');
            await this.assertNoHistoryWithoutPointer();
            const marker = await this.marker(root);
            if (marker.phase !== 'ready')
                failure('ROOT_MARKER_INVALID');
            const pointer: RootPointer = { schemaVersion: 1, revision: 1, rootId: marker.id, migrationId: null, root };
            const boot = await this.boot();
            await atomicWrite(this.pointerPath, JSON.stringify(pointer) + '\n', { beforeRename: async () => {
                    await assertDirectory(boot);
                    await this.validatePointer(pointer);
                    if (await this.pointer())
                        failure('POINTER_CHANGED');
                    await this.assertNoHistoryWithoutPointer();
                } });
            return pointer;
        }
        finally {
            this.busy = false;
        }
    }
    private async readJournal(): Promise<Journal | null> {
        const value = await this.metadata(this.journalPath);
        if (value === null)
            return null;
        try {
            const envelope = z.object({ journal: journalSchema, sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(value);
            if (digest(envelope.journal) !== envelope.sha256)
                throw Error('checksum');
            const j = envelope.journal;
            if(j.files.length+(j.directories?.length??0)+(j.preserved?.length??0)>limits.entries||j.recovery?.stageIdentity||j.preserved&&(new Set(j.preserved).size!==j.preserved.length||j.preserved.some(path=>j.files.some(file=>file.path===path||file.path.startsWith(path+'/'))||j.directories?.some(directory=>directory.path===path||directory.path.startsWith(path+'/')))))throw Error('invalid preserved manifest');
            if(j.directories&&(new Set(j.directories.map(d=>d.path)).size!==j.directories.length||j.directories.some(d=>!allowedManagedDirectory(d.path)||j.files.some(f=>f.path===d.path))))throw Error('invalid directory manifest');
            if (j.stage !== `${journalNames(j).migrationStagePrefix}${j.migrationId}` || new Set(j.files.map(f => f.path)).size !== j.files.length || !j.files.every(f => allowedManagedFile(f.path)) || j.recovery?.path !== `${journalNames(j).rootRecoveryPrefix}${j.migrationId}.json` && j.recovery !== undefined || j.stageIdentity && j.stageIdentity.path !== join(j.target.path, j.stage) || j.sourceInboxIdentity.path !== join(j.source.root.path, 'inbox') || j.targetInboxIdentity && j.targetInboxIdentity.path !== join(j.target.path, 'inbox') || (within(j.source.root.path, j.target.path) || within(j.target.path, j.source.root.path) || sameIdentity(j.source.root, j.target)))
                throw Error('invalid manifest');
            return j;
        }
        catch (cause) {
            failure('JOURNAL_INVALID', cause);
        }
    }
    /** Read-only correlation for a request resumed after process loss. */
    async recordedMigration(migrationId: string) {
        if (!z.uuid().safeParse(migrationId).success) failure('MIGRATION_ID_INVALID');
        const j = await this.readJournal();
        if (!j || j.migrationId !== migrationId) return null;
        const terminal = ['complete', 'cleanup-pending', 'rolled-back', 'rollback-pending'].includes(j.phase);
        return structuredClone({ migrationId: j.migrationId, phase: j.phase, source: j.source, target: j.target,
            result: terminal ? this.result(j, ['complete', 'cleanup-pending'].includes(j.phase) ? this.newPointer(j) : j.source) : null });
    }
    private async writeJournal(j: Journal) {
        journalSchema.parse(j);
        if(j.recovery?.stageIdentity||j.files.length+(j.directories?.length??0)+(j.preserved?.length??0)>limits.entries)failure('JOURNAL_INVALID');
        const encoded=JSON.stringify({journal:j,sha256:digest(j)})+'\n';
        if(Buffer.byteLength(encoded)>limits.journalBytes)failure('JOURNAL_TOO_LARGE');
        const boot = await this.boot(), old = await this.metadata(this.journalPath), fingerprint = old === null ? null : digest(old);
        await atomicWrite(this.journalPath, encoded, { beforeRename: async () => {
                await assertDirectory(boot);
                const current = await this.metadata(this.journalPath);
                if ((current === null ? null : digest(current)) !== fingerprint)
                    failure('JOURNAL_CHANGED');
            } });
        await this.options.hook?.('journal');
    }
    private assertJournalCapacity(j:Journal){
        // Reserve the later per-file/per-directory identities, the recovery
        // receipt, and both possible rollback locations before any stage write.
        // Entry limits and a byte limit are independent; long manifests may
        // be rejected below the count limit, without writing an unreadable log.
        if(j.recovery?.stageIdentity||j.files.length+(j.directories?.length??0)+(j.preserved?.length??0)>limits.entries)failure('JOURNAL_INVALID');
        const identity={device:'9'.repeat(20),inode:'9'.repeat(20)};
        const projected={...j,stageIdentity:{...j.target,...identity,path:join(j.target.path,j.stage)},targetInboxIdentity:{...j.target,...identity,path:join(j.target.path,'inbox')},
            files:j.files.map(file=>({...file,stageIdentity:identity,targetIdentity:identity})),directories:j.directories?.map(directory=>({...directory,targetIdentity:identity})),
            recovery:{path:`${journalNames(j).rootRecoveryPrefix}${j.migrationId}.json`,size:2**40,sha256:'0'.repeat(64),sourceIdentity:identity,targetIdentity:identity},
            pending:[...j.files.flatMap(file=>[file.path,`${j.stage}/${file.path}`]),...(j.directories??[]).map(directory=>directory.path),...(j.preserved??[]),`${journalNames(j).rootRecoveryPrefix}${j.migrationId}.json`,'UNOWNED_TARGET_REMAINS']};
        if(Buffer.byteLength(JSON.stringify({journal:projected,sha256:'0'.repeat(64)})+'\n')>limits.journalBytes)failure('JOURNAL_TOO_LARGE');
    }
    private async assertSource(lease: ClosedRootLease, source: RootPointer, signal?: AbortSignal) {
        cancelled(signal);
        await lease.assertClosed();
        cancelled(signal);
        if (!sameIdentity(lease.source, source.root) || lease.source.path !== source.root.path)
            failure('SOURCE_NOT_CLOSED');
        try {
            await assertDirectory(source.root);
        }
        catch (cause) {
            failure('SOURCE_UNSAFE', cause);
        }
        this.assertCatalog(lease,source);
    }
    private assertCatalog(lease:ClosedRootLease,source:RootPointer){
        try{
            assertDirectoryImmediately(source.root);
            const proof=this.catalogs.get(lease);if(!proof)return;
            try{if(!proof.file){lstatSync(join(source.root.path,'catalog.json'));failure('CATALOG_CHANGED');}else assertFileImmediately(source.root,'catalog.json',proof.file);}
            catch(cause){if(!proof.allowMissing||!missing(cause))throw cause;}
        }catch(cause){if(cause instanceof RootMigrationError)throw cause;failure('CATALOG_CHANGED',cause);}
    }
    private async captureCatalog(lease:ClosedRootLease,source:RootPointer,expected?:Entry,allowMissing=false){
        try{
            const result=await hashRegular(await managedPath(source.root,'catalog.json'),()=>this.assertSource(lease,source));
            if(expected&&(result.sha256!==expected.sha256||result.size!==expected.size||!sameIdentity(result.identity,expected.sourceIdentity)))failure('CATALOG_CHANGED');
            this.catalogs.set(lease,{file:{...result.identity,...result.revision},allowMissing});
        }catch(cause){if(!allowMissing||!missing(cause))throw cause;this.catalogs.set(lease,{file:null,allowMissing:true});}
        await this.assertSource(lease,source);
    }
    private async inventory(source: RootPointer, lease: ClosedRootLease, signal?: AbortSignal) {
        await this.assertSource(lease, source, signal);
        try {
            await directoryIdentity(join(source.root.path, 'inbox'));
        }
        catch (cause) {
            failure('SOURCE_UNSAFE', cause);
        }
        if (lease.ownedFiles.length > limits.files || new Set(lease.ownedFiles).size !== lease.ownedFiles.length || ![applicationNames(source.root).appMarker, 'catalog.json'].every(p => lease.ownedFiles.includes(p)) || !lease.ownedFiles.every(allowedManagedFile))
            failure('OWNERSHIP_INVALID');
        for (const name of ['state.json', 'drafts.json', 'backup-plan.json', 'restore-draft-barrier.json']) {
            try {
                await lstat(join(source.root.path, name));
                if (!lease.ownedFiles.includes(name))
                    failure('OWNERSHIP_INCOMPLETE');
            }
            catch (cause) {
                if (!missing(cause))
                    throw cause;
            }
        }
        let workPaths: string[];
        try {
            await this.captureCatalog(lease,source);
            const catalog = z.object({ schemaVersion: z.literal(1), revision: z.number().int().nonnegative(), value: z.array(z.object({ path: z.string() }).passthrough()) }).strict().parse(await readMetadata(join(source.root.path, 'catalog.json')));
            await this.assertSource(lease,source,signal);
            workPaths = catalog.value.map(r => r.path);
            if (workPaths.some(p => !isAbsolute(p)))
                throw Error('invalid work path');
        }
        catch (cause) {
            failure('CATALOG_INVALID', cause);
        }
        const files: Entry[] = [];
        for (const path of [...lease.ownedFiles].sort()) {
            await this.assertSource(lease, source, signal);
            const absolute = join(source.root.path, ...path.split('/'));
            if (workPaths.some(p => within(absolute, p)))
                failure('WORK_PATH_PROTECTED');
            try {
                const result = await hashRegular(await managedPath(source.root, path), () => this.assertSource(lease, source, signal));
                files.push({ path, size: result.size, sha256: result.sha256, sourceIdentity: result.identity });
            }
            catch (cause) {
                if (cause instanceof RootMigrationError)
                    throw cause;
                failure('SOURCE_UNSAFE', cause);
            }
        }
        const ownedDirectories=lease.ownedDirectories??[],directories:DirectoryEntry[]=[],allDirectories=new Set<string>(['inbox']);
        if(ownedDirectories.length>limits.directories||new Set(ownedDirectories).size!==ownedDirectories.length||ownedDirectories.some(path=>!allowedManagedDirectory(path)||files.some(f=>f.path===path)))failure('OWNERSHIP_INVALID');
        for(const path of [...files.map(f=>f.path),...ownedDirectories.map(path=>path+'/.directory')]){
            const parts=path.split('/');while(parts.length>1){parts.pop();allDirectories.add(parts.join('/'));}
        }
        if(allDirectories.size>limits.directories)failure('OWNERSHIP_INVALID');
        for(const path of [...allDirectories].sort()){
            await this.assertSource(lease,source,signal);
            if(workPaths.some(work=>within(join(source.root.path,path),work)))failure('WORK_PATH_PROTECTED');
            try{
                const id=await directoryIdentity(await managedPath(source.root,path));
                directories.push({path,sourceIdentity:{device:id.device,inode:id.inode}});
            }catch(cause){failure('SOURCE_UNSAFE',cause);}
        }
        const preserved=[...(lease.preserved??[])];
        if(files.length+directories.length+preserved.length>limits.entries||new Set(preserved).size!==preserved.length||preserved.some(path=>!safeRelative(path)||files.some(file=>file.path===path)||allDirectories.has(path)))failure('OWNERSHIP_INVALID');
        const packageIds=new Set([...files.map(file=>file.path),...allDirectories].map(path=>/^backups\/application\/packages\/([^/]+)(?:\/|$)/.exec(path)?.[1]).filter((id):id is string=>!!id));
        const packageProofs:ApplicationBackupInventory[]=[];
        for(const id of packageIds){
            const prefix=`backups/application/packages/${id}`;
            let proof:ApplicationBackupInventory;
            try{proof=await inspectApplicationBackupInventory(await directoryIdentity(await managedPath(source.root,prefix)),source.rootId,id,()=>this.assertSource(lease,source,signal));}
            catch(cause){failure('SOURCE_UNSAFE',cause);}
            const expected=[{path:prefix+'/xuanxiang-app-backup.json',size:Number(proof.metadata.size),sha256:proof.metadata.sha256,identity:proof.metadata},...proof.tree.files.map(file=>({...file,path:prefix+'/data/'+file.path}))];
            const supplied=files.filter(file=>file.path.startsWith(prefix+'/'));
            if(supplied.length!==expected.length||expected.some(file=>{const actual=supplied.find(item=>item.path===file.path);return !actual||actual.size!==file.size||actual.sha256!==file.sha256||!sameIdentity(actual.sourceIdentity,file.identity)}))failure('OWNERSHIP_INCOMPLETE');
            const expectedDirectories=[prefix,prefix+'/data',...proof.receipt.directories.map(path=>prefix+'/data/'+path)];
            if(expectedDirectories.length!==[...allDirectories].filter(path=>path===prefix||path.startsWith(prefix+'/')).length||expectedDirectories.some(path=>!allDirectories.has(path)))failure('OWNERSHIP_INCOMPLETE');
            packageProofs.push(proof);
        }
        await this.assertSource(lease,source,signal);for(const proof of packageProofs)proof.assertUnchanged();
        return {files,directories,preserved};
    }
    private async available(path: string) {
        if (this.options.availableBytes)
            return this.options.availableBytes(path);
        const info = await statfs(path, { bigint: true });
        return Number(info.bavail * info.bsize);
    }
    private async validateTarget(source: RootPointer, target: RootIdentity) {
        try {
            await assertDirectory(target);
            await access(target.path, constants.R_OK | constants.W_OK);
        }
        catch (cause) {
            failure('TARGET_UNAVAILABLE', cause);
        }
        if (await overlapping(source.root, target))
            failure('ROOT_OVERLAP');
        if ((await readdir(target.path)).length)
            failure('TARGET_NOT_EMPTY');
        if (await this.available(target.path) < 1024 * 1024)
            failure('INSUFFICIENT_SPACE');
    }
    private async ensureParents(root: RootIdentity, path: string) {
        await assertDirectory(root);
        let cursor = root.path;
        for (const part of path.split('/').slice(0, -1)) {
            cursor = join(cursor, part);
            try {
                await mkdir(cursor, 0o700);
                await syncDirectory(dirname(cursor));
            }
            catch (cause) {
                if ((cause as NodeJS.ErrnoException).code !== 'EEXIST')
                    throw cause;
            }
            const s = await lstat(cursor);
            if (!s.isDirectory() || s.isSymbolicLink())
                failure('TARGET_UNSAFE');
        }
        return join(root.path, ...path.split('/'));
    }
    private async prepareCopies(j: Journal, lease: ClosedRootLease, signal?: AbortSignal) {
        for (const f of j.files) {
            await this.assertSource(lease, j.source, signal);
            const path = await this.ensureParents(j.stageIdentity!, f.path), handle = await open(path, 'wx', 0o600);
            try {
                f.stageIdentity = await regularIdentity(path);
                await handle.sync();
            }
            finally {
                await handle.close();
            }
            await syncDirectory(dirname(path));
        }
        // One immutable batch of exclusive file identities precedes all content
        // writes. During promotion an inode may be at either its staged or final
        // name, so recovery checks both names against this same identity.
        await this.writeJournal(j);
    }
    private async copy(j: Journal, f: Entry, lease: ClosedRootLease, signal?: AbortSignal) {
        await this.assertSource(lease, j.source, signal);
        const src = await managedPath(j.source.root, f.path), stage = j.stageIdentity!;
        const path = await managedPath(stage, f.path);
        const input = await open(src, constants.O_RDONLY | constants.O_NOFOLLOW);
        let output: Awaited<ReturnType<typeof open>> | undefined;
        try {
            if (!sameIdentity(await regularIdentity(src), f.sourceIdentity))
                failure('SOURCE_CHANGED');
            if (!f.stageIdentity || !sameIdentity(await regularIdentity(path), f.stageIdentity))
                failure('TARGET_CHANGED');
            output = await open(path, constants.O_WRONLY | constants.O_NOFOLLOW);
            const info = await output.stat({ bigint: true });
            if (!sameIdentity({ device: String(info.dev), inode: String(info.ino) }, f.stageIdentity) || info.size !== 0n)
                failure('TARGET_CHANGED');
            const hash = createHash('sha256'), buffer = Buffer.alloc(1024 * 1024);
            let size = 0;
            for (;;) {
                await this.assertSource(lease, j.source, signal);
                const { bytesRead } = await input.read(buffer, 0, buffer.length, null);
                if (!bytesRead)
                    break;
                const bytes = buffer.subarray(0, bytesRead);
                await output.writeFile(bytes);
                hash.update(bytes);
                size += bytesRead;
            }
            await output.sync();
            if (size !== f.size || hash.digest('hex') !== f.sha256)
                failure('SOURCE_CHANGED');
        }
        finally {
            await input.close();
            await output?.close();
        }
        await syncDirectory(dirname(path));
        await this.options.hook?.('file-copied', f.path);
        cancelled(signal);
    }
    private async verify(j: Journal, lease: ClosedRootLease, signal?: AbortSignal) {
        for (const f of j.files) {
            await this.assertSource(lease, j.source, signal);
            const a = await hashRegular(await managedPath(j.source.root, f.path), () => this.assertSource(lease, j.source, signal)), b = await hashRegular(await managedPath(j.stageIdentity!, f.path), () => this.assertSource(lease, j.source, signal));
            if (!sameIdentity(a.identity, f.sourceIdentity) || !sameIdentity(b.identity, f.stageIdentity!) || a.sha256 !== f.sha256 || b.sha256 !== f.sha256 || a.size !== f.size || b.size !== f.size)
                failure('VERIFY_FAILED');
        }
        const contents = await this.listFiles(j.stageIdentity!);
        if (contents.length !== j.files.length || contents.some(p => !j.files.some(f => f.path === p)))
            failure('TARGET_CHANGED');
    }
    private async listFiles(root: RootIdentity) {
        const rows: string[] = [];
        const walk = async (path: string) => {
            await assertDirectory(root);
            for (const name of await readdir(join(root.path, path))) {
                const relative = path ? `${path}/${name}` : name;
                if (!safeRelative(relative))
                    failure('TARGET_UNSAFE');
                const s = await lstat(join(root.path, relative));
                if (s.isSymbolicLink())
                    failure('TARGET_UNSAFE');
                if (s.isDirectory())
                    await walk(relative);
                else if (s.isFile())
                    rows.push(relative);
                else
                    failure('TARGET_UNSAFE');
            }
        };
        await walk('');
        return rows;
    }
    private async promote(j: Journal, lease: ClosedRootLease, signal?: AbortSignal) {
        // The target began empty. Exclusively create and receipt every owned
        // directory before moving any file; EEXIST is never ownership proof.
        for(const d of [...j.directories??[]].sort((a,b)=>a.path.split('/').length-b.path.split('/').length)){
            await this.assertSource(lease,j.source,signal);
            const source=await directoryIdentity(await managedPath(j.source.root,d.path));
            if(!sameIdentity(source,d.sourceIdentity))failure('SOURCE_CHANGED');
            const path=await managedPath(j.target,d.path);
            try{await mkdir(path,0o700);}catch(cause){if((cause as NodeJS.ErrnoException).code==='EEXIST')failure('TARGET_CHANGED');throw cause;}
            const target=await directoryIdentity(path);d.targetIdentity={device:target.device,inode:target.inode};await syncDirectory(dirname(path));
        }
        j.targetInboxIdentity = await directoryIdentity(join(j.target.path, 'inbox'));
        await this.writeJournal(j);
        for (const f of j.files) {
            await this.assertSource(lease, j.source, signal);
            await assertDirectory(j.target);
            const from = await managedPath(j.stageIdentity!, f.path), to = await this.ensureParents(j.target, f.path);
            try {
                await lstat(to);
                failure('TARGET_CHANGED');
            }
            catch (cause) {
                if (!missing(cause))
                    throw cause;
            }
            await rename(from, to);
            f.targetIdentity = f.stageIdentity;
            await syncDirectory(dirname(from));
            await syncDirectory(dirname(to));
            await this.options.hook?.('file-promoted', f.path);
        }
        const recoveryPath = `${journalNames(j).rootRecoveryPrefix}${j.migrationId}.json`, path = join(j.target.path, recoveryPath);
        const snapshot = { schemaVersion: 1, migrationId: j.migrationId, createdAt: j.createdAt, source: j.source, target: j.target, files: j.files.map(f => ({ path: f.path, size: f.size, sha256: f.sha256 })),...(j.directories?{directories:j.directories.map(d=>d.path)}:{}) };
        const h = await open(path, 'wx', 0o600);
        try {
            const id = await regularIdentity(path);
            j.recovery = { path: recoveryPath, size: Buffer.byteLength(JSON.stringify(snapshot) + '\n'), sha256: digestText(JSON.stringify(snapshot) + '\n'), sourceIdentity: id, targetIdentity: id };
            await this.writeJournal(j);
            await h.writeFile(JSON.stringify(snapshot) + '\n');
            await h.sync();
        }
        finally {
            await h.close();
        }
        await syncDirectory(j.target.path);
        await this.removeOwnedParents(j.stageIdentity!, j.files);
        await this.removeEmptyTree(j.stageIdentity!);
        await this.writeJournal(j);
    }
    private async removeEmptyTree(root: RootIdentity,finalGuard?:()=>void) {
        try {
            await assertDirectory(root);
            if(finalGuard){finalGuard();assertDirectoryImmediately(root);rmdirSync(root.path)}else await rmdir(root.path);
            await syncDirectory(dirname(root.path));
        }
        catch (cause) {
            if ((cause as NodeJS.ErrnoException).code !== 'ENOTEMPTY' && !missing(cause))
                throw cause;
        }
    }
    private async removeOwnedParents(root: RootIdentity, files: readonly {path:string}[],skip=new Set<string>(),finalGuard?:()=>void) {
        try {
            await assertDirectory(root);
        }
        catch (cause) {
            if (missing(cause))
                return;
            throw cause;
        }
        const paths = new Set<string>();
        for (const f of files) {
            const parts = f.path.split('/');
            while (parts.length > 1) {
                parts.pop();
                paths.add(parts.join('/'));
            }
        }
        for (const path of [...paths].sort((a, b) => b.split('/').length - a.split('/').length)) {
            if(skip.has(path))continue;
            try {
                const absolute = await managedPath(root, path + '/.check');
                await this.removeEmptyTree(await directoryIdentity(dirname(absolute)),finalGuard);
            }
            catch (cause) {
                if (!missing(cause))
                    throw cause;
            }
        }
    }
    private async removeOwnedDirectories(root:RootIdentity,directories:DirectoryEntry[],side:'sourceIdentity'|'targetIdentity',guard?:(entry:DirectoryEntry)=>Promise<void>,finalGuard?:()=>void){
        const pending:string[]=[];
        for(const d of [...directories].sort((a,b)=>b.path.split('/').length-a.path.split('/').length)){
            const identity=d[side];if(!identity)continue;
            let found=false;
            try{
                const path=await managedPath(root,d.path),actual=await directoryIdentity(path);
                found=true;
                if(!sameIdentity(actual,identity)){pending.push(d.path);continue;}
                await guard?.(d);
                await assertDirectory(actual);
                if(finalGuard){finalGuard();assertDirectoryImmediately(root);assertDirectoryImmediately(actual);rmdirSync(path)}else await rmdir(path);await syncDirectory(dirname(path));
            }catch(cause){
                if((found||!missing(cause))&&(cause as NodeJS.ErrnoException).code!=='ENOTEMPTY')pending.push(d.path);
            }
        }
        return pending;
    }
    private async guardedUnlink(root: RootIdentity, f: Entry, id: FileIdentity | undefined, verifyHash: boolean, beforeUnlink?:()=>Promise<void>, finalGuard?:()=>void) {
        if (!id)
            return false;
        try {
            const path = await managedPath(root, f.path);
            let revision:Awaited<ReturnType<typeof hashRegular>>['revision']|undefined;
            if (!sameIdentity(await regularIdentity(path), id))
                return false;
            if (verifyHash) {
                const result = await hashRegular(path);
                if (result.sha256 !== f.sha256 || result.size !== f.size)
                    return false;
                revision=result.revision;
            }
            if (!sameIdentity(await regularIdentity(path), id))
                return false;
            await beforeUnlink?.();
            if(!sameIdentity(await regularIdentity(path),id))return false;
            if(revision){
                const current=await lstat(path,{bigint:true});
                if(!sameIdentity({device:String(current.dev),inode:String(current.ino)},id)||String(current.size)!==revision.size||String(current.mtimeNs)!==revision.mtimeNs||String(current.ctimeNs)!==revision.ctimeNs)return false;
            }
            // The final closed-host callback may change the catalog. Keep its
            // last proof and the victim version in one synchronous delete boundary.
            finalGuard?.();
            assertDirectoryImmediately(root);
            const sealed=lstatSync(path,{bigint:true});
            if(!sealed.isFile()||sealed.isSymbolicLink()||sealed.nlink!==1n||!sameIdentity({device:String(sealed.dev),inode:String(sealed.ino)},id))return false;
            if(revision&&(String(sealed.size)!==revision.size||String(sealed.mtimeNs)!==revision.mtimeNs||String(sealed.ctimeNs)!==revision.ctimeNs))return false;
            unlinkSync(path);
            await syncDirectory(dirname(path));
            return true;
        }
        catch (cause) {
            if (missing(cause)) {
                // ENOENT may come from the replacement guard, not the source.
                // A missing source is clean only while its replacement remains
                // verified; a missing replacement must never count as cleanup.
                try { await beforeUnlink?.(); finalGuard?.(); return true; } catch { return false; }
            }
            return false;
        }
    }
    private async rollback(j: Journal) {
        const pending: string[] = [];
        for (const f of [...j.files, ...(j.recovery ? [j.recovery] : [])]) {
            if ((f.targetIdentity || f.stageIdentity) && !await this.guardedUnlink(j.target, f, f.targetIdentity ?? f.stageIdentity, true))
                pending.push(f.path);
            if (j.stageIdentity && f.stageIdentity && !await this.guardedUnlink(j.stageIdentity, f, f.stageIdentity, false))
                pending.push(`${j.stage}/${f.path}`);
        }
        if (j.stageIdentity) {
            await this.removeOwnedParents(j.stageIdentity, j.files);
            await this.removeEmptyTree(j.stageIdentity);
        }
        pending.push(...await this.removeOwnedDirectories(j.target,j.directories??[],'targetIdentity'));
        if(j.directories)await this.removeOwnedParents(j.target, [...j.files,...j.directories],new Set(j.directories.map(d=>d.path)));
        if (j.targetInboxIdentity)
            await this.removeEmptyTree(j.targetInboxIdentity);
        if ((await readdir(j.target.path)).length)
            pending.push('UNOWNED_TARGET_REMAINS');
        j.pending = [...new Set(pending)];
        j.phase = pending.length ? 'rollback-pending' : 'rolled-back';
        await this.writeJournal(j);
        return this.result(j, j.source);
    }
    private result(j: Journal, root: RootPointer): MigrationResult { return { status: j.phase as MigrationStatus, migrationId: j.migrationId, root, pending: [...j.pending] }; }
    private newPointer(j: Journal): RootPointer { return { schemaVersion: 1, revision: j.source.revision + 1, rootId: j.source.rootId, migrationId: j.migrationId, root: j.target }; }
    private async assertNewDirectories(j:Journal){
        await assertDirectory(j.target);
        try{
            await Promise.all((j.directories??[]).map(async d=>{
                if(!d.targetIdentity)throw Error('directory not receipted');
                await assertDirectory({path:join(j.target.path,d.path),...d.targetIdentity});
            }));
            await assertDirectory(j.target);
        }catch(cause){failure('NEW_ROOT_VERIFY_FAILED',cause);}
    }
    private async assertNew(j: Journal, p: RootPointer, strict = false, guard: () => void | Promise<void> = () => { }) {
        if (digest(p) !== digest(this.newPointer(j)))
            failure('POINTER_CHANGED');
        await this.validatePointer(p);
        if (!j.targetInboxIdentity)
            failure('NEW_ROOT_VERIFY_FAILED');
        try {
            await assertDirectory(j.targetInboxIdentity);
        }
        catch (cause) {
            failure('NEW_ROOT_VERIFY_FAILED', cause);
        }
        for(const d of j.directories??[]){
            await guard();
            try{if(!d.targetIdentity||!sameIdentity(await directoryIdentity(await managedPath(j.target,d.path)),d.targetIdentity))throw Error('changed directory');}
            catch(cause){failure('NEW_ROOT_VERIFY_FAILED',cause);}
        }
        for (const f of [...j.files, ...(j.recovery ? [j.recovery] : [])]) {
            try {
                const actual = await hashRegular(await managedPath(j.target, f.path), guard);
                if (actual.sha256 !== f.sha256 || actual.size !== f.size || !sameIdentity(actual.identity, f.targetIdentity!))
                    throw Error('mismatch');
            }
            catch (cause) {
                if (cause instanceof RootMigrationError)
                    throw cause;
                failure('NEW_ROOT_VERIFY_FAILED', cause);
            }
        }
        if (strict) {
            const expected = new Set([...j.files.map(f => f.path), ...(j.recovery ? [j.recovery.path] : [])]);
            const parents = new Set<string>(['inbox']);
            for(const d of j.directories??[]){const parts=d.path.split('/');while(parts.length){parents.add(parts.join('/'));parts.pop();}}
            for (const path of expected) {
                const parts = path.split('/');
                while (parts.length > 1) {
                    parts.pop();
                    parents.add(parts.join('/'));
                }
            }
            const walk = async (path: string) => {
                await assertDirectory(j.target);
                for (const name of await readdir(join(j.target.path, path))) {
                    const relative = path ? `${path}/${name}` : name;
                    const s = await lstat(join(j.target.path, relative));
                    if (s.isDirectory() && !s.isSymbolicLink() && parents.has(relative))
                        await walk(relative);
                    else if (!s.isFile() || s.isSymbolicLink() || !expected.delete(relative))
                        failure('TARGET_CHANGED');
                }
            };
            await walk('');
            if (expected.size)
                failure('TARGET_CHANGED');
        }
    }
    private async cleanup(j: Journal, lease: ClosedRootLease) {
        await lease.assertClosed();
        if (lease.source.path !== j.source.root.path || !sameIdentity(lease.source, j.source.root))
            failure('SOURCE_NOT_CLOSED');
        const p = await this.pointer();
        if (!p)
            failure('POINTER_CHANGED');
        const catalog=j.files.find(file=>file.path==='catalog.json');
        if(!catalog)failure('OWNERSHIP_INCOMPLETE');
        await this.captureCatalog(lease,j.source,catalog,true);
        await this.assertNew(j, p);
        await this.options.hook?.('cleanup');
        await this.assertNewDirectories(j);
        const pending: string[] = [];
        for (const f of j.files) {
            await lease.assertClosed();
            if (!await this.guardedUnlink(j.source.root, f, f.sourceIdentity, true,async()=>{
                await this.assertSource(lease,j.source);
                const current=await this.pointer();
                if(!current||digest(current)!==digest(this.newPointer(j)))failure('POINTER_CHANGED');
                await this.assertNewDirectories(j);
                const replacement=await hashRegular(await managedPath(j.target,f.path),()=>lease.assertClosed());
                if(replacement.sha256!==f.sha256||replacement.size!==f.size||!sameIdentity(replacement.identity,f.targetIdentity!))failure('NEW_ROOT_VERIFY_FAILED');
                await lease.assertClosed();
                if(digest(await this.pointer())!==digest(this.newPointer(j)))failure('POINTER_CHANGED');
            },()=>this.assertCatalog(lease,j.source)))
                pending.push(f.path);
            await this.options.hook?.('file-cleaned', f.path);
        }
        try {if(!pending.length){
            pending.push(...await this.removeOwnedDirectories(j.source.root,j.directories??[],'sourceIdentity',async d=>{
                await lease.assertClosed();
                if(digest(await this.pointer())!==digest(this.newPointer(j))||!d.targetIdentity||!sameIdentity(await directoryIdentity(await managedPath(j.target,d.path)),d.targetIdentity))failure('NEW_ROOT_VERIFY_FAILED');
            },()=>this.assertCatalog(lease,j.source)));
            if(j.directories)await this.removeOwnedParents(j.source.root, [...j.files,...j.directories],new Set(j.directories.map(d=>d.path)),()=>this.assertCatalog(lease,j.source));
            else if(j.files.some(f=>f.path.includes('/')))pending.push('LEGACY_DIRECTORY_CLEANUP');
            await this.removeEmptyTree(j.sourceInboxIdentity,()=>this.assertCatalog(lease,j.source));
        }}
        catch {
            pending.push('DIRECTORY_CLEANUP');
        }
        for(const path of j.preserved??[]){
            await lease.assertClosed();
            try{await lstat(await managedPath(j.source.root,path));pending.push(path)}catch(cause){if(!missing(cause))pending.push(path)}
        }
        j.phase = pending.length ? 'cleanup-pending' : 'complete';
        j.pending = [...new Set(pending)];
        await this.writeJournal(j);
        await this.options.hook?.('complete');
        return this.result(j, p);
    }
    async migrate(target: RootIdentity, host: MigrationHost, signal?: AbortSignal): Promise<MigrationResult> {
        if (this.busy)
            failure('MIGRATION_BUSY');
        this.busy = true;
        let lease: ClosedRootLease | undefined, j: Journal | undefined, committed = false, crashed = false;
        try {
            cancelled(signal);
            const old = await this.pointer();
            if (!old)
                failure('POINTER_REQUIRED');
            if (old.revision >= Number.MAX_SAFE_INTEGER)
                failure('POINTER_REVISION_EXHAUSTED');
            await this.validatePointer(old);
            const previous = await this.readJournal();
            if (previous && !['complete', 'rolled-back'].includes(previous.phase))
                failure('MIGRATION_RECOVERY_REQUIRED');
            const oldPointerFile=await hashRegular(this.pointerPath);
            const authoritySourcePointerFile={...oldPointerFile.identity,...oldPointerFile.revision,sha256:oldPointerFile.sha256};
            if(digest(await this.pointer())!==digest(old))failure('POINTER_CHANGED');
            assertFileImmediately(await this.boot(),'data-root.json',authoritySourcePointerFile);
            const migrationId = this.options.migrationId ?? randomUUID();
            if (!z.uuid().safeParse(migrationId).success) failure('MIGRATION_ID_INVALID');
            if (previous?.migrationId === migrationId) failure('MIGRATION_ID_REUSED');
            await this.options.hook?.('validating');
            await this.validateTarget(old, target);
            await this.options.hook?.('quiescing');
            lease = await host.quiesce(old);
            await this.assertSource(lease, old, signal);
            const {files,directories,preserved} = await this.inventory(old, lease, signal);
            if (await this.available(target.path) < files.reduce((n, f) => n + f.size, 0) + 1024 * 1024)
                failure('INSUFFICIENT_SPACE');
            await this.validateTarget(old, target);
            assertFileImmediately(await this.boot(),'data-root.json',authoritySourcePointerFile);
            const journal:Journal = { schemaVersion: 1, migrationId, phase: 'copying', source: old, authoritySourcePointerFile, target, stage: `${applicationNames(old.root).migrationStagePrefix}${migrationId}`, sourceInboxIdentity: await directoryIdentity(join(old.root.path, 'inbox')), files, directories,...(preserved.length?{preserved}:{}), createdAt: new Date().toISOString(), pending: [] };
            this.assertJournalCapacity(journal);j=journal;
            await this.writeJournal(j);
            const stage = join(target.path, j.stage);
            await mkdir(stage, 0o700);
            j.stageIdentity = await directoryIdentity(stage);
            await syncDirectory(target.path);
            await this.writeJournal(j);
            await this.prepareCopies(j, lease, signal);
            await this.options.hook?.('copying');
            for (const f of j.files)
                await this.copy(j, f, lease, signal);
            await this.options.hook?.('verifying');
            await this.verify(j, lease, signal);
            j.phase = 'verified';
            await this.writeJournal(j);
            await this.options.hook?.('verified');
            await this.promote(j, lease, signal);
            cancelled(signal);
            await this.assertSource(lease, old, signal);
            const next = this.newPointer(j), boot = await this.boot();
            await this.options.hook?.('pointer');
            try {
                await atomicWrite(this.pointerPath, JSON.stringify(next) + '\n', { beforeRename: async () => {
                        await this.options.beforePointerRename?.();
                        cancelled(signal);
                        await lease!.assertClosed();
                        await assertDirectory(boot);
                        if (digest(await this.pointer()) !== digest(old))
                            failure('POINTER_CHANGED');
                        await this.assertNew(j!, next, true, () => this.assertSource(lease!, old, signal));
                        await this.options.hook?.('ready-to-commit');
                        cancelled(signal);
                        await lease!.assertClosed();
                        for(const d of j!.directories??[]){
                            try{if(!d.targetIdentity||!sameIdentity(await directoryIdentity(await managedPath(j!.target,d.path)),d.targetIdentity))throw Error('changed directory');}
                            catch(cause){failure('NEW_ROOT_VERIFY_FAILED',cause);}
                        }
                        await assertDirectory(boot);
                        if (digest(await this.pointer()) !== digest(old))
                            failure('POINTER_CHANGED');
                        this.assertCatalog(lease!,old);
                        assertFileImmediately(boot,'data-root.json',authoritySourcePointerFile);
                    }, beforeDirectorySync: this.options.beforePointerDirectorySync });
            }
            catch (cause) {
                if (cause instanceof CommitDurabilityError && digest(await this.pointer()) === digest(next)) {
                    committed = true;
                    j.phase = 'cleanup-pending';
                    j.pending = ['POINTER_DURABILITY'];
                    await this.writeJournal(j);
                    return this.result(j, next);
                }
                throw cause;
            }
            committed = true;
            await this.options.hook?.('pointer-written');
            j.phase = 'committed';
            await this.writeJournal(j);
            await this.options.hook?.('committed');
            return await this.cleanup(j, lease);
        }
        catch (cause) {
            crashed = cause instanceof RootMigrationCrash;
            if (crashed)
                throw cause;
            if (!committed && j) {
                const current = await this.pointer();
                if (current && digest(current) === digest(this.newPointer(j)))
                    committed = true;
            }
            if (j && committed) {
                j.phase = 'cleanup-pending';
                j.pending = ['CLEANUP_INTERRUPTED'];
                await this.writeJournal(j);
                return this.result(j, this.newPointer(j));
            }
            if (j)
                await this.rollback(j);
            throw cause;
        }
        finally {
            try {
                if (lease && !crashed)
                    await lease.release(committed ? 'new-root' : 'old-root');
            } finally {
                if(lease)this.catalogs.delete(lease);
                this.busy = false;
            }
        }
    }
    async recover(host: MigrationHost): Promise<MigrationResult | null> {
        if (this.busy)
            failure('MIGRATION_BUSY');
        this.busy = true;
        let lease: ClosedRootLease | undefined, committed = false;
        try {
            const j = await this.readJournal();
            if (!j || ['complete', 'rolled-back'].includes(j.phase))
                return null;
            const p = await this.pointer();
            if (!p)
                failure('POINTER_CHANGED');
            committed = digest(p) === digest(this.newPointer(j));
            if (!committed && digest(p) !== digest(j.source)) {
                if (!['cleanup-pending', 'rollback-pending'].includes(j.phase) || !this.options.retainedRelocation)
                    failure('POINTER_CHANGED');
                const retained = await this.options.retainedRelocation(p, digest(j));
                if (!retained || digest(retained.pointer) !== digest(p) || retained.journalChecksum !== digest(j))
                    failure('POINTER_CHANGED');
                await this.validatePointer(p);
                // The provider seals this exact full journal and wx pointer, not
                // just their IDs. Never resume old-path cleanup/rollback here.
                const sealed: unknown = retained.assertCurrent();
                if (sealed !== undefined) { void Promise.resolve(sealed).catch(() => {}); failure('RELOCATION_PROOF_INVALID'); }
                return this.result(j, p);
            }
            if (committed) {
                // Once the pointer is committed the new root may have served
                // legitimate writes. Its migration snapshot only authorizes
                // deleting old copies; it is not a startup version constraint.
                await this.validatePointer(p);
                try { await this.assertNew(j, p); }
                catch (cause) {
                    if (!(cause instanceof RootMigrationError) || cause.code !== 'NEW_ROOT_VERIFY_FAILED') throw cause;
                    if (digest(await this.pointer()) !== digest(p)) failure('POINTER_CHANGED');
                    await this.validatePointer(p);
                    await syncDirectory(this.bootstrap);
                    j.phase = 'cleanup-pending';
                    j.pending = [...new Set(['NEW_ROOT_CHANGED', ...j.pending])].slice(0, limits.pending);
                    await this.writeJournal(j);
                    if (digest(await this.pointer()) !== digest(p)) failure('POINTER_CHANGED');
                    await this.validatePointer(p);
                    return this.result(j, p);
                }
            } else
                await this.validatePointer(j.source);
            lease = await host.quiesce(j.source);
            await this.assertSource(lease, j.source);
            if (committed) {
                await syncDirectory(this.bootstrap);
                return await this.cleanup(j, lease);
            }
            return await this.rollback(j);
        }
        finally {
            try {
                if (lease) await lease.release(committed ? 'new-root' : 'old-root');
            } finally {
                if(lease)this.catalogs.delete(lease);
                this.busy = false;
            }
        }
    }
}
function digestText(value: string) { return createHash('sha256').update(value).digest('hex'); }
