import {BRAND_NAMES} from '../shared/brand-names'
import {applicationNames} from "./brand-names"
import { constants, lstatSync, readdirSync, mkdirSync, openSync, readSync, fstatSync, closeSync, type BigIntStats } from 'node:fs';
import { lstat, readdir } from 'node:fs/promises';
import { join, isAbsolute, dirname, normalize } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DataRootManager, rootAuthorityFileSchema, type RootIdentity, type RootPointer } from './data-root';
import { rootIdentitySchema, rootMarkerSchema, managedPath, hashRegular, directoryIdentity, safeRelative, within, syncDirectory, sameIdentity } from './root-ownership';
import { assertDirectoryImmediately, assertFileImmediately, assertTreeImmediately, canonical, digest, copyFile, readBoundedBytes, writeApplicationMetadata, type StoredFile, type StoredTree } from './application-backup-files';
import { readRootAuthority } from './root-authority';
import { collectClosedRootFiles } from '../main/owned-root-files';
import { ownedRootFile, ownedRootDirectory } from './root-inventory-paths';
import { catalogSchema } from '../service/workspaces';
import { DraftJournal, validateDraftSnapshot } from '../main/draft-journal';
import { applicationCandidateBodySchema, APPLICATION_BACKUP_LIMITS } from '../shared/application-backup';
import { applicationDraftRetentionSchema, APPLICATION_DRAFT_RETENTION_LIMITS } from '../shared/application-restore';
export const APPLICATION_COLD_SOURCE_LIMITS = { ...APPLICATION_BACKUP_LIMITS, entries: APPLICATION_BACKUP_LIMITS.files + APPLICATION_BACKUP_LIMITS.directories + 1024 } as const;
export const APPLICATION_COLD_SOURCE_RECEIPT_NAME = 'xuanxiang-application-closed-source.json';
const receiptName = APPLICATION_COLD_SOURCE_RECEIPT_NAME;
const fixedPaths = [...BRAND_NAMES.map(names=>names.appMarker), 'catalog.json', 'state.json', 'drafts.json', 'backup-plan.json', 'restore-draft-barrier.json', 'application-restore-drafts.json', 'assets', 'assets/global', 'inbox', 'inbox/database', 'inbox/database/PG_VERSION', 'inbox/snapshots', 'session'] as const;
const decimal = z.string().regex(/^\d+$/);
const versionSchema = z.object({ device: decimal, inode: decimal, size: decimal, mtimeNs: decimal, ctimeNs: decimal, mode: decimal, nlink: decimal }).strict();
const directorySchema = z.object({ path: z.string().refine(safeRelative), identity: rootIdentitySchema }).strict();
const preservedSchema = z.object({ path: z.string().refine(safeRelative), kind: z.enum(['file', 'directory']), reason: z.enum(['unknown', 'application-backups', 'catalog-work-root']), version: versionSchema }).strict();
const inventorySchema = z.object({ files: applicationCandidateBodySchema.shape.files, directories: z.array(directorySchema).max(APPLICATION_BACKUP_LIMITS.directories), missing: z.array(z.enum(fixedPaths)).max(fixedPaths.length), preserved: z.array(preservedSchema).max(APPLICATION_COLD_SOURCE_LIMITS.entries), bytes: z.number().int().nonnegative().max(APPLICATION_BACKUP_LIMITS.bytes) }).strict();
const pointerSchema = z.unknown().transform(value => DataRootManager.parsePointer(value));
export const applicationColdSourceReceiptSchema = z.object({ format: z.literal('xuanxiang-application-closed-source'), schemaVersion: z.literal(1), kind: z.literal('closed-source'), health: z.literal('not-verified'), id: z.uuid(), operationId: z.uuid(), appId: z.uuid(), createdAt: z.iso.datetime(), bootstrap: rootIdentitySchema, source: rootIdentitySchema, sourcePointer: pointerSchema, sourcePointerFile: rootAuthorityFileSchema, parent: rootIdentitySchema, candidateParent: rootIdentitySchema, directory: rootIdentitySchema, data: rootIdentitySchema, sourceInventory: inventorySchema, copyInventory: z.object({ files: applicationCandidateBodySchema.shape.files, directories: z.array(directorySchema).max(APPLICATION_BACKUP_LIMITS.directories) }).strict(), excluded: z.tuple([z.literal('backups'), z.literal('catalog-work-roots'), z.literal('unknown-entries')]), session: z.literal('managed-files-and-empty-directories-copied'), checksum: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export type ApplicationColdSourceReceipt = z.infer<typeof applicationColdSourceReceiptSchema>;
export interface ApplicationColdSourceProof {
    receipt: ApplicationColdSourceReceipt;
    assertCurrent(): void;
}
export interface ApplicationColdSourceHost {
    assertStableLock(): void;
    assertCold(): void;
    assertOwnerImmediately(directory: Readonly<RootIdentity>, operationId: string): void;
}
export interface ApplicationColdSourceInput {
    operationId: string;
    bootstrap: RootIdentity;
    parent: RootIdentity;
    candidateParent: RootIdentity;
}
export interface ApplicationColdSourceExpected {
    operationId: string;
    bootstrap: RootIdentity;
    appId: string;
    source: RootIdentity;
    sourcePointer: RootPointer;
}
export type ApplicationColdSourcePhase = 'before-copy' | 'after-copy' | 'before-receipt' | 'after-receipt';
export interface ApplicationColdSourceOptions {
    signal?: AbortSignal;
    limits?: Partial<Record<'bytes' | 'fileBytes' | 'files' | 'directories' | 'entries' | 'metadataBytes', number>>;
    hook?(phase: ApplicationColdSourcePhase, view: Readonly<{
        source: RootIdentity;
        directory?: RootIdentity;
        data?: RootIdentity;
    }>): void | Promise<void>;
}
export class ApplicationColdSourceError extends Error {
    constructor(readonly code: string) { super(code); this.name = 'ApplicationColdSourceError'; }
}
function fail(code: string): never { throw new ApplicationColdSourceError(code); }
function synchronous(action: () => void, code: string) { try {
    const returned: unknown = action();
    if (returned !== undefined) {
        void Promise.resolve(returned).catch(() => { });
        fail(code);
    }
}
catch {
    fail(code);
} }
function nativeHost(host: ApplicationColdSourceHost, input: ApplicationColdSourceInput, signal?: AbortSignal) { const locked = host.assertStableLock.bind(host), closed = host.assertCold.bind(host), owner = host.assertOwnerImmediately.bind(host), parent = Object.freeze(structuredClone(input.parent)), candidate = Object.freeze(structuredClone(input.candidateParent)); return () => { if (signal?.aborted)
    fail('APPLICATION_COLD_SOURCE_ABORTED'); synchronous(locked, 'APPLICATION_COLD_SOURCE_LOCK_REQUIRED'); synchronous(closed, 'APPLICATION_COLD_SOURCE_NOT_CLOSED'); synchronous(() => owner(parent, input.operationId), 'APPLICATION_COLD_SOURCE_OWNER_EXPIRED'); synchronous(() => owner(candidate, input.operationId), 'APPLICATION_COLD_SOURCE_OWNER_EXPIRED'); for (const root of [input.bootstrap, parent, candidate])
    assertDirectoryImmediately(root); }; }
const limitSchema = z.object(Object.fromEntries(['bytes', 'fileBytes', 'files', 'directories', 'entries', 'metadataBytes'].map(name => [name, z.number().int().positive().max(APPLICATION_COLD_SOURCE_LIMITS[name as keyof typeof APPLICATION_COLD_SOURCE_LIMITS])]))).strict();
function selectedLimits(input: ApplicationColdSourceOptions['limits']) { return limitSchema.parse({ ...Object.fromEntries(['bytes', 'fileBytes', 'files', 'directories', 'entries', 'metadataBytes'].map(name => [name, APPLICATION_COLD_SOURCE_LIMITS[name as keyof typeof APPLICATION_COLD_SOURCE_LIMITS]])), ...input }) as Record<'bytes' | 'fileBytes' | 'files' | 'directories' | 'entries' | 'metadataBytes', number>; }
function version(info: BigIntStats) { return { device: String(info.dev), inode: String(info.ino), size: String(info.size), mtimeNs: String(info.mtimeNs), ctimeNs: String(info.ctimeNs), mode: String(info.mode), nlink: String(info.nlink) }; }
function missing(cause: unknown) { return (cause as NodeJS.ErrnoException)?.code === 'ENOENT'; }
function inventoryContent(files: StoredFile[], directories: {
    path: string;
}[]) { return canonical({ files: files.map(({ path, size, sha256 }) => ({ path, size, sha256 })), directories: directories.map(row => row.path).sort() }); }
function identityImmediately(path: string) { const info = lstatSync(path, { bigint: true }), identity = { path, device: String(info.dev), inode: String(info.ino) }; assertDirectoryImmediately(identity); return identity; }
function createOwnedDirectory(parent: RootIdentity, name: string, guard: () => void) { guard(); assertDirectoryImmediately(parent); if (!safeRelative(name) || name.includes('/'))
    fail('APPLICATION_COLD_SOURCE_UNSAFE'); const path = join(parent.path, name); mkdirSync(path, { mode: 0o700 }); const result = identityImmediately(path); guard(); assertDirectoryImmediately(parent); assertDirectoryImmediately(result); return result; }
function createOwnedTree(root: RootIdentity, paths: readonly string[], guard: () => void) { const result: RootIdentity[] = [], parents = new Map<string, RootIdentity>([['', root]]); for (const path of [...paths].sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))) {
    if (!safeRelative(path))
        fail('APPLICATION_COLD_SOURCE_UNSAFE');
    const parts = path.split('/'), name = parts.pop()!, parent = parents.get(parts.join('/'));
    if (!parent)
        fail('APPLICATION_COLD_SOURCE_UNSAFE');
    const ancestorGuard = () => { guard(); assertDirectoryImmediately(root); for (let depth = 1; depth <= parts.length; depth++) {
        const ancestor = parents.get(parts.slice(0, depth).join('/'));
        if (!ancestor)
            fail('APPLICATION_COLD_SOURCE_UNSAFE');
        assertDirectoryImmediately(ancestor);
    } };
    const identity = createOwnedDirectory(parent, name, ancestorGuard);
    parents.set(path, identity);
    result.push(identity);
} return result; }
const catalogEnvelopeSchema = z.object({ schemaVersion: z.literal(1), revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), value: catalogSchema }).strict();
function parseCatalog(bytes: Buffer) { const catalog = catalogEnvelopeSchema.parse(JSON.parse(bytes.toString('utf8'))); if (catalog.value.some(row => !isAbsolute(row.path)||normalize(row.path)!==row.path||!rootIdentitySchema.safeParse({path:row.path,...row.identity}).success) || new Set(catalog.value.map(row => row.id)).size !== catalog.value.length || new Set(catalog.value.map(row => row.path)).size !== catalog.value.length)
    fail('APPLICATION_COLD_SOURCE_CATALOG_INVALID'); return catalog.value; }
