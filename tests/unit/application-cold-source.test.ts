import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { mkdtemp, mkdir, realpath, rm, writeFile, readFile, readdir, rename, symlink, link, chmod, open } from 'node:fs/promises';
import { join,dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fsPromises from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { DataRootManager } from '../../desktop/core/data-root';
import { directoryIdentity } from '../../desktop/core/root-ownership';
import { DraftJournal } from '../../desktop/main/draft-journal';
async function registerWork(f:Awaited<ReturnType<typeof fixture>>,path:string,identity:{device:string;inode:string}){await writeFile(join(f.source,'catalog.json'),JSON.stringify({schemaVersion:1,revision:1,value:[{id:randomUUID(),path,identity:{device:identity.device,inode:identity.inode},novelId:randomUUID(),title:'isolated closed work',requestId:randomUUID(),requestHash:'fixture',createdAt:'2026-10-08T00:00:00.000Z'}]}))}
test('AC36-18 a catalog alias to the physical work containing native target containers is rejected before any copy',async t=>{const f=await fixture(t);try{const work=dirname(f.parent),alias=join(f.base,'catalog-work-alias');await symlink(work,alias);await registerWork(f,alias,await directoryIdentity(work));await assert.rejects(f.preserve(),refused);assert.deepEqual(await readdir(f.parent),[]);assert.deepEqual(await readdir(f.candidateParent),[]);assert.equal(f.opened(),0)}finally{await f.close()}})
test('AC36-19 an existing catalog work must match its stored physical identity and remain canonical through the final seal',async t=>{const f=await fixture(t);try{const work=join(f.base,'external-work');await mkdir(work);const identity=await directoryIdentity(work);await registerWork(f,work,{device:identity.device,inode:String(BigInt(identity.inode)+1n)});await assert.rejects(f.preserve(),refused);assert.deepEqual(await readdir(f.parent),[]);await registerWork(f,work,identity);await assert.rejects(f.preserve({async hook(phase){if(phase==='after-receipt'){await rename(work,work+'.retained');await mkdir(work)}}}),refused);assert.deepEqual(await readdir(work),[]);assert.equal(f.opened(),0)}finally{await f.close()}})
test('AC36-20 an unrelated canonical work is observed without reading its contents or claiming them as copied bytes',async t=>{const f=await fixture(t);try{const work=join(f.base,'external-work');await mkdir(work);await writeFile(join(work,'unmanaged-fixture'),'keep private at work');await registerWork(f,work,await directoryIdentity(work));const proof=await f.preserve();validateApplicationColdSourceProof(proof,f.expected).assertCurrent();assert.equal(await readFile(join(work,'unmanaged-fixture'),'utf8'),'keep private at work');assert.equal(f.opened(),0)}finally{await f.close()}})
import { preserveClosedApplicationSource, validateApplicationColdSourceProof, applicationColdSourceReceiptSchema, ApplicationColdSourceError, type ApplicationColdSourceHost, type ApplicationColdSourceOptions } from '../../desktop/core/application-cold-source';
async function fixture(t: TestContext) {
    let opened = 0, owner = true, cold = true, locked = true;
    t.mock.method(PGlite, 'create', async () => { opened++; throw Error('source engine must never open'); });
    const base = await realpath(await mkdtemp(join(tmpdir(), 'xuanxiang-appcold36-'))), source = join(base, 'source'), boot = join(base, 'bootstrap'), native = join(base, 'native-selected-base'), parent = join(native, randomUUID()), candidateParent = join(native, randomUUID()), appId = randomUUID(), operationId = randomUUID();
    for (const path of [source, boot, native, parent, candidateParent])
        await mkdir(path);
    for (const path of ['inbox/database/global', 'inbox/database/pg_wal/archive_status', 'assets/global', 'session/Local Storage/leveldb', 'unknown-directory', 'backups'])
        await mkdir(join(source, path), { recursive: true });
    await writeFile(join(source, 'xuanxiang-app.json'), JSON.stringify({ schemaVersion: 1, app: 'Xuanxiangxiezuo-Desktop', id: appId, phase: 'ready', inboxReady: true }));
    await writeFile(join(source, 'catalog.json'), JSON.stringify({ schemaVersion: 1, revision: 0, value: [] }));
    await writeFile(join(source, 'inbox/database/PG_VERSION'), 'broken database version, never opened');
    await writeFile(join(source, 'inbox/database/global/pg_control'), Buffer.from([0, 7, 0, 254, 12]));
    await writeFile(join(source, 'state.json'), '{"localEncryptedFixture":"raw closed bytes"}');
    await writeFile(join(source, 'session/Local Storage/leveldb/CURRENT'), 'closed local session state');
    const avatar = randomUUID() + '.png';
    await writeFile(join(source, 'assets/global', avatar), Buffer.from([0, 1, 2, 3]));
    await writeFile(join(source, 'unknown.txt'), 'unknown bytes stay at original root');
    await writeFile(join(source, 'unknown-directory', 'unmanaged.bin'), 'do not claim copied unknown bytes');
    await writeFile(join(source, 'backups', 'retained-only.txt'), 'old local packages stay intact');
    const journal = new DraftJournal(source);
    journal.activate('last-closed-owner');
    await journal.persist('last-closed-owner', { version: 1, revision: 1, createdAt: '2026-10-08T00:00:00.000Z', autosaves: [], sources: { chat: { draft: 'latest unsent input', queuedRequests: [{ prompt: 'keep inert', approved: true }] } }, issues: [] });
    const root = await directoryIdentity(source), bootstrap = await directoryIdentity(boot), selectedParent = await directoryIdentity(parent), selectedCandidate = await directoryIdentity(candidateParent), pointer = await new DataRootManager(boot, source).adopt(root);
    const input = { operationId, bootstrap, parent: selectedParent, candidateParent: selectedCandidate }, host: ApplicationColdSourceHost = { assertStableLock() { if (!locked)
            throw Error('fixture lock expired'); }, assertCold() { if (!cold)
            throw Error('fixture source still live'); }, assertOwnerImmediately(directory, id) { assert.equal(id, operationId); assert.ok(directory.path === parent || directory.path === candidateParent); if (!owner)
            throw Error('fixture selected parent owner revoked'); } };
    const expected = { operationId, bootstrap, appId, source: root, sourcePointer: pointer };
    return { base, source, boot, parent, candidateParent, root, appId, input, host, expected, opened: () => opened, revokeOwner: () => { owner = false; }, revokeCold: () => { cold = false; }, revokeLock: () => { locked = false; }, preserve: (options: ApplicationColdSourceOptions = {}) => preserveClosedApplicationSource(input, host, options), close: () => rm(base, { recursive: true, force: true }) };
}
const refused = (cause: unknown) => cause instanceof ApplicationColdSourceError && !Object.hasOwn(cause, 'cause') && !cause.message.includes('private');
test('AC36-01 corrupt closed database bytes, full latest journal, managed session state and empty directories have a separate private closed-source copy', async (t) => { const f = await fixture(t); try {
    const pointer = await readFile(join(f.boot, 'data-root.json')), sourceDraft = await readFile(join(f.source, 'drafts.json')), proof = await f.preserve(), record = proof.receipt;
    assert.equal(record.kind, 'closed-source');
    assert.equal(record.health, 'not-verified');
    assert.equal(Object.hasOwn(record, 'workId'), false);
    assert.equal(Object.hasOwn(record, 'engine'), false);
    assert.deepEqual(record.sourcePointer, f.expected.sourcePointer);
    assert.equal(record.appId, f.appId);
    assert.deepEqual(await readFile(join(record.data.path, 'inbox/database/PG_VERSION')), await readFile(join(f.source, 'inbox/database/PG_VERSION')));
    assert.deepEqual(await readFile(join(record.data.path, 'drafts.json')), sourceDraft);
    assert.deepEqual(await readFile(join(record.data.path, 'state.json')), await readFile(join(f.source, 'state.json')));
    assert.deepEqual(await readFile(join(record.data.path, 'session/Local Storage/leveldb/CURRENT')), await readFile(join(f.source, 'session/Local Storage/leveldb/CURRENT')));
    assert.deepEqual(await readdir(join(record.data.path, 'inbox/database/pg_wal/archive_status')), []);
    assert.ok(record.sourceInventory.missing.includes('backup-plan.json'));
    assert.ok(record.sourceInventory.preserved.some(row => row.path === 'unknown.txt'));
    assert.ok(record.sourceInventory.preserved.some(row => row.path === 'backups'));
    await assert.rejects(readFile(join(record.data.path, 'unknown.txt')), cause => (cause as NodeJS.ErrnoException).code === 'ENOENT');
    assert.equal(await readFile(join(f.source, 'unknown.txt'), 'utf8'), 'unknown bytes stay at original root');
    validateApplicationColdSourceProof(proof, f.expected).assertCurrent();
    assert.deepEqual(await readFile(join(f.boot, 'data-root.json')), pointer);
    assert.equal(f.opened(), 0);
}
finally {
    await f.close();
} });
test('AC36-02 raw DTO, JSON clone, modified proof and another operation never reconstruct the original private source grant', async (t) => { const f = await fixture(t); try {
    const proof = await f.preserve();
    for (const raw of [proof.receipt, { receipt: structuredClone(proof.receipt), assertCurrent() { } }, JSON.parse(JSON.stringify(proof)), Object.assign(Object.create({ privateSource: true }), proof)])
        assert.throws(() => validateApplicationColdSourceProof(raw as typeof proof, f.expected), refused);
    assert.throws(() => validateApplicationColdSourceProof(proof, { ...f.expected, operationId: randomUUID() }), refused);
    proof.receipt.createdAt = '2026-10-08T01:00:00.000Z';
    assert.throws(() => validateApplicationColdSourceProof(proof, f.expected), refused);
}
finally {
    await f.close();
} });
for (const kind of ['managed-file-link', 'managed-directory-link', 'unknown-link', 'hardlink', 'unreadable'])
    test(`AC36-03 ${kind} cannot be silently skipped or copied as a complete source`, async (t) => { const f = await fixture(t); try {
        const foreign = join(f.base, 'foreign-regular');
        await writeFile(foreign, 'private fixture retained, never log');
        const path = join(f.source, 'inbox/database/PG_VERSION');
        if (kind === 'managed-directory-link') {
            await rm(join(f.source, 'inbox/database/pg_wal'), { recursive: true });
            await symlink(f.base, join(f.source, 'inbox/database/pg_wal'));
        }
        else if (kind === 'unknown-link')
            await symlink(foreign, join(f.source, 'another-unknown'));
        else if (kind === 'unreadable')
            await chmod(path, 0);
        else {
            await rm(path);
            if (kind === 'hardlink')
                await link(foreign, path);
            else
                await symlink(foreign, path);
        }
        await assert.rejects(f.preserve(), refused);
        assert.deepEqual(await readdir(f.parent), []);
        assert.equal(await readFile(foreign, 'utf8'), 'private fixture retained, never log');
        assert.equal(f.opened(), 0);
    }
    finally {
        await f.close();
    } });
test('AC36-04 a special managed FIFO is refused before a potentially blocking reader', { skip: process.platform === 'win32' }, async (t) => { const f = await fixture(t); try {
    const path = join(f.source, 'inbox/database/PG_VERSION');
    await rm(path);
    const created = spawnSync('/usr/bin/mkfifo', [path]);
    assert.equal(created.status, 0);
    await assert.rejects(f.preserve(), refused);
    assert.deepEqual(await readdir(f.parent), []);
}
finally {
    await f.close();
} });
for (const kind of ['journal', 'catalog', 'marker'])
    test(`AC36-05 invalid source ${kind} is retained and blocks before creating a copy`, async (t) => { const f = await fixture(t); try {
        const path = join(f.source, kind === 'journal' ? 'drafts.json' : kind === 'catalog' ? 'catalog.json' : 'xuanxiang-app.json'), bytes = Buffer.from(kind === 'marker' ? JSON.stringify({ schemaVersion: 1, app: 'Xuanxiangxiezuo-Desktop', id: randomUUID(), phase: 'ready', inboxReady: true }) : '{"private":"invalid semantic fixture"}');
        await writeFile(path, bytes);
        await assert.rejects(f.preserve(), refused);
        assert.deepEqual(await readFile(path), bytes);
        assert.deepEqual(await readdir(f.parent), []);
        assert.equal(f.opened(), 0);
    }
    finally {
        await f.close();
    } });
test('AC36-06 source missing managed namespace is explicit while an appearing missing item invalidates the original inventory', async (t) => { const f = await fixture(t); try {
    await rm(join(f.source, 'assets'), { recursive: true });
    const proof = await f.preserve();
    assert.ok(proof.receipt.sourceInventory.missing.includes('assets'));
    assert.ok(proof.receipt.sourceInventory.missing.includes('assets/global'));
    await writeFile(join(f.source, 'backup-plan.json'), 'new input appeared');
    assert.throws(() => validateApplicationColdSourceProof(proof, f.expected).assertSourceCurrent(), refused);
    assert.equal(await readFile(join(f.source, 'backup-plan.json'), 'utf8'), 'new input appeared');
}
finally {
    await f.close();
} });
for (const stage of ['source', 'copy', 'receipt', 'unknown-source'])
    test(`AC36-07 late ${stage} identity/bytes replacement refuses issuance and preserves all foreign replacements`, async (t) => { const f = await fixture(t); try {
        let destination: string | undefined;
        await assert.rejects(f.preserve({ async hook(phase, view) { if (phase !== 'after-receipt')
                return; destination = view.directory!.path; const path = stage === 'source' ? join(f.source, 'drafts.json') : stage === 'copy' ? join(view.data!.path, 'state.json') : stage === 'receipt' ? join(view.directory!.path, 'xuanxiang-application-closed-source.json') : join(f.source, 'unknown.txt'), bytes = await readFile(path); await rename(path, path + '.retained'); await writeFile(path, bytes); } }), refused);
        assert.ok(destination);
        assert.ok((await readdir(destination!)).includes('data'));
        assert.equal(f.opened(), 0);
    }
    finally {
        await f.close();
    } });
for (const kind of ['owner', 'cold', 'lock'])
    test(`AC36-08 captured ${kind} revocation after the last host await cannot be bypassed by replacing callbacks`, async (t) => { const f = await fixture(t); try {
        await assert.rejects(f.preserve({ async hook(phase) { if (phase !== 'after-receipt')
                return; await Promise.resolve(); if (kind === 'owner')
                f.revokeOwner();
            else if (kind === 'cold')
                f.revokeCold();
            else
                f.revokeLock(); f.host.assertOwnerImmediately = () => { }; f.host.assertCold = () => { }; f.host.assertStableLock = () => { }; } }), refused);
        assert.equal(f.opened(), 0);
        assert.equal((await readdir(f.parent)).length, 1);
    }
    finally {
        await f.close();
    } });
test('AC36-09 Promise host assertions and a nonempty or overlapping parent fail before source-copy mutation', async (t) => { const f = await fixture(t); try {
    const original = f.host.assertCold;
    f.host.assertCold = (() => Promise.resolve()) as unknown as () => void;
    await assert.rejects(f.preserve(), refused);
    f.host.assertCold = original;
    await writeFile(join(f.parent, 'foreign'), 'preserve');
    await assert.rejects(f.preserve(), refused);
    assert.equal(await readFile(join(f.parent, 'foreign'), 'utf8'), 'preserve');
    await rm(join(f.parent, 'foreign'));
    await assert.rejects(preserveClosedApplicationSource({ ...f.input, parent: f.input.candidateParent }, f.host), refused);
    assert.deepEqual(await readdir(f.parent), []);
}
finally {
    await f.close();
} });
for (const limits of [{ files: 1 }, { directories: 1 }, { bytes: 1 }, { metadataBytes: 1 }])
    test(`AC36-10 narrowing capacity ${Object.keys(limits)[0]} never truncates a source or issues a partial grant`, async (t) => { const f = await fixture(t); try {
        const original = await readFile(join(f.source, 'drafts.json'));
        await assert.rejects(f.preserve({ limits }), refused);
        assert.deepEqual(await readFile(join(f.source, 'drafts.json')), original);
        assert.equal(f.opened(), 0);
    }
    finally {
        await f.close();
    } });
test('AC36-11 an oversized sparse managed file is refused without streaming it or touching the original bytes', async (t) => { const f = await fixture(t); try {
    const path = join(f.source, 'inbox/database/global/pg_control'), handle = await open(path, 'r+');
    try {
        await handle.truncate(512 * 1024 * 1024 + 1);
    }
    finally {
        await handle.close();
    }
    await assert.rejects(f.preserve(), refused);
    assert.deepEqual(await readdir(f.parent), []);
    assert.equal(f.opened(), 0);
}
finally {
    await f.close();
} });
test('AC36-12 cancellation waits current physical IO guards and retains only this attempt without writing a valid receipt', async (t) => { const f = await fixture(t), abort = new AbortController(); try {
    await assert.rejects(f.preserve({ signal: abort.signal, async hook(phase) { if (phase === 'before-copy')
            abort.abort('private abort reason never leak'); } }), refused);
    assert.equal(f.opened(), 0);
    for (const name of await readdir(f.parent))
        await assert.rejects(readFile(join(f.parent, name, 'xuanxiang-application-closed-source.json')), cause => (cause as NodeJS.ErrnoException).code === 'ENOENT');
}
finally {
    await f.close();
} });
test('AC36-13 strict closed-source metadata refuses healthy labels, work identifiers and extra source authority fields', async (t) => { const f = await fixture(t); try {
    const proof = await f.preserve();
    for (const extra of [{ kind: 'healthy' }, { health: 'verified' }, { workId: randomUUID() }, { sourceAuthority: true }])
        assert.equal(applicationColdSourceReceiptSchema.safeParse({ ...proof.receipt, ...extra }).success, false);
}
finally {
    await f.close();
} });
for (const leaf of ['data', 'inbox/database/global'])
    test(`AC36-14 ${leaf} creation cannot reidentify and populate an empty foreign replacement across a yielded mkdir`, async (t) => { const f = await fixture(t); try {
        const original = fsPromises.mkdir;
        let replacement: string | undefined;
        t.mock.method(fsPromises, 'mkdir', async (...args: Parameters<typeof fsPromises.mkdir>) => { const result = await original(...args), path = String(args[0]); if (!replacement && path.startsWith(f.parent + '/') && path.endsWith('/' + leaf)) {
            replacement = path;
            await rename(path, path + '.original-owner');
            await original(path, { mode: 0o700 });
        } return result; });
        const result = await f.preserve().then(proof => ({ proof }), cause => ({ cause }));
        if (replacement) {
            assert.ok('cause' in result && refused(result.cause), 'foreign replacement must not receive a private source grant');
            assert.deepEqual(await readdir(replacement), [], 'foreign directory must not be populated or cleaned');
        }
        else {
            assert.ok('proof' in result);
            validateApplicationColdSourceProof(result.proof!, f.expected).assertCurrent();
        }
        assert.equal(f.opened(), 0);
    }
    finally {
        await f.close();
    } });
test('AC36-15 journal semantic read followed by a different journal during inventory IO rejects the changed raw source without learning its new bytes', async (t) => { const f = await fixture(t); try {
    const original = fsPromises.lstat;
    let changed = false;
    const replacement = Buffer.from('{"changed-after-semantic-read":"must remain at source"}');
    t.mock.method(fsPromises, 'lstat', async (...args: Parameters<typeof fsPromises.lstat>) => { if (!changed && String(args[0]) === join(f.source, 'inbox/database/PG_VERSION')) {
        changed = true;
        await writeFile(join(f.source, 'drafts.json'), replacement);
    } return original(...args); });
    await assert.rejects(f.preserve(), refused);
    assert.equal(changed, true);
    assert.deepEqual(await readFile(join(f.source, 'drafts.json')), replacement);
    assert.equal(f.opened(), 0);
    for (const id of await readdir(f.parent))
        await assert.rejects(readFile(join(f.parent, id, 'xuanxiang-application-closed-source.json')), cause => (cause as NodeJS.ErrnoException).code === 'ENOENT');
}
finally {
    await f.close();
} });
test('AC36-16 a captured physical seal survives pointer replacement but grants no new authority and still checks all original source/copy/host observations', async (t) => { const f = await fixture(t); try {
    const proof = await f.preserve(), validated = validateApplicationColdSourceProof(proof, f.expected), pointerPath = join(f.boot, 'data-root.json'), oldPointer = await readFile(pointerPath);
    await rename(pointerPath, pointerPath + '.old-authority');
    await writeFile(pointerPath, JSON.stringify({ ...f.expected.sourcePointer, revision: f.expected.sourcePointer.revision + 1 }));
    assert.throws(() => validated.assertCurrent());
    assert.throws(() => validateApplicationColdSourceProof(proof, f.expected));
    validated.assertSourceCurrent();
    assert.deepEqual(await readFile(pointerPath + '.old-authority'), oldPointer);
    const path = join(proof.receipt.data.path, 'state.json'), bytes = await readFile(path);
    await rename(path, path + '.retained');
    await writeFile(path, bytes);
    assert.throws(() => validated.assertSourceCurrent(), refused);
    assert.equal(f.opened(), 0);
}
finally {
    await f.close();
} });
test('AC36-17 a managed file or directory first observed before IO cannot be reidentified after a same-byte or empty-directory replacement', async (t) => { const f = await fixture(t); try {
    const original = fsPromises.lstat;
    let changed = false;
    t.mock.method(fsPromises, 'lstat', async (...args: Parameters<typeof fsPromises.lstat>) => { if (!changed && String(args[0]) === join(f.source, 'inbox/database/PG_VERSION')) {
        changed = true;
        const path = join(f.source, 'inbox/database/global/pg_control'), bytes = await readFile(path);
        await rename(path, path + '.retained-unknown');
        await writeFile(path, bytes);
        const directory = join(f.source, 'inbox/database/pg_wal/archive_status');
        await rename(directory, directory + '.old-owner');
        await mkdir(directory);
    } return original(...args); });
    await assert.rejects(f.preserve(), refused);
    assert.equal(changed, true);
    assert.deepEqual(await readdir(join(f.source, 'inbox/database/pg_wal/archive_status')), []);
    assert.equal(f.opened(), 0);
}
finally {
    await f.close();
} });
