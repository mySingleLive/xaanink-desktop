import { mkdir, stat, realpath } from "node:fs/promises"
import { join, resolve } from "node:path"
import { Workspaces } from "../desktop/service/workspaces"
import { prisma } from "../src/lib/db"
import { VersionedStore } from "../desktop/core/versioned-store"
import { defaultState, stateSchema } from "../desktop/core/settings"

// Only used to arrange an isolated native-test precondition, not shipped UI data.
async function seed() {
const directory = await realpath(resolve(process.argv[2]))
const root = join(directory, "data"), path = join(directory, "work")
await mkdir(path, { recursive: true })
const info = await stat(path, { bigint: true })
const works = new Workspaces(root, resolve("prisma/migrations"))
try {
  await works.initialize()
  const state = new VersionedStore(join(root, "state.json"), defaultState, stateSchema.parse)
  const snapshot = await state.read()
  snapshot.value.settings.appearance.uiFont = "XaanInk Missing Font Fixture"
  snapshot.value.settings.appearance.bodyFont = "XaanInk Missing Font Fixture"
  await state.update(snapshot.revision, snapshot.value)
  const work = await works.create({ path, device: String(info.dev), inode: String(info.ino) }, { title: "桌面验收夹具", requestId: "native-appearance-fixture" })
  await works.run(work.id, async () => {
    const volume = await prisma.volume.create({ data: { novelId: work.novelId, title: "界面测试卷", index: 1, summary: "" } })
    const chapter = await prisma.chapter.create({ data: { volumeId: volume.id, index: 1, title: "外观测试章", outline: "", content: "用于独立桌面测试的中文正文。".repeat(35) + "\n第二行正文。", status: "WRITTEN" } })
    console.log(JSON.stringify({ novelId: work.novelId, chapterId: chapter.id }))
  })
} finally { await works.close() }

}
void seed().catch(error => { console.error(error); process.exitCode = 1 })