function observeCatalogWorksImmediately(records:ReturnType<typeof parseCatalog>,targets:readonly RootIdentity[],max:number){
 if(records.length>max)fail('APPLICATION_COLD_SOURCE_CAPACITY');const observations:({identity:RootIdentity;available:boolean})[]=[];
 const inspect=(identity:RootIdentity)=>{try{const actual=identityImmediately(identity.path);if(!sameIdentity(actual,identity))fail('APPLICATION_COLD_SOURCE_CATALOG_INVALID');return true}catch(cause){if(missing(cause))return false;fail('APPLICATION_COLD_SOURCE_CATALOG_INVALID')}};
 for(const record of records){const identity=rootIdentitySchema.parse({path:record.path,...record.identity});observations.push({identity,available:inspect(identity)})}
 for(const target of targets){let cursor=target;for(;;){if(observations.some(row=>sameIdentity(row.identity,cursor)))fail('APPLICATION_COLD_SOURCE_TARGET_OVERLAP');const path=dirname(cursor.path);if(path===cursor.path)break;cursor=identityImmediately(path)}}
 return()=>{for(const observation of observations)if(inspect(observation.identity)!==observation.available)fail('APPLICATION_COLD_SOURCE_CHANGED')}
}
function readCatalogImmediately(root: RootIdentity, max: number) { assertDirectoryImmediately(root); const path = join(root.path, 'catalog.json'), before = lstatSync(path, { bigint: true }); if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.size > BigInt(max) || !(before.mode & 292n))
    fail('APPLICATION_COLD_SOURCE_CATALOG_INVALID'); const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW), chunks: Buffer[] = []; let size = 0; try {
    if (canonical(version(fstatSync(fd, { bigint: true }))) !== canonical(version(before)))
        fail('APPLICATION_COLD_SOURCE_CHANGED');
    const buffer = Buffer.alloc(65536);
    for (;;) {
        const count = readSync(fd, buffer, 0, Math.min(buffer.length, max + 1 - size), null);
        if (!count)
            break;
        size += count;
        if (size > max)
            fail('APPLICATION_COLD_SOURCE_CAPACITY');
        chunks.push(Buffer.from(buffer.subarray(0, count)));
    }
    if (canonical(version(fstatSync(fd, { bigint: true }))) !== canonical(version(before)) || canonical(version(lstatSync(path, { bigint: true }))) !== canonical(version(before)))
        fail('APPLICATION_COLD_SOURCE_CHANGED');
}
finally {
    closeSync(fd);
} assertDirectoryImmediately(root); return parseCatalog(Buffer.concat(chunks, size)); }
interface SourceObservationEntry {
    kind: 'file' | 'directory';
    identity?: RootIdentity;
    version: ReturnType<typeof version>;
    names?: string[];
}
/** Capture all managed ownership before yielding. Phase guards remain bounded to
 * the root, authority and semantic files; whole observations close every phase. */
