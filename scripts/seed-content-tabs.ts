// Real chapter records and workspace draft, solely in a fresh isolated test root.
import assert from 'node:assert/strict'
import { mkdir, realpath, stat, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Workspaces } from '../desktop/service/workspaces'
import { prisma } from '../src/lib/db'
import { DraftJournal } from '../desktop/main/draft-journal'
import { workspaceTabSchema } from '../src/lib/desktop/workspace-draft-source'

async function main() {
  const directory = await realpath(resolve(process.argv[2]))
  assert(basename(directory).startsWith('xaanink-tabs-'), 'Fresh isolated ContentTabs test directory required')
  const root = join(directory, 'data'), path = join(directory, 'work')
  await mkdir(path, { recursive: true })
  const info = await stat(path, { bigint: true })
  const works = new Workspaces(root, resolve('prisma/migrations'))
  try {
    console.log('ContentTabs fixture: initializing isolated application catalog.')
    await works.initialize()
    console.log('ContentTabs fixture: creating isolated real work database.')
    const work = await works.create({ path, device: String(info.dev), inode: String(info.ino) }, { title: '标签专项验证作品', requestId: randomUUID() })
    const chapters = await works.run(work.id, async () => {
      console.log('ContentTabs fixture: creating real volume and 19 chapter records in one batch.')
      const volume = await prisma.volume.create({ data: { novelId: work.novelId, title: '专项验证卷', index: 1, summary: '' } })
      const records = []
      for (let index = 1; index <= 19; index++) {
        const title = index === 1 ? '正文验证' : index === 2 ? '用于验证渐隐显示的长标题与 English mixed words 应保持关闭入口可见并允许在菜单中完整阅读' : '专项章' + index
        records.push({ id: randomUUID(), volumeId: volume.id, index, title, outline: '', content: '# ' + title + '\n\n隔离目录中的合成正文，用于验证标签排序与编辑实例。\n\n第二段正文。', status: 'WRITTEN' as const })
      }
      await prisma.chapter.createMany({ data: records })
      return prisma.chapter.findMany({ where: { volumeId: volume.id }, orderBy: { index: 'asc' } })
    })
    assert.equal(chapters.length, 19)
    const tabs = [workspaceTabSchema.parse({ id: 'novel:' + work.novelId, type: 'novel', novelId: work.novelId, title: '普通内容验证' }), ...chapters.map(chapter => workspaceTabSchema.parse({ id: 'chapter-content:' + chapter.id, type: 'chapter-content', novelId: work.novelId, refId: chapter.id, title: chapter.title }))]
    const journal = new DraftJournal(root), release = journal.activate('content-tabs-fixture')
    console.log('ContentTabs fixture: persisting validated workspace draft.')
    try {
      await journal.persist('content-tabs-fixture', { version: 1, revision: 1, createdAt: new Date().toISOString(), autosaves: [], issues: [], sources: { workspace: { version: 1, tabs, activeTabId: tabs[1].id, subTabs: {}, layout: { version: 1, narrowPane: 'content', contentVisible: true, sidebarVisible: true, chatVisible: true, sizes: { sidebar: 20, chat: 25, content: 55 }, lastContentSize: 55, lastSidebarSize: 20, lastChatSize: 25 } } } })
    } finally { release() }
    await writeFile(join(directory, 'fixture.json'), JSON.stringify({ novelId: work.novelId, tabs, activeTabId: tabs[1].id }, null, 2) + '\n')
    console.log('Isolated ContentTabs fixture prepared: 20 real workspace tabs, 19 real chapter records, zero models.')
  } finally {
    console.log('ContentTabs fixture: closing isolated database connections.')
    await works.close()
    console.log('ContentTabs fixture: all isolated database connections closed.')
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1 })
