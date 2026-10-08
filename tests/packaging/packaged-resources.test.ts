import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, cp, rm, readFile} from 'node:fs/promises'
import {join, resolve} from 'node:path'
import {tmpdir} from 'node:os'
import {createRequire} from 'node:module'
import {createHash} from 'node:crypto'

const project = resolve(import.meta.dirname, '../..')
const app = join(project, 'release/mac-arm64/玄印写作.app')
const require = createRequire(import.meta.url)

test('实际 macOS app 内容、版本、入口、资源、架构与输入一致', {timeout: 90000}, async () => {
  const {inspectPackagedApp} = await import('../../scripts/inspect-packaged-app.mjs')
  const result = await inspectPackagedApp(project, app)
  assert.equal(result.version, '0.1.0')
  assert.equal(result.arch, 'arm64')
  assert.equal(result.bundleId, 'ink.xaanink.desktop')
  assert.equal(result.productionModulesIncludeNextAndPrisma, true)
  assert(result.files.length > 500)
  assert(result.projectResources >= 200)
})

test('真实资源拷贝缺少 service worker 时，验包必须失败', {timeout: 30000}, async () => {
  const {verifyProjectResources} = await import('../../scripts/inspect-packaged-app.mjs')
  const fixture = await mkdtemp(join(tmpdir(), 'xuanxiang-package-missing-'))
  let passed = false
  try {
    const original = join(app, 'Contents/Resources/app')
    for (const entry of ['dist', 'out', 'prisma', 'runtime-licenses', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'package.json']) await cp(join(original, entry), join(fixture, entry), {recursive: true})
    await verifyProjectResources(project, fixture)
    await rm(join(fixture, 'dist/service/index.cjs'))
    await assert.rejects(verifyProjectResources(project, fixture), /dist\/service\/index\.cjs/)
    passed = true
  } finally {
    if (passed) await rm(fixture, {recursive: true})
    else console.error('保留失败资源 fixture:', fixture)
  }
})

test('实际 ICNS/ICO 各尺寸解码，原品牌与许可来源指纹不变', async () => {
  const sharp = require('sharp')
  const icns = await readFile(join(project, 'build/icon.icns'))
  assert.equal(icns.toString('ascii', 0, 4), 'icns')
  assert.equal(icns.readUInt32BE(4), icns.length)
  let position = 8, chunks = 0
  while (position < icns.length) {
    const length = icns.readUInt32BE(position + 4)
    const metadata = await sharp(icns.subarray(position + 8, position + length)).metadata()
    assert.equal(metadata.format, 'png')
    assert.equal(metadata.width, metadata.height)
    assert([64, 128, 256, 512, 1024].includes(metadata.width))
    position += length; chunks++
  }
  assert.equal(position, icns.length); assert.equal(chunks, 8)
  const ico = await readFile(join(project, 'build/icon.ico'))
  assert.equal(ico.readUInt16LE(2), 1); assert.equal(ico.readUInt16LE(4), 6)
  for (let index = 0; index < 6; index++) {
    const offset = 6 + index * 16, size = ico[offset] || 256
    const start = ico.readUInt32LE(offset + 12), length = ico.readUInt32LE(offset + 8)
    const metadata = await sharp(ico.subarray(start, start + length)).metadata()
    assert.equal(metadata.width, size); assert.equal(metadata.height, size)
  }
  const provenance = JSON.parse(await readFile(join(project, 'runtime-licenses/provenance.json'), 'utf8'))
  const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
  assert.equal(provenance.brandSource.sha256, sha(await readFile(join(project, provenance.brandSource.path))))
  for (const item of provenance.resources) {
    assert.equal(sha(await readFile(join(project, item.packagedPath))), item.sha256)
    assert.equal(sha(await readFile(join(project, item.source))), item.sha256)
  }
})

test('包内真实依赖零父项目回退，Sharp转码、PGlite内存查询及关闭成功', {timeout: 55000}, async () => {
  const {verifyPackagedDependencies} = await import('../../scripts/inspect-packaged-app.mjs')
  const result = await verifyPackagedDependencies(join(app, 'Contents/Resources/app'))
  assert.equal(result.pgliteClosed, true)
  assert.equal(result.queryResult, 42)
  assert.equal(result.sharp.format, 'png')
  assert.equal(result.compilerWasmMagic, '0061736d')
  assert(result.resolvedModules.length > 20)
  assert.equal(result.exitCode, 0)
  assert.equal(result.forcedTermination, false)
})