function captureSourceImmediately(root: RootIdentity, guard: () => void, limits: ReturnType<typeof selectedLimits>,targets:readonly RootIdentity[]) {
    guard();
    const records=readCatalogImmediately(root,limits.metadataBytes),works=records.map(row=>row.path),assertWorks=observeCatalogWorksImmediately(records,targets,limits.entries),entries = new Map<string, SourceObservationEntry>(), semantic = [applicationNames(root).appMarker, 'catalog.json', 'drafts.json', 'application-restore-drafts.json'];
    let files = 0, directories = 0, bytes = 0, visited = 0;
    const check = (path: string, row: SourceObservationEntry) => { const current = lstatSync(join(root.path, path), { bigint: true }); if (current.isSymbolicLink() || row.kind === 'file' && !current.isFile() || row.kind === 'directory' && !current.isDirectory() || canonical(version(current)) !== canonical(row.version))
        fail('APPLICATION_COLD_SOURCE_CHANGED'); if (row.identity)
        assertDirectoryImmediately(row.identity); if (row.names && canonical(readdirSync(join(root.path, path)).sort()) !== canonical(row.names))
        fail('APPLICATION_COLD_SOURCE_CHANGED'); };
    function walk(path: string) {
        const absolute = join(root.path, path), info = lstatSync(absolute, { bigint: true });
        if (!info.isDirectory() || info.isSymbolicLink() || !(info.mode & 292n) || !(info.mode & 73n))
            fail('APPLICATION_COLD_SOURCE_UNREADABLE');
        const names = readdirSync(absolute).sort(), identity = identityImmediately(absolute), row = { kind: 'directory' as const, identity, version: version(info), names };
        entries.set(path, row);
        for (const name of names) {
            if (++visited > limits.entries)
                fail('APPLICATION_COLD_SOURCE_CAPACITY');
            const child = path ? path + '/' + name : name;
            if (!safeRelative(child))
                fail('APPLICATION_COLD_SOURCE_UNSAFE');
            const childPath = join(root.path, child), stat = lstatSync(childPath, { bigint: true });
            if (stat.isSymbolicLink() || !stat.isFile() && !stat.isDirectory() || stat.isFile() && stat.nlink !== 1n)
                fail('APPLICATION_COLD_SOURCE_UNSAFE');
            if (BRAND_NAMES.some(names=>child === 'inbox/'+names.lock) || child === 'inbox/database/postmaster.pid')
                fail('APPLICATION_COLD_SOURCE_NOT_CLOSED');
            if (child === 'backups' || works.some(work => within(childPath, work)) || !ownedRootFile(child) && !ownedRootDirectory(child)) {
                entries.set(child, { kind: stat.isDirectory() ? 'directory' : 'file', version: version(stat) });
                continue;
            }
            if (ownedRootDirectory(child)) {
                if (!stat.isDirectory())
                    fail('APPLICATION_COLD_SOURCE_UNSAFE');
                if (++directories > limits.directories)
                    fail('APPLICATION_COLD_SOURCE_CAPACITY');
                walk(child);
            }
            else {
                if (!stat.isFile() || !(stat.mode & 292n))
                    fail('APPLICATION_COLD_SOURCE_UNREADABLE');
                if (stat.size > BigInt(limits.fileBytes) || ++files > limits.files)
                    fail('APPLICATION_COLD_SOURCE_CAPACITY');
                bytes += Number(stat.size);
                if (bytes > limits.bytes)
                    fail('APPLICATION_COLD_SOURCE_CAPACITY');
                entries.set(child, { kind: 'file', version: version(stat) });
            }
        }
        check(path, row);
    }
    walk('');
    guard();
    const assertCurrent = () => { guard();assertWorks(); for (const [path, row] of entries)
        check(path, row); }, assertSemantics = () => { guard(); for (const path of semantic) {
        const row = entries.get(path);
        if (row)
            check(path, row);
        else
            try {
                lstatSync(join(root.path, path));
                fail('APPLICATION_COLD_SOURCE_CHANGED');
            }
            catch (cause) {
                if (!missing(cause))
                    throw cause;
            }
    } };
    assertCurrent();
    return { works, assertCurrent, assertSemantics };
}
function assertInventoryImmediately(root: RootIdentity, inventory: ApplicationColdSourceReceipt['sourceInventory']) {
    assertDirectoryImmediately(root);
    const members = new Map<string, string[]>([['', []]]);
    for (const row of inventory.directories) {
        assertDirectoryImmediately(row.identity);
        if (row.identity.path !== join(root.path, row.path))
            fail('APPLICATION_COLD_SOURCE_CHANGED');
        members.set(row.path, []);
    }
    const add = (path: string) => { const parts = path.split('/'), leaf = parts.pop()!, parent = parts.join('/'), names = members.get(parent); if (!names)
        fail('APPLICATION_COLD_SOURCE_CHANGED'); names.push(leaf); };
    for (const row of inventory.directories)
        add(row.path);
    for (const file of inventory.files) {
        assertFileImmediately(root, file.path, { ...file.identity, ...file.revision });
        add(file.path);
    }
    for (const row of inventory.preserved) {
        const info = lstatSync(join(root.path, row.path), { bigint: true });
        if (info.isSymbolicLink() || row.kind === 'file' && !info.isFile() || row.kind === 'directory' && !info.isDirectory() || canonical(version(info)) !== canonical(row.version))
            fail('APPLICATION_COLD_SOURCE_CHANGED');
        add(row.path);
    }
    for (const path of inventory.missing) {
        try {
            lstatSync(join(root.path, path));
            fail('APPLICATION_COLD_SOURCE_CHANGED');
        }
        catch (cause) {
            if (!missing(cause))
                throw cause;
        }
    }
    for (const [path, names] of members)
        if (canonical(readdirSync(join(root.path, path)).sort()) !== canonical(names.sort()))
            fail('APPLICATION_COLD_SOURCE_CHANGED');
}
async function inspectSource(root: RootIdentity, guard: () => void, limits: ReturnType<typeof selectedLimits>, works: readonly string[]): Promise<ApplicationColdSourceReceipt['sourceInventory']> {
    const inventory = await collectClosedRootFiles(root, guard, { includeApplicationBackups: false });
    if (inventory.files.length > limits.files || inventory.directories.length > limits.directories || inventory.files.length + inventory.directories.length + inventory.preserved.length > limits.entries || inventory.bytes > limits.bytes)
        fail('APPLICATION_COLD_SOURCE_CAPACITY');
    const directories = await Promise.all(inventory.directories.map(async (path) => ({ path, identity: await directoryIdentity(await managedPath(root, path)) }))), files: StoredFile[] = [], preserved: ApplicationColdSourceReceipt['sourceInventory']['preserved'] = [], absent: ApplicationColdSourceReceipt['sourceInventory']['missing'] = [];
    let bytes = 0;
    for (const path of inventory.preserved) {
        guard();
        if (!safeRelative(path))
            fail('APPLICATION_COLD_SOURCE_UNSAFE');
        const info = await lstat(await managedPath(root, path), { bigint: true });
        if (info.isSymbolicLink() || !info.isFile() && !info.isDirectory() || info.isFile() && info.nlink !== 1n)
            fail('APPLICATION_COLD_SOURCE_UNSAFE');
        preserved.push({ path, kind: info.isFile() ? 'file' : 'directory', reason: path === 'backups' ? 'application-backups' : works.some(work => within(join(root.path, path), work)) ? 'catalog-work-root' : 'unknown', version: version(info) });
    }
    for (const path of inventory.files) {
        guard();
        const absolute = await managedPath(root, path), info = await lstat(absolute, { bigint: true });
        if (info.size > BigInt(limits.fileBytes))
            fail('APPLICATION_COLD_SOURCE_CAPACITY');
        if (!(info.mode & 292n))
            fail('APPLICATION_COLD_SOURCE_UNREADABLE');
        const hashed = await hashRegular(absolute, () => { guard(); for (const row of directories)
            if (within(absolute, row.identity.path))
                assertDirectoryImmediately(row.identity); const current = lstatSync(absolute, { bigint: true }); if (current.size > BigInt(limits.fileBytes))
            fail('APPLICATION_COLD_SOURCE_CAPACITY'); });
        bytes += hashed.size;
        if (bytes > limits.bytes)
            fail('APPLICATION_COLD_SOURCE_CAPACITY');
        files.push({ path, ...hashed });
    }
    for (const path of fixedPaths) {
        guard();
        try {
            await lstat(join(root.path, path));
        }
        catch (cause) {
            if (!missing(cause))
                throw cause;
            absent.push(path);
        }
    }
    const result = inventorySchema.parse({ files, directories, missing: absent, preserved, bytes });
    guard();
    assertInventoryImmediately(root, result);
    return result;
}
async function readSourceSemantics(root: RootIdentity, appId: string, guard: () => void) {
    guard();
    const marker = rootMarkerSchema.parse(JSON.parse((await readBoundedBytes(root, applicationNames(root).appMarker, 16384, guard)).toString('utf8')));
    if (marker.id !== appId || marker.phase !== 'ready' || !marker.inboxReady)
        fail('APPLICATION_COLD_SOURCE_APP_MISMATCH');
    const works = parseCatalog(await readBoundedBytes(root, 'catalog.json', APPLICATION_BACKUP_LIMITS.metadataBytes, guard)).map(row=>row.path);
    try {
        await readBoundedBytes(root, 'drafts.json', APPLICATION_DRAFT_RETENTION_LIMITS.bytes + 65536, guard);
        await new DraftJournal(root.path).read();
    }
    catch (cause) {
        if (!missing(cause))
            throw cause;
    }
    try {
        const retention = applicationDraftRetentionSchema.parse(JSON.parse((await readBoundedBytes(root, 'application-restore-drafts.json', APPLICATION_DRAFT_RETENTION_LIMITS.bytes, guard)).toString('utf8'))), { checksum, ...body } = retention;
        if (retention.appId !== appId || digest(canonical(body)) !== checksum || new Set(retention.snapshots.map(row => row.id)).size !== retention.snapshots.length)
            fail('APPLICATION_COLD_SOURCE_DRAFT_INVALID');
        for (const row of retention.snapshots)
            validateDraftSnapshot(row.snapshot);
    }
    catch (cause) {
        if (!missing(cause))
            throw cause;
    }
    guard();
    return works;
}
interface IssuedSource {
    fingerprint: string;
    expected: ApplicationColdSourceExpected;
    assertCurrent(): void;
    assertSourceCurrent(): void;
}
const issuedSources = new WeakMap<ApplicationColdSourceProof, IssuedSource>();
/** Raw closed bytes only. This helper never opens an engine, validates a schema,
 * repairs/deletes a source or grants a pointer change. */
