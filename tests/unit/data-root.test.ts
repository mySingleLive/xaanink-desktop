import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, readdir, stat, realpath, rename, symlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { DataRootManager, RootMigrationCrash, RootMigrationError, type RootPointer, type RootOptions, type MigrationHost, type RootIdentity } from '../../desktop/core/data-root';
async function proof(path: string): Promise<RootIdentity> { const s = await stat(path, { bigint: true }); return { path, device: String(s.dev), inode: String(s.ino) }; }
async function fixture(options: RootOptions = {}) {
    const base = await realpath(await mkdtemp(join(tmpdir(), 'xuanxiang-migrate-'))), source = join(base, 'old'), target = join(base, 'new'), bootstrap = join(base, 'boot'), work = join(base, 'work');
    for (const p of [source, target, bootstrap, work])
        await mkdir(p);
    const id = randomUUID(), pointer: RootPointer = { schemaVersion: 1, revision: 1, rootId: id, migrationId: null, root: await proof(source) };
    await mkdir(join(source, 'inbox', 'database'), { recursive: true });
    await mkdir(join(source, 'session'));
    await writeFile(join(source, 'xuanxiang-app.json'), JSON.stringify({ schemaVersion: 1, app: 'Xuanxiangxiezuo-Desktop', id, phase: 'ready', inboxReady: true }));
    await writeFile(join(source, 'catalog.json'), JSON.stringify({ schemaVersion: 1, revision: 1, value: [{ path: work }] }));
    await writeFile(join(source, 'state.json'), '用户配置和已加密凭据');
    await writeFile(join(source, 'drafts.json'), '未批准草稿');
    await writeFile(join(source, 'inbox', 'database', 'PG_VERSION'), '17');
    await writeFile(join(source, 'session', 'Preferences'), '缓存');
    await writeFile(join(source, 'unknown.txt'), '用户未知文件');
    await writeFile(join(source, 'session', 'unknown.txt'), '缓存目录内用户文件');
    await writeFile(join(work, 'chapter.md'), '作品保持原位');
    await writeFile(join(bootstrap, 'data-root.json'), JSON.stringify(pointer));
    const owned = ['xuanxiang-app.json', 'catalog.json', 'state.json', 'drafts.json', 'inbox/database/PG_VERSION', 'session/Preferences'];
    let closed = true, releases: string[] = [], calls = 0;
    const host: MigrationHost = { async quiesce() {
            calls++;
            return { source: await proof(source), ownedFiles: owned, assertClosed() {
                    if (!closed)
                        throw new RootMigrationError('SOURCE_NOT_CLOSED');
                }, release(outcome) { releases.push(outcome); } };
        } };
    return { base, source, target, bootstrap, work, pointer, owned, host, manager: new DataRootManager(bootstrap, source, options), setClosed(v: boolean) { closed = v; }, get releases() { return releases; }, get calls() { return calls; }, async close() { await rm(base, { recursive: true, force: true }); } };
}
const code = (name: string) => (e: unknown) => e instanceof RootMigrationError && e.code === name;
test('ROOT09-01 absent bootstrap returns explicit initialization intent without creating a root', async () => {
    const base = await realpath(await mkdtemp(join(tmpdir(), 'xuanxiang-bootstrap-')));
    try {
        const path = join(base, 'absent');
        assert.deepEqual(await new DataRootManager(base, path).resolve(), { state: 'needs-initialize', path });
        assert.deepEqual(await readdir(base), []);
    }
    finally {
        await rm(base, { recursive: true, force: true });
    }
});
test('ROOT09-02 adopted ready root persists a validated identity; unknown populated root is preserved', async () => {
    const f = await fixture();
    try {
        await rm(join(f.bootstrap, 'data-root.json'));
        const p = await f.manager.adopt(await proof(f.source));
        assert.equal(p.revision, 1);
        assert.equal(p.rootId, f.pointer.rootId);
        assert.equal((await f.manager.resolve()).state, 'existing');
        await rm(join(f.bootstrap, 'data-root.json'));
        await assert.rejects(f.manager.adopt(await proof(f.target)), code('ROOT_MARKER_INVALID'));
        assert.deepEqual(await readdir(f.target), []);
    }
    finally {
        await f.close();
    }
});
test('ROOT09-03 pointed root missing never falls back or initializes the old/default path', async () => {
    const f = await fixture();
    try {
        await rename(f.source, f.source + '-lost');
        await assert.rejects(f.manager.resolve(), code('ROOT_UNAVAILABLE'));
        assert.ok((await readdir(f.base)).includes('old-lost'));
        assert.equal((await readdir(f.base)).includes('old'), false);
    }
    finally {
        await f.close();
    }
});
test('ROOT09-04 replaced root or pointer symlink blocks before any file mutation', async () => {
    const f = await fixture();
    try {
        await rename(f.source, f.source + '-real');
        await mkdir(f.source);
        await assert.rejects(f.manager.resolve(), code('ROOT_UNAVAILABLE'));
        await rm(join(f.bootstrap, 'data-root.json'));
        await writeFile(join(f.base, 'foreign-pointer'), JSON.stringify(f.pointer));
        await symlink(join(f.base, 'foreign-pointer'), join(f.bootstrap, 'data-root.json'));
        await assert.rejects(f.manager.resolve(), code('METADATA_UNSAFE'));
        assert.equal(await readFile(join(f.base, 'foreign-pointer'), 'utf8'), JSON.stringify(f.pointer));
    }
    finally {
        await f.close();
    }
});
test('ROOT09-05 full migration verifies managed bytes, preserves unknown files and every work directory', async () => {
    const f = await fixture();
    try {
        const result = await f.manager.migrate(await proof(f.target), f.host);
        assert.equal(result.status, 'complete');
        assert.equal(result.root.root.path, f.target);
        for (const p of f.owned) {
            assert.ok((await readFile(join(f.target, p))).length);
            await assert.rejects(readFile(join(f.source, p)), { code: 'ENOENT' });
        }
        assert.equal(await readFile(join(f.source, 'unknown.txt'), 'utf8'), '用户未知文件');
        assert.equal(await readFile(join(f.source, 'session', 'unknown.txt'), 'utf8'), '缓存目录内用户文件');
        assert.equal(await readFile(join(f.work, 'chapter.md'), 'utf8'), '作品保持原位');
        assert.equal(JSON.parse(await readFile(join(f.target, 'catalog.json'), 'utf8')).value[0].path, f.work);
        assert.equal((await f.manager.resolve()).state, 'existing');
        assert.deepEqual(f.releases, ['new-root']);
        assert.equal(JSON.parse(await readFile(join(f.target, `.xuanxiang-root-recovery-${result.migrationId}.json`), 'utf8')).migrationId, result.migrationId);
    }
    finally {
        await f.close();
    }
});
test('ROOT09-06 same root, nested target, nonempty target and insufficient disk reject before quiescing', async () => {
    for (const kind of ['same', 'nested', 'nonempty', 'space']) {
        const f = await fixture({ availableBytes: async () => kind === 'space' ? 0 : 1e9 });
        try {
            let target = f.target;
            if (kind === 'same')
                target = f.source;
            if (kind === 'nested') {
                target = join(f.source, 'child');
                await mkdir(target);
            }
            if (kind === 'nonempty')
                await writeFile(join(target, 'user.txt'), '保留');
            await assert.rejects(f.manager.migrate(await proof(target), f.host), code(kind === 'same' || kind === 'nested' ? 'ROOT_OVERLAP' : kind === 'nonempty' ? 'TARGET_NOT_EMPTY' : 'INSUFFICIENT_SPACE'));
            assert.equal(f.calls, 0);
            assert.deepEqual(JSON.parse(await readFile(join(f.bootstrap, 'data-root.json'), 'utf8')), f.pointer);
        }
        finally {
            await f.close();
        }
    }
});
test('ROOT09-07 live source assertion aborts before copying and never acknowledges a new root', async () => {
    const f = await fixture();
    try {
        f.setClosed(false);
        await assert.rejects(f.manager.migrate(await proof(f.target), f.host), code('SOURCE_NOT_CLOSED'));
        assert.deepEqual(await readdir(f.target), []);
        assert.deepEqual(JSON.parse(await readFile(join(f.bootstrap, 'data-root.json'), 'utf8')), f.pointer);
        assert.deepEqual(f.releases, ['old-root']);
    }
    finally {
        await f.close();
    }
});
test('ROOT09-08 symlink ancestor, nonallowlisted ownership, and catalog work subtrees cannot be copied', async () => {
    for (const kind of ['link', 'unknown', 'work']) {
        const f = await fixture();
        try {
            if (kind === 'link') {
                await rm(join(f.source, 'inbox'), { recursive: true });
                await symlink(f.work, join(f.source, 'inbox'));
            }
            if (kind === 'unknown')
                f.owned.push('unknown.txt');
            if (kind === 'work') {
                await mkdir(join(f.source, 'session', 'work'));
                await writeFile(join(f.source, 'session', 'work', 'file'), '作品');
                await writeFile(join(f.source, 'catalog.json'), JSON.stringify({ schemaVersion: 1, revision: 1, value: [{ path: join(f.source, 'session', 'work') }] }));
                f.owned.push('session/work/file');
            }
            await assert.rejects(f.manager.migrate(await proof(f.target), f.host), code(kind === 'link' ? 'SOURCE_UNSAFE' : kind === 'unknown' ? 'OWNERSHIP_INVALID' : 'WORK_PATH_PROTECTED'));
            assert.deepEqual(JSON.parse(await readFile(join(f.bootstrap, 'data-root.json'), 'utf8')), f.pointer);
            assert.equal(await readFile(join(f.work, 'chapter.md'), 'utf8'), '作品保持原位');
        }
        finally {
            await f.close();
        }
    }
});
test('ROOT09-09 cancellation before commit rolls back only its managed target bytes', async () => {
    const controller = new AbortController(), f = await fixture({ hook: phase => {
            if (phase === 'file-copied')
                controller.abort();
        } });
    try {
        await assert.rejects(f.manager.migrate(await proof(f.target), f.host, controller.signal), code('MIGRATION_CANCELLED'));
        assert.deepEqual(JSON.parse(await readFile(join(f.bootstrap, 'data-root.json'), 'utf8')), f.pointer);
        assert.equal(await readFile(join(f.source, 'drafts.json'), 'utf8'), '未批准草稿');
        assert.deepEqual(await readdir(f.target), []);
        assert.deepEqual(f.releases, ['old-root']);
    }
    finally {
        await f.close();
    }
});
test('ROOT09-10 crash after verified copy recovers old authority without activating a second root', async () => {
    const f = await fixture({ hook: phase => {
            if (phase === 'verified')
                throw new RootMigrationCrash('isolated process loss');
        } });
    try {
        await assert.rejects(f.manager.migrate(await proof(f.target), f.host), RootMigrationCrash);
        const m = new DataRootManager(f.bootstrap, f.source);
        const r = await m.recover(f.host);
        assert.equal(r?.status, 'rolled-back');
        assert.deepEqual(await readdir(f.target), []);
        assert.deepEqual((await m.resolve()), { state: 'existing', pointer: f.pointer });
        assert.equal(await m.recover(f.host), null);
    }
    finally {
        await f.close();
    }
});
test('ROOT09-11 crash after atomic pointer uses new authority and resumes cleanup exactly once', async () => {
    const f = await fixture({ hook: phase => {
            if (phase === 'committed')
                throw new RootMigrationCrash('isolated process loss');
        } });
    try {
        await assert.rejects(f.manager.migrate(await proof(f.target), f.host), RootMigrationCrash);
        const m = new DataRootManager(f.bootstrap, f.source);
        assert.equal((await m.resolve()).state, 'existing');
        const r = await m.recover(f.host);
        assert.equal(r?.status, 'complete');
        assert.equal(r?.root.root.path, f.target);
        assert.equal(await readFile(join(f.source, 'unknown.txt'), 'utf8'), '用户未知文件');
        assert.equal(await m.recover(f.host), null);
    }
    finally {
        await f.close();
    }
});
test('ROOT09-12 changed source at cleanup remains pending and cannot be declared complete', async () => {
    let changed = false;
    const f = await fixture({ hook: async (phase) => {
            if (phase === 'cleanup' && !changed) {
                changed = true;
                await writeFile(join(f.source, 'drafts.json'), '外部新稿');
            }
        } });
    try {
        const r = await f.manager.migrate(await proof(f.target), f.host);
        assert.equal(r.status, 'cleanup-pending');
        assert.ok(r.pending.includes('drafts.json'));
        assert.equal(await readFile(join(f.source, 'drafts.json'), 'utf8'), '外部新稿');
        assert.equal(await readFile(join(f.target, 'drafts.json'), 'utf8'), '未批准草稿');
        const retry = await new DataRootManager(f.bootstrap, f.source).recover(f.host);
        assert.equal(retry?.status, 'cleanup-pending');
        assert.equal(retry?.root.root.path, f.target);
    }
    finally {
        await f.close();
    }
});
test('ROOT09-13 committed disconnected target never reopens the intact old duplicate', async () => {
    const f = await fixture({ hook: phase => {
            if (phase === 'committed')
                throw new RootMigrationCrash('isolated process loss');
        } });
    try {
        await assert.rejects(f.manager.migrate(await proof(f.target), f.host), RootMigrationCrash);
        await rename(f.target, f.target + '-offline');
        const m = new DataRootManager(f.bootstrap, f.source);
        await assert.rejects(m.resolve(), code('ROOT_UNAVAILABLE'));
        await assert.rejects(m.recover(f.host), code('ROOT_UNAVAILABLE'));
        assert.equal(await readFile(join(f.source, 'drafts.json'), 'utf8'), '未批准草稿');
    }
    finally {
        await f.close();
    }
});
test('ROOT09-14 pointer rename failure rolls back; directory-sync uncertainty never rolls back a renamed pointer', async () => {
    for (const renamed of [false, true]) {
        const f = await fixture(renamed ? { beforePointerDirectorySync: async () => { throw Error('disk sync failure'); } } : { beforePointerRename: async () => { throw Error('rename failure'); } });
        try {
            if (renamed) {
                const r = await f.manager.migrate(await proof(f.target), f.host);
                assert.equal(r.status, 'cleanup-pending');
                assert.equal(r.root.root.path, f.target);
                assert.ok(r.pending.includes('POINTER_DURABILITY'));
                assert.equal(await readFile(join(f.source, 'drafts.json'), 'utf8'), '未批准草稿');
            }
            else {
                await assert.rejects(f.manager.migrate(await proof(f.target), f.host));
                assert.deepEqual(await readdir(f.target), []);
                assert.deepEqual(JSON.parse(await readFile(join(f.bootstrap, 'data-root.json'), 'utf8')), f.pointer);
            }
        }
        finally {
            await f.close();
        }
    }
});
test('ROOT09-15 second migration starts from the pointer and carries the previous recovery record', async () => {
    const f = await fixture();
    try {
        const first = await f.manager.migrate(await proof(f.target), f.host);
        assert.equal(first.status, 'complete');
        const next = join(f.base, 'third');
        await mkdir(next);
        const previousFiles = [...f.owned, `.xuanxiang-root-recovery-${first.migrationId}.json`];
        const host: MigrationHost = { async quiesce(p) { assert.equal(p.root.path, f.target); return { source: await proof(f.target), ownedFiles: previousFiles, assertClosed() { }, release() { } }; } };
        const result = await f.manager.migrate(await proof(next), host);
        assert.equal(result.status, 'complete');
        assert.equal(result.root.revision, 3);
        assert.equal(await readFile(join(next, 'drafts.json'), 'utf8'), '未批准草稿');
        assert.equal(JSON.parse(await readFile(join(next, 'catalog.json'), 'utf8')).value[0].path, f.work);
        assert.equal(result.root.root.path, next);
        assert.equal(JSON.parse(await readFile(join(next, `.xuanxiang-root-recovery-${first.migrationId}.json`), 'utf8')).migrationId, first.migrationId);
        assert.equal(JSON.parse(await readFile(join(next, `.xuanxiang-root-recovery-${result.migrationId}.json`), 'utf8')).migrationId, result.migrationId);
    }
    finally {
        await f.close();
    }
});
test('ROOT09-16 unknown empty directories in the old root and managed directories are preserved', async () => {
    const f = await fixture();
    try {
        await mkdir(join(f.source, 'unknown-empty'));
        await mkdir(join(f.source, 'session', 'user-empty'));
        assert.equal((await f.manager.migrate(await proof(f.target), f.host)).status, 'complete');
        assert.equal((await stat(join(f.source, 'unknown-empty'))).isDirectory(), true);
        assert.equal((await stat(join(f.source, 'session', 'user-empty'))).isDirectory(), true);
    }
    finally {
        await f.close();
    }
});
test('ROOT09-17 a target change after verification blocks pointer commit and preserves foreign bytes', async () => {
    const f = await fixture({ beforePointerRename: async () => { await writeFile(join(f.target, 'foreign.txt'), '保留注入文件'); } });
    try {
        await assert.rejects(f.manager.migrate(await proof(f.target), f.host), code('TARGET_CHANGED'));
        assert.deepEqual(JSON.parse(await readFile(join(f.bootstrap, 'data-root.json'), 'utf8')), f.pointer);
        assert.equal(await readFile(join(f.target, 'foreign.txt'), 'utf8'), '保留注入文件');
        assert.equal(await readFile(join(f.source, 'drafts.json'), 'utf8'), '未批准草稿');
    }
    finally {
        await f.close();
    }
});
test('ROOT09-18 an externally changed pointer is never overwritten by the migration commit', async () => {
    const f = await fixture({ beforePointerRename: async () => { await writeFile(join(f.bootstrap, 'data-root.json'), JSON.stringify({ ...f.pointer, revision: 8 })); } });
    try {
        await assert.rejects(f.manager.migrate(await proof(f.target), f.host), code('POINTER_CHANGED'));
        assert.equal(JSON.parse(await readFile(join(f.bootstrap, 'data-root.json'), 'utf8')).revision, 8);
        assert.equal(await readFile(join(f.source, 'drafts.json'), 'utf8'), '未批准草稿');
        assert.deepEqual(await readdir(f.target), []);
    }
    finally {
        await f.close();
    }
});
test('ROOT09-19 process loss while copying leaves the old root authoritative and recoverable', async () => {
    const f = await fixture({ hook: phase => {
            if (phase === 'file-copied')
                throw new RootMigrationCrash('first copied file');
        } });
    try {
        await assert.rejects(f.manager.migrate(await proof(f.target), f.host), RootMigrationCrash);
        assert.deepEqual(JSON.parse(await readFile(join(f.bootstrap, 'data-root.json'), 'utf8')), f.pointer);
        const result = await new DataRootManager(f.bootstrap, f.source).recover(f.host);
        assert.equal(result?.status, 'rolled-back');
        assert.deepEqual(await readdir(f.target), []);
        assert.equal(await readFile(join(f.source, 'drafts.json'), 'utf8'), '未批准草稿');
    }
    finally {
        await f.close();
    }
});
test('ROOT09-20 a source lease becoming live during copy cannot finish or change the pointer', async () => {
    const f = await fixture({ hook: phase => {
            if (phase === 'file-copied')
                f.setClosed(false);
        } });
    try {
        await assert.rejects(f.manager.migrate(await proof(f.target), f.host), code('SOURCE_NOT_CLOSED'));
        assert.deepEqual(JSON.parse(await readFile(join(f.bootstrap, 'data-root.json'), 'utf8')), f.pointer);
        assert.deepEqual(await readdir(f.target), []);
    }
    finally {
        await f.close();
    }
});
test('ROOT09-21 a source binary larger than the copy buffer is preserved exactly', async () => {
    const f = await fixture();
    try {
        const bytes = Buffer.alloc(2 * 1024 * 1024 + 71);
        for (let i = 0; i < bytes.length; i++)
            bytes[i] = i % 251;
        await writeFile(join(f.source, 'inbox', 'database', 'binary'), bytes);
        f.owned.push('inbox/database/binary');
        assert.equal((await f.manager.migrate(await proof(f.target), f.host)).status, 'complete');
        assert.deepEqual(await readFile(join(f.target, 'inbox', 'database', 'binary')), bytes);
    }
    finally {
        await f.close();
    }
});
test('ROOT09-22 corrupt migration journal cannot be recovered or silently treated as an empty default root', async () => {
    const f = await fixture({ hook: phase => {
            if (phase === 'verified')
                throw new RootMigrationCrash('verified');
        } });
    try {
        await assert.rejects(f.manager.migrate(await proof(f.target), f.host), RootMigrationCrash);
        const path = join(f.bootstrap, 'root-migration.json'), record = JSON.parse(await readFile(path, 'utf8'));
        record.journal.files[0].sha256 = '0'.repeat(64);
        await writeFile(path, JSON.stringify(record));
        await assert.rejects(new DataRootManager(f.bootstrap, f.source).recover(f.host), code('JOURNAL_INVALID'));
        await rm(join(f.bootstrap, 'data-root.json'));
        await assert.rejects(new DataRootManager(f.bootstrap, f.source).resolve(), code('JOURNAL_INVALID'));
        assert.equal(await readFile(join(f.source, 'drafts.json'), 'utf8'), '未批准草稿');
    }
    finally {
        await f.close();
    }
});
test('ROOT09-23 pointer rename before committed-journal write is still the sole authority on recovery', async () => {
    const f = await fixture({ hook: phase => {
            if (phase === 'pointer-written')
                throw new RootMigrationCrash('pointer alone committed');
        } });
    try {
        await assert.rejects(f.manager.migrate(await proof(f.target), f.host), RootMigrationCrash);
        const record = JSON.parse(await readFile(join(f.bootstrap, 'root-migration.json'), 'utf8'));
        assert.equal(record.journal.phase, 'verified');
        const m = new DataRootManager(f.bootstrap, f.source), r = await m.recover(f.host);
        assert.equal(r?.status, 'complete');
        assert.equal(r?.root.root.path, f.target);
        assert.equal(JSON.parse(await readFile(join(f.bootstrap, 'data-root.json'), 'utf8')).root.path, f.target);
    }
    finally {
        await f.close();
    }
});
test('ROOT09-24 a lost pointer with completed migration evidence cannot initialize an unrelated empty default', async () => {
    const f = await fixture();
    try {
        await f.manager.migrate(await proof(f.target), f.host);
        await rm(join(f.bootstrap, 'data-root.json'));
        const fallback = join(f.base, 'unused-default');
        await assert.rejects(new DataRootManager(f.bootstrap, fallback).resolve(), code('MIGRATION_RECOVERY_REQUIRED'));
        assert.equal((await readdir(f.base)).includes('unused-default'), false);
        await assert.rejects(new DataRootManager(f.bootstrap, fallback).adopt(await proof(f.target)), code('MIGRATION_RECOVERY_REQUIRED'));
    }
    finally {
        await f.close();
    }
});
test('ROOT09-25 a source change before full verification is never silently copied as the original revision', async () => {
    const f = await fixture({ hook: async (phase) => {
            if (phase === 'verifying')
                await writeFile(join(f.source, 'drafts.json'), '复制过程中新增稿');
        } });
    try {
        await assert.rejects(f.manager.migrate(await proof(f.target), f.host), code('VERIFY_FAILED'));
        assert.deepEqual(JSON.parse(await readFile(join(f.bootstrap, 'data-root.json'), 'utf8')), f.pointer);
        assert.equal(await readFile(join(f.source, 'drafts.json'), 'utf8'), '复制过程中新增稿');
        assert.deepEqual(await readdir(f.target), []);
    }
    finally {
        await f.close();
    }
});
test('ROOT09-26 an I/O failure before commit rolls back without opening or touching an external service', async () => {
    const f = await fixture({ hook: phase => {
            if (phase === 'file-copied') {
                const e = new Error('isolated disk failure') as NodeJS.ErrnoException;
                e.code = 'ENOSPC';
                throw e;
            }
        } });
    try {
        await assert.rejects(f.manager.migrate(await proof(f.target), f.host), { code: 'ENOSPC' });
        assert.deepEqual(JSON.parse(await readFile(join(f.bootstrap, 'data-root.json'), 'utf8')), f.pointer);
        assert.equal(await readFile(join(f.source, 'state.json'), 'utf8'), '用户配置和已加密凭据');
        assert.deepEqual(await readdir(f.target), []);
        assert.deepEqual(f.releases, ['old-root']);
    }
    finally {
        await f.close();
    }
});
test('ROOT09-27 replaced target bytes at the final hash check are preserved and leave a recoverable rollback-pending', async () => {
    const f = await fixture({ beforePointerRename: async () => { await writeFile(join(f.target, 'drafts.json'), '保留目标外部稿'); } });
    try {
        await assert.rejects(f.manager.migrate(await proof(f.target), f.host), code('NEW_ROOT_VERIFY_FAILED'));
        assert.deepEqual(JSON.parse(await readFile(join(f.bootstrap, 'data-root.json'), 'utf8')), f.pointer);
        assert.equal(await readFile(join(f.target, 'drafts.json'), 'utf8'), '保留目标外部稿');
        assert.equal(await readFile(join(f.source, 'drafts.json'), 'utf8'), '未批准草稿');
        const retry = await new DataRootManager(f.bootstrap, f.source).recover(f.host);
        assert.equal(retry?.status, 'rollback-pending');
        assert.ok(retry?.pending.includes('drafts.json'));
        assert.equal(await readFile(join(f.target, 'drafts.json'), 'utf8'), '保留目标外部稿');
    }
    finally {
        await f.close();
    }
});
test('ROOT09-28 ownership inventory cannot silently omit existing user settings or durable drafts', async () => {
    for (const omitted of ['state.json', 'drafts.json']) {
        const f = await fixture();
        try {
            f.owned.splice(f.owned.indexOf(omitted), 1);
            await assert.rejects(f.manager.migrate(await proof(f.target), f.host), code('OWNERSHIP_INCOMPLETE'));
            assert.deepEqual(JSON.parse(await readFile(join(f.bootstrap, 'data-root.json'), 'utf8')), f.pointer);
            assert.equal((await readFile(join(f.source, omitted))).length > 0, true);
            assert.deepEqual(await readdir(f.target), []);
        }
        finally {
            await f.close();
        }
    }
});
test('ROOT09-29 an initialized but empty global inbox remains a valid directory after migration', async () => {
    const f = await fixture();
    try {
        await rm(join(f.source, 'inbox', 'database'), { recursive: true });
        f.owned.splice(f.owned.indexOf('inbox/database/PG_VERSION'), 1);
        assert.equal((await f.manager.migrate(await proof(f.target), f.host)).status, 'complete');
        assert.equal((await stat(join(f.target, 'inbox'))).isDirectory(), true);
        assert.deepEqual(await readdir(join(f.target, 'inbox')), []);
    }
    finally {
        await f.close();
    }
});
test('ROOT09-30 manifest persistence stays bounded when Electron/database ownership lists grow', async () => { let writes = 0; const f = await fixture({ hook: phase => { if (phase === 'journal')
        writes++; } }); try {
    for (let i = 0; i < 40; i++) {
        const path = `inbox/database/chunk-${i}`;
        f.owned.push(path);
        await writeFile(join(f.source, path), Buffer.alloc(128, i));
    }
    assert.equal((await f.manager.migrate(await proof(f.target), f.host)).status, 'complete');
    assert.ok(writes <= 12, `whole-manifest writes ${writes}; must not rewrite the full plan per file`);
}
finally {
    await f.close();
} });
test('ROOT09-31 crash during promotion uses persisted stage inode identities to clean only moved files', async () => { const f = await fixture({ hook: phase => { if (phase === 'file-promoted')
        throw new RootMigrationCrash('moved inode before journal'); } }); try {
    await assert.rejects(f.manager.migrate(await proof(f.target), f.host), RootMigrationCrash);
    assert.deepEqual(JSON.parse(await readFile(join(f.bootstrap, 'data-root.json'), 'utf8')), f.pointer);
    const result = await new DataRootManager(f.bootstrap, f.source).recover(f.host);
    assert.equal(result?.status, 'rolled-back');
    assert.deepEqual(await readdir(f.target), []);
    assert.equal(await readFile(join(f.source, 'drafts.json'), 'utf8'), '未批准草稿');
}
finally {
    await f.close();
} });
test('ROOT09-32 cancellation at the final commit boundary cannot slip past the hash verification', async () => { const controller = new AbortController(), f = await fixture({ hook: phase => { if (phase === 'ready-to-commit')
        controller.abort(); } }); try {
    await assert.rejects(f.manager.migrate(await proof(f.target), f.host, controller.signal), code('MIGRATION_CANCELLED'));
    assert.deepEqual(JSON.parse(await readFile(join(f.bootstrap, 'data-root.json'), 'utf8')), f.pointer);
    assert.deepEqual(await readdir(f.target), []);
    assert.equal(await readFile(join(f.source, 'drafts.json'), 'utf8'), '未批准草稿');
}
finally {
    await f.close();
} });
test('ROOT09-33 exhausted pointer revision blocks before quiescence rather than writing an unreadable pointer', async () => { const f = await fixture(); try {
    await writeFile(join(f.bootstrap, 'data-root.json'), JSON.stringify({ ...f.pointer, revision: Number.MAX_SAFE_INTEGER }));
    await assert.rejects(f.manager.migrate(await proof(f.target), f.host), code('POINTER_REVISION_EXHAUSTED'));
    assert.equal(f.calls, 0);
    assert.equal(JSON.parse(await readFile(join(f.bootstrap, 'data-root.json'), 'utf8')).revision, Number.MAX_SAFE_INTEGER);
    assert.deepEqual(await readdir(f.target), []);
}
finally {
    await f.close();
} });
test('ROOT09-34 cancellation during a final hashing lease check preserves its cancellation error contract', async () => { const controller = new AbortController(); let pointer = false, checks = 0; const f = await fixture({ hook: phase => { if (phase === 'pointer')
        pointer = true; } }); const host: MigrationHost = { async quiesce(source) { const lease = await f.host.quiesce(source); return { ...lease, async assertClosed() { await lease.assertClosed(); if (pointer && ++checks === 2)
            controller.abort(); } }; } }; try {
    await assert.rejects(f.manager.migrate(await proof(f.target), host, controller.signal), code('MIGRATION_CANCELLED'));
    assert.deepEqual(JSON.parse(await readFile(join(f.bootstrap, 'data-root.json'), 'utf8')), f.pointer);
    assert.deepEqual(await readdir(f.target), []);
}
finally {
    await f.close();
} });
