import test from 'node:test'
import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {readFile, mkdtemp, writeFile, rm} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {join, resolve} from 'node:path'
import {tmpdir} from 'node:os'
import JSZip from 'jszip'

const execute = promisify(execFile)
const project = resolve(import.meta.dirname, '../..')
const zip = join(project, 'release/XaanInk-0.1.0-mac-arm64.zip')
const app = join(project, 'release/mac-arm64/玄印写作.app')
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

test('实际 ZIP 全部条目 CRC 通过、路径安全且文件表与实际.app一致', {timeout: 90000}, async () => {
  const {inspectPackagedApp} = await import('../../scripts/inspect-packaged-app.mjs')
  const manifest = await inspectPackagedApp(project, app)
  await execute('/usr/bin/unzip', ['-tqq', zip], {timeout: 55000, maxBuffer: 1024 * 1024})
  // macOS unzip masks Chinese filenames with '?' under the tool's LC_CTYPE=C.
  // Read actual UTF-8 ZIP names; retain unzip for the independent full CRC pass.
  const archive = await JSZip.loadAsync(await readFile(zip))
  const paths = Object.values(archive.files).map(entry => entry.unsafeOriginalName ?? entry.name)
  assert(paths.every(path => path.startsWith('玄印写作.app/') && !path.split('/').includes('..')))
  const files = paths.filter(path => !path.endsWith('/')).map(path => path.slice('玄印写作.app/'.length)).sort()
  assert.deepEqual(files, manifest.files.map(file => file.path).sort())
  for (const path of ['Contents/Info.plist', 'Contents/MacOS/玄印写作', 'Contents/Resources/app/dist/main/index.cjs', 'Contents/Resources/app/dist/service/index.cjs', 'Contents/Resources/app/runtime-licenses/provenance.json']) {
    const entry = archive.file(`玄印写作.app/${path}`)
    assert(entry, path)
    const bytes = await entry.async('nodebuffer')
    assert.equal(sha(bytes), sha(await readFile(join(app, path))), path)
  }
})

test('真实ZIP的截断拷贝必须被CRC/目录检查拒绝', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'xuanxiang-package-truncated-'))
  let passed = false
  try {
    const damaged = join(temporary, 'truncated.zip')
    const source = await readFile(zip)
    await writeFile(damaged, source.subarray(0, 512))
    await assert.rejects(execute('/usr/bin/unzip', ['-tqq', damaged], {timeout: 10000}))
    passed = true
  } finally {if (passed) await rm(temporary, {recursive: true}); else console.error('保留失败archive fixture:', temporary)}
})
