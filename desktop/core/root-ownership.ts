import { constants } from 'node:fs';
import { lstat, open, realpath, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { z } from 'zod';
import type { RootIdentity } from './data-root';
import {BRAND_NAMES} from '../shared/brand-names';
export const rootIdentitySchema = z.object({ path: z.string().min(1).max(4096), device: z.string().regex(/^\d+$/), inode: z.string().regex(/^\d+$/) }).strict();
export const rootMarkerSchema = z.object({ schemaVersion: z.literal(1), app: z.enum(['Xuanxiangxiezuo-Desktop','XaanInk']), id: z.uuid(), phase: z.enum(['initializing', 'ready']), inboxReady: z.boolean() }).strict();
export interface FileIdentity {
    device: string;
    inode: string;
}
export function sameIdentity(a: FileIdentity, b: FileIdentity) { return a.device === b.device && a.inode === b.inode; }
export async function directoryIdentity(path: string): Promise<RootIdentity> {
    const s = await lstat(path, { bigint: true });
    if (!s.isDirectory() || s.isSymbolicLink() || !isAbsolute(path) || await realpath(path) !== path)
        throw Error('unsafe directory');
    return { path, device: String(s.dev), inode: String(s.ino) };
}
export async function assertDirectory(expected: RootIdentity) {
    if (!sameIdentity(await directoryIdentity(expected.path), expected))
        throw Error('changed directory');
}
export function safeRelative(path: string) { return path.length > 0 && path.length <= 1024 && !isAbsolute(path) && !path.includes('\\') && path.split('/').every(s => s !== '' && s !== '.' && s !== '..' && !s.includes(':') && !/[\x00-\x1f]/.test(s)); }
export function allowedManagedFile(path: string):boolean {
    if (!safeRelative(path))
        return false;
    const packagePath=/^backups\/application\/packages\/([^/]+)\/(.+)$/.exec(path);
    if(packagePath){
        if(!z.uuid().safeParse(packagePath[1]).success)return false;
        const inner=packagePath[2];
        return inner==='xuanxiang-app-backup.json'||inner.startsWith('data/')&&!inner.slice(5).startsWith('backups/')&&allowedManagedFile(inner.slice(5));
    }
    if ([...BRAND_NAMES.map(names=>names.appMarker), 'catalog.json', 'state.json', 'drafts.json', 'backup-plan.json', 'restore-draft-barrier.json', 'application-restore-drafts.json'].includes(path))
        return true;
    const recoveryNames=BRAND_NAMES.find(names=>path.startsWith(names.rootRecoveryPrefix)&&path.endsWith('.json'));
    if (recoveryNames)
        return z.uuid().safeParse(path.slice(recoveryNames.rootRecoveryPrefix.length, -5)).success;
    if (/^assets\/global\/[0-9a-f-]{36}\.png$/i.test(path))
        return z.uuid().safeParse(path.split('/')[2].slice(0, -4)).success;
    const snapshot=/^inbox\/snapshots\/before-upgrade-\d{13}-([0-9a-f-]{36})\.tar\.gz(?:\.json)?$/i.exec(path);
    if(snapshot)return z.uuid().safeParse(snapshot[1]).success;
    return (path.startsWith('inbox/database/') || path.startsWith('session/')) && !path.split('/').some(s => BRAND_NAMES.some(names=>s===names.workManifest||s===names.lock));
}
/** A second boundary; the trusted host still enumerates exact engine-owned paths. */
export function allowedManagedDirectory(path:string):boolean{
    if(!safeRelative(path))return false;
    if(['backups','backups/application','backups/application/packages','backups/application/staging','backups/application/validation'].includes(path))return true;
    const packagePath=/^backups\/application\/packages\/([^/]+)(?:\/(.+))?$/.exec(path);
    if(packagePath){
        if(!z.uuid().safeParse(packagePath[1]).success)return false;
        const inner=packagePath[2];
        return !inner||inner==='data'||inner.startsWith('data/')&&inner.slice(5)!=='backups'&&!inner.slice(5).startsWith('backups/')&&allowedManagedDirectory(inner.slice(5));
    }
    return safeRelative(path)&&(['inbox','inbox/database','inbox/snapshots','assets','assets/global','session'].includes(path)||path.startsWith('inbox/database/')||path.startsWith('session/'))&&!path.split('/').some(s=>BRAND_NAMES.some(names=>s===names.workManifest||s===names.lock));
}
export function within(path: string, parent: string) { const r = relative(parent, path); return r === '' || (!r.startsWith('..' + sep) && r !== '..' && !isAbsolute(r)); }
/** Every component is checked; a regular leaf alone does not authorize a symlink parent. */
export async function managedPath(root: RootIdentity, path: string) {
    if (!safeRelative(path))
        throw Error('invalid relative path');
    await assertDirectory(root);
    let cursor = root.path;
    const parts = path.split('/');
    for (const part of parts.slice(0, -1)) {
        cursor = join(cursor, part);
        const info = await lstat(cursor);
        if (!info.isDirectory() || info.isSymbolicLink())
            throw Error('unsafe parent');
    }
    return join(root.path, ...parts);
}
export async function regularIdentity(path: string): Promise<FileIdentity> {
    const info = await lstat(path, { bigint: true });
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1n)
        throw Error('unsafe file');
    return { device: String(info.dev), inode: String(info.ino) };
}
export async function hashRegular(path: string, guard: () => void | Promise<void> = () => { }) {
    const expected = await regularIdentity(path);
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
        const before = await handle.stat({ bigint: true });
        if (!sameIdentity(expected, { device: String(before.dev), inode: String(before.ino) }))
            throw Error('changed file');
        const hash = createHash('sha256'), buffer = Buffer.alloc(1024 * 1024);
        let size = 0;
        for (;;) {
            await guard();
            const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
            if (!bytesRead)
                break;
            size += bytesRead;
            hash.update(buffer.subarray(0, bytesRead));
        }
        const after = await handle.stat({ bigint: true });
        if (before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs || !sameIdentity(expected, await regularIdentity(path)))
            throw Error('changed file');
    return { identity: expected, size, sha256: hash.digest('hex'),revision:{size:String(after.size),mtimeNs:String(after.mtimeNs),ctimeNs:String(after.ctimeNs)} };
    }
    finally {
        await handle.close();
    }
}
export async function readMetadata(path: string, maxBytes = 16 * 1024 * 1024) {
    const id = await regularIdentity(path), handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
        const s = await handle.stat({ bigint: true });
        if (String(s.dev) !== id.device || String(s.ino) !== id.inode || s.size > BigInt(maxBytes))
            throw Error('unsafe metadata');
        const chunks: Buffer[] = [], buffer = Buffer.alloc(Math.min(1024 * 1024, maxBytes + 1));
        let total = 0;
        for (;;) {
            const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, maxBytes + 1 - total), null);
            if (!bytesRead)
                break;
            total += bytesRead;
            if (total > maxBytes)
                throw Error('oversized metadata');
            chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
        }
        const after = await handle.stat({ bigint: true });
        if (s.size !== after.size || s.mtimeNs !== after.mtimeNs || s.ctimeNs !== after.ctimeNs || !sameIdentity(id, await regularIdentity(path)))
            throw Error('changed metadata');
        return JSON.parse(Buffer.concat(chunks, total).toString('utf8'));
    }
    finally {
        await handle.close();
    }
}
export async function syncDirectory(path: string) {
    if (process.platform === 'win32')
        return;
    const h = await open(path, 'r');
    try {
        await h.sync();
    }
    finally {
        await h.close();
    }
}
export async function overlapping(a: RootIdentity, b: RootIdentity) {
    if (within(a.path, b.path) || within(b.path, a.path))
        return true;
    for (const [child, parent] of [[a, b], [b, a]]) {
        let p = child.path;
        for (;;) {
            if (sameIdentity(await directoryIdentity(p), parent))
                return true;
            const next = dirname(p);
            if (next === p)
                break;
            p = next;
        }
    }
    return false;
}
