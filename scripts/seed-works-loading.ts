// Synthetic data only; never accepts an existing application root.
import assert from 'node:assert/strict'
import { mkdir, realpath, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { hostname } from 'node:os'
import { randomUUID } from 'node:crypto'
import { Workspaces } from '../desktop/service/workspaces'
import { directoryIdentity } from '../desktop/core/root-ownership'
import { prisma } from '../src/lib/db'

async function main() {
  const base = await realpath(resolve(process.argv[2]))
  assert(basename(base).startsWith('xaanink-works-loading-'))
  const works = new Workspaces(join(base, 'data'), resolve('prisma/migrations'))
  const records = []
  try {
    await works.initialize()
    for (const title of ['专项健康作品', '专项遗留锁作品']) {
      const path = join(base, 'work-' + records.length); await mkdir(path)
      const work = await works.create(await directoryIdentity(path), { title, requestId: randomUUID() })
      const chapter = await works.run(work.id, async () => {
        const volume = await prisma.volume.create({ data: { novelId: work.novelId, title: '专项卷', index: 1, summary: '' } })
        return prisma.chapter.create({ data: { volumeId: volume.id, index: 1, title: '专项章', outline: '', content: '仅隔离测试使用的原作品内容' } })
      })
      records.push({ ...work, chapterId: chapter.id })
    }
  } finally { await works.close() }
  assert.throws(() => process.kill(2147483647, 0), { code: 'ESRCH' })
  const lock = join(records[1].path, '.xaanink-lock'); await mkdir(lock)
  await writeFile(join(lock, 'owner.json'), JSON.stringify({ token: randomUUID(), host: hostname(), pid: 2147483647 }))
  await writeFile(join(base, 'fixture.json'), JSON.stringify({ root: works.root, records }))
  console.log('Isolated works-loading fixture prepared: 2 real works, 1 stale lease, zero models.')
}
void main().catch(error => { console.error(error); process.exitCode = 1 })