export async function preserveClosedApplicationSource(input: ApplicationColdSourceInput, host: ApplicationColdSourceHost, options: ApplicationColdSourceOptions = {}): Promise<ApplicationColdSourceProof> {
    try {
        const selected = z.object({ operationId: z.uuid(), bootstrap: rootIdentitySchema, parent: rootIdentitySchema, candidateParent: rootIdentitySchema }).strict().parse(input), limits = selectedLimits(options.limits), native = nativeHost(host, selected, options.signal);
        native();
        const context = readRootAuthority(selected.bootstrap, native), root = Object.freeze(structuredClone(context.pointer.root)), appId = context.pointer.rootId;
        const physicalGuard = () => { native(); assertDirectoryImmediately(root); }, authorityGuard = () => { physicalGuard(); context.assertCurrent(); };
        authorityGuard();
        const overlaps = (a: string, b: string) => within(a, b) || within(b, a);
        if (overlaps(selected.parent.path, selected.candidateParent.path) || [root, selected.bootstrap].some(other => overlaps(selected.parent.path, other.path) || overlaps(selected.candidateParent.path, other.path)))
            fail('APPLICATION_COLD_SOURCE_TARGET_OVERLAP');
        const observations = captureSourceImmediately(root, physicalGuard, limits,[selected.parent,selected.candidateParent]), guard = () => { authorityGuard(); observations.assertSemantics(); };
        guard();
        if ((await readdir(selected.parent.path)).length || (await readdir(selected.candidateParent.path)).length)
            fail('APPLICATION_COLD_SOURCE_TARGET_NOT_EMPTY');
        const works = await readSourceSemantics(root, appId, guard);
        observations.assertCurrent();
        if (canonical(works) !== canonical(observations.works))
            fail('APPLICATION_COLD_SOURCE_CHANGED');
        if (works.some(work => overlaps(work, selected.parent.path) || overlaps(work, selected.candidateParent.path)))
            fail('APPLICATION_COLD_SOURCE_TARGET_OVERLAP');
        const before = await inspectSource(root, guard, limits, works);
        observations.assertCurrent();
        assertInventoryImmediately(root, before);
        if ((await readdir(selected.parent.path)).length || (await readdir(selected.candidateParent.path)).length)
            fail('APPLICATION_COLD_SOURCE_TARGET_NOT_EMPTY');
        observations.assertCurrent();
        const id = randomUUID(), directory = createOwnedDirectory(selected.parent, id, guard), data = createOwnedDirectory(directory, 'data', guard);
        const targetGuard = () => { guard(); assertDirectoryImmediately(directory); assertDirectoryImmediately(data); }, view = Object.freeze({ source: root, directory: Object.freeze(structuredClone(directory)), data: Object.freeze(structuredClone(data)) });
        await options.hook?.('before-copy', view);
        targetGuard();
        assertInventoryImmediately(root, before);
        const targetDirectories = createOwnedTree(data, before.directories.map(row => row.path), targetGuard), copied: StoredFile[] = [];
        for (const file of before.files) {
            const result = await copyFile(root, data, file.path, targetGuard, before.directories.map(row => row.identity), targetDirectories);
            if (result.size !== file.size || result.sha256 !== file.sha256)
                fail('APPLICATION_COLD_SOURCE_CHANGED');
            assertFileImmediately(root, file.path, { ...file.identity, ...file.revision });
            copied.push(result);
        }
        const tree: StoredTree = { files: copied, directories: targetDirectories }, copyDirectories = before.directories.map(row => ({ path: row.path, identity: targetDirectories.find(target => target.path === join(data.path, row.path))! }));
        await options.hook?.('after-copy', view);
        targetGuard();
        assertInventoryImmediately(root, before);
        assertTreeImmediately(data, tree);
        const after = await inspectSource(root, guard, limits, works);
        observations.assertCurrent();
        if (canonical(after) !== canonical(before) || inventoryContent(copied, copyDirectories) !== inventoryContent(before.files, before.directories))
            fail('APPLICATION_COLD_SOURCE_CHANGED');
        for (const target of [...targetDirectories].sort((a, b) => b.path.length - a.path.length))
            await syncDirectory(target.path);
        await syncDirectory(data.path);
        targetGuard();
        assertInventoryImmediately(root, before);
        assertTreeImmediately(data, tree);
        const body = { format: 'xuanxiang-application-closed-source' as const, schemaVersion: 1 as const, kind: 'closed-source' as const, health: 'not-verified' as const, id, operationId: selected.operationId, appId, createdAt: new Date().toISOString(), bootstrap: selected.bootstrap, source: root, sourcePointer: context.pointer, sourcePointerFile: context.pointerFile, parent: selected.parent, candidateParent: selected.candidateParent, directory, data, sourceInventory: before, copyInventory: { files: copied, directories: copyDirectories }, excluded: ['backups', 'catalog-work-roots', 'unknown-entries'] as const, session: 'managed-files-and-empty-directories-copied' as const }, receipt = applicationColdSourceReceiptSchema.parse({ ...body, checksum: digest(canonical(body)) }), encoded = JSON.stringify(receipt);
        if (Buffer.byteLength(encoded) > limits.metadataBytes)
            fail('APPLICATION_COLD_SOURCE_CAPACITY');
        const exactContainer = (extra: readonly string[] = []) => { assertDirectoryImmediately(directory); if (canonical(readdirSync(directory.path).sort()) !== canonical(['data', ...extra].sort()) || canonical(readdirSync(selected.parent.path)) !== canonical([id]))
            fail('APPLICATION_COLD_SOURCE_COPY_CHANGED'); };
        await options.hook?.('before-receipt', view);
        targetGuard();
        assertInventoryImmediately(root, before);
        assertTreeImmediately(data, tree);
        exactContainer();
        await writeApplicationMetadata(directory, receiptName, encoded, { beforeRename: () => { targetGuard(); assertInventoryImmediately(root, before); assertTreeImmediately(data, tree); }, immediately: temporary => { targetGuard(); assertInventoryImmediately(root, before); assertTreeImmediately(data, tree); exactContainer([temporary]); } });
        const verifiedBytes = await readBoundedBytes(directory, receiptName, limits.metadataBytes, targetGuard);
        if (!verifiedBytes.equals(Buffer.from(encoded)))
            fail('APPLICATION_COLD_SOURCE_RECEIPT_CHANGED');
        const receiptFile = await hashRegular(join(directory.path, receiptName), targetGuard);
        if (receiptFile.sha256 !== digest(encoded))
            fail('APPLICATION_COLD_SOURCE_RECEIPT_CHANGED');
        await syncDirectory(selected.parent.path);
        await options.hook?.('after-receipt', view);
        const sourceSeal = () => { native(); observations.assertCurrent(); assertInventoryImmediately(root, before); assertTreeImmediately(data, tree); assertFileImmediately(directory, receiptName, { ...receiptFile.identity, ...receiptFile.revision }); exactContainer([receiptName]); };
        const assertSourceCurrent = () => { try {
            sourceSeal();
        }
        catch (cause) {
            if (cause instanceof ApplicationColdSourceError)
                throw cause;
            fail('APPLICATION_COLD_SOURCE_CHANGED');
        } }, assertCurrent = () => { assertSourceCurrent(); context.assertCurrent(); };
        assertCurrent();
        const proof = { receipt: structuredClone(receipt), assertCurrent };
        issuedSources.set(proof, { fingerprint: digest(canonical(receipt)), expected: { operationId: selected.operationId, bootstrap: selected.bootstrap, appId, source: root, sourcePointer: context.pointer }, assertCurrent, assertSourceCurrent });
        return proof;
    }
    catch (cause) {
        if (cause instanceof ApplicationColdSourceError)
            throw cause;
        fail('APPLICATION_COLD_SOURCE_FAILED');
    }
}
/** A receipt JSON is data only. Callers must match the exact original pointer
 * from fresh authority; after their own CAS they use the source-only seal while
 * their activation authority context protects the new pointer and own receipt. */
export function validateApplicationColdSourceProof(proof: ApplicationColdSourceProof, expected: ApplicationColdSourceExpected) {
    try {
        const issued = issuedSources.get(proof);
        if (!issued)
            fail('APPLICATION_COLD_SOURCE_PROOF_INVALID');
        const selected = z.object({ operationId: z.uuid(), bootstrap: rootIdentitySchema, appId: z.uuid(), source: rootIdentitySchema, sourcePointer: pointerSchema }).strict().parse(expected);
        if (canonical(selected) !== canonical(issued.expected) || digest(canonical(proof.receipt)) !== issued.fingerprint)
            fail('APPLICATION_COLD_SOURCE_PROOF_INVALID');
        issued.assertCurrent();
        return { receipt: structuredClone(proof.receipt), assertCurrent: issued.assertCurrent, assertSourceCurrent: issued.assertSourceCurrent };
    }
    catch (cause) {
        if (cause instanceof ApplicationColdSourceError)
            throw cause;
        fail('APPLICATION_COLD_SOURCE_PROOF_INVALID');
    }
}
