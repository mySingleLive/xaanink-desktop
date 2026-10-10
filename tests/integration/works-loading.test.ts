import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, readFile, writeFile, rename, rm, realpath } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { hostname, tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { Workspaces } from '../../desktop/service/workspaces'
import { LocalDispatcher } from '../../desktop/service/dispatcher'
import { directoryIdentity } from '../../desktop/core/root-ownership'
import { WorkLeaseRecovery, type WorkLeaseRecoveryPreview } from '../../desktop/core/work-lease-recovery'
import { CURRENT_NAMES } from '../../desktop/shared/brand-names'
import { prisma } from '../../src/lib/db'

const input = { version: 1 as const, id: randomUUID(), path: '/api/novels', method: 'GET' as const, headers: {} }
type Result = { novels: { id: string; title: string }[]; unavailableWorks: { workId: string; title: string; reason: string }[] }
const list = async (works: Workspaces) => {
  const response = await new LocalDispatcher(works).handle(input, new AbortController().signal)
  assert.equal(response.status, 200)
  return await response.json() as Result
}

test('WL-01/02/03: real databases retain healthy summaries beside stale leases; repair and retry reopen original data', { timeout: 120000 }, async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'xaanink-works-load-')))
  let works = new Workspaces(join(base, 'data'), resolve('prisma/migrations'))
  try {
    await works.initialize()
    assert.deepEqual((await list(works)).novels, [])
    const records = []
    for (const title of ['健康作品', '遗留锁作品']) {
      const path = join(base, String(records.length)); await mkdir(path)
      records.push(await works.create(await directoryIdentity(path), { title, requestId: randomUUID() }))
    }
    const [healthy, stale] = records
    await works.run(healthy.id, async () => {
      await prisma.novel.update({ where: { id: healthy.novelId }, data: { updatedAt: new Date('2026-01-01') } })
      await prisma.novel.create({ data: { title: '已删除', userId: 'local-author', status: 'DELETED' } })
      await prisma.user.create({ data: { id: 'other-author', name: '隔离作者', email: 'isolated@localhost.invalid', passwordHash: '' } })
      await prisma.novel.create({ data: { title: '其他作者', userId: 'other-author' } })
    })
    const good = await list(works)
    assert.deepEqual(good.novels.map(n => n.id), [stale.novelId, healthy.novelId])
    assert.ok(good.novels.every(n => !('premise' in n)))
    await works.close()
    const lock = join(stale.path, '.xaanink-lock'); await mkdir(lock)
    const owner = JSON.stringify({ token: randomUUID(), host: hostname(), pid: 2147483647 })
    assert.throws(() => process.kill(2147483647, 0), { code: 'ESRCH' })
    await writeFile(join(lock, 'owner.json'), owner)
    const catalog = await readFile(join(base, 'data', 'catalog.json'))
    const manifest = await readFile(join(stale.path, 'xaanink-work.json'))
    works = new Workspaces(join(base, 'data'), resolve('prisma/migrations')); await works.initialize()
    const partial = await list(works)
    assert.deepEqual(partial.novels.map(n => n.id), [healthy.novelId])
    assert.deepEqual(partial.unavailableWorks, [{ workId: stale.id, novelId: stale.novelId, title: stale.title, reason: 'stale-lease' }])
    await assert.rejects(works.run(stale.id, () => prisma.novel.count()), { code: 'WORK_LEASE_STALE' })
    assert.deepEqual(await readFile(join(base, 'data', 'catalog.json')), catalog)
    assert.deepEqual(await readFile(join(stale.path, 'xaanink-work.json')), manifest)
    assert.equal(await readFile(join(lock, 'owner.json'), 'utf8'), owner)
    await works.close()
    await rename(healthy.path, healthy.path + '-absent')
    const all = await list(works)
    assert.deepEqual(all.novels, [])
    assert.deepEqual(all.unavailableWorks.map(w => w.reason), ['unavailable', 'stale-lease'])
    assert.deepEqual(await readFile(join(base, 'data', 'catalog.json')), catalog)
    await works.close(); await rename(healthy.path + '-absent', healthy.path)
    let approved: WorkLeaseRecoveryPreview | undefined
    const recovery = new WorkLeaseRecovery({ assertHost() {}, assertWorkClosed() {}, assertConfirmed(id, work, owner) {
      assert.ok(approved); assert.equal(id, approved.requestId); assert.deepEqual(work, approved.work); assert.deepEqual(owner, approved.owner)
    }, namesForWork: () => CURRENT_NAMES })
    const preview = await recovery.prepare(await directoryIdentity(stale.path))
    // Only this synthetic fixture is explicitly approved; production uses the native confirmation.
    approved = preview
    assert.equal((await recovery.recover(preview.requestId)).status, 'recovered')
    await recovery.flush()
    const restored = await list(works)
    assert.equal(restored.novels.length, 2); assert.deepEqual(restored.unavailableWorks, [])
    assert.equal(await works.run(stale.id, () => prisma.novel.count()), 1)
    assert.deepEqual(await readFile(join(stale.path, 'xaanink-work.json')), manifest)
    assert.deepEqual(await readFile(join(base, 'data', 'catalog.json')), catalog)
  } finally {
    // The old Promise.all route rejects before its healthy sibling finishes.
    // Let that real pending read retire, preserving the original assertion error.
    for (let attempt = 0; ; attempt++) {
      try { await works.close(); break }
      catch (error) { if (attempt >= 20 || !/任务运行/.test(String(error))) throw error; await new Promise(resolve => setTimeout(resolve, 100)) }
    }
    await rm(base, { recursive: true, force: true })
  }
})

test('WL-04: catalog errors reject, and arbitrary raw errors never earn stale repair eligibility or leak details', async () => {
  const broken = { list: async () => { throw Error('catalog unavailable') } } as unknown as Workspaces
  await assert.rejects(list(broken), /catalog unavailable/)
  for (const message of ['作品已在其他进程打开', '作品已在其他进程或设备打开', 'private-directory-key WORK_LEASE_STALE']) {
    const works = { list: async () => [{ id: 'work', novelId: 'novel', title: '已关联作品' }], run: async () => { throw Error(message) } } as unknown as Workspaces
    const result = await list(works)
    assert.deepEqual(result, { novels: [], unavailableWorks: [{ workId: 'work', novelId: 'novel', title: '已关联作品', reason: 'unavailable' }] })
    assert.doesNotMatch(JSON.stringify(result), /private-directory-key/)
  }
})
