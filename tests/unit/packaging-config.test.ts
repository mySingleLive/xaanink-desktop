import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {resolve, join} from 'node:path'
import {readFileSync} from 'node:fs'

const require = createRequire(import.meta.url)
const project = resolve(import.meta.dirname, '../..')
const load = () => require(join(project, 'electron-builder.config.cjs'))
const {validateConfiguration} = require('app-builder-lib/out/util/config/config.js')
const {getMainFileMatchers, getNodeModuleFileMatcher} = require('app-builder-lib/out/fileMatcher.js')
const debugLogger = {isEnabled: false}

test('专用安装配置通过已安装 builder schema，禁止签名、公证和自动发布', async () => {
  const config = load()
  await validateConfiguration(config, debugLogger)
  assert.equal(config.appId, 'ink.xaanink.desktop')
  assert.equal(config.productName, '玄印写作')
  assert.equal(config.asar, false)
  assert.equal(config.directories.output, 'release')
  assert.equal(config.mac.identity, null)
  assert.equal(config.mac.notarize, false)
  assert.equal(config.forceCodeSigning, false)
  assert.equal(config.dmg.sign, false)
  assert.equal(config.publish, null)
  assert.equal(config.win.signAndEditExecutable, true)
  assert.equal(config.win.signExecutable, false)
})

test('实际 builder 项目 matcher 保留所有必要入口与离线资源，排除作者数据和撤销入口', () => {
  const config = load()
  const packager = {info: {config, projectDir: project, buildResourcesDir: 'build', isPrepackedAppAsar: false, debugLogger}}
  const matchers = getMainFileMatchers(project, '/tmp/packaging-matcher-output', (value: string) => value.replaceAll('${arch}', 'arm64'), config.mac, packager, join(project, 'release'), false)
  const allowed = (path: string, directory = false) => matchers.some((matcher: any) => matcher.createFilter()(join(project, path), {isDirectory: () => directory}))
  for (const path of ['dist/main/index.cjs', 'dist/service/index.cjs', 'dist/preload/index.cjs', 'dist/preload/maintenance.cjs', 'dist/preload/root-relocation.cjs', 'out/index.html', 'out/_next/static/media/editor.worker.hash.js', 'out/fonts/noto-sans-sc/NotoSansSC-Regular.ttf.gz', 'out/brands/providers/zai.svg', 'prisma/migrations/20260909130000_novel_creation_request/migration.sql', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'runtime-licenses/LobeHub-Icons-MIT.txt', 'package.json']) assert.equal(allowed(path), true, path)
  for (const path of ['dist', 'dist/main', 'out', 'out/_next', 'prisma', 'prisma/migrations', 'runtime-licenses']) assert.equal(allowed(path, true), true, path)
  for (const path of ['design/desktop-preview.html', 'docs/evidence/private.log', 'tests/retired/backups/source/main.ts', 'scripts/smoke-application-backup.mjs', 'src/app/page.tsx', '.env', '.env.local', 'work/database/PG_VERSION', '.xuanxiang/settings.json', 'out/author.sqlite3', 'out/data/author.db', 'out/database/PG_VERSION', 'dist/main/index.cjs.map', 'dist/service/application-restore-worker.cjs', 'dist/preload/application-restore.cjs', 'release/mac-arm64/玄印写作.app/Contents/Info.plist']) assert.equal(allowed(path), false, path)
  for (const family of ['xuanxiang','xaanink']) for(const prefix of ['out','out/subdir']) for(const name of [`.${family}`,`.${family}-storage`]) assert.equal(allowed(`${prefix}/${name}/settings.json`),false,`${prefix}/${name}`)
})

test('生产依赖 matcher 不删 WASM/数据/许可证，也不默认收集源码映射', () => {
  const config = load()
  const matcher = getNodeModuleFileMatcher(project, '/tmp/packaging-matcher-output', (value: string) => value, config.mac, {config, debugLogger})
  const filter = matcher.createFilter()
  for (const path of ['node_modules/@electric-sql/pglite/dist/pglite.wasm', 'node_modules/@electric-sql/pglite/dist/pglite.data', 'node_modules/@prisma/client/runtime/query_compiler_fast_bg.postgresql.wasm-base64.js', 'node_modules/sharp/LICENSE', 'node_modules/next/LICENSE.md']) assert.equal(filter(join(project, path), {isDirectory: () => false}), true, path)
  for (const path of ['node_modules/next/dist/client/app.js.map', 'node_modules/sharp/test/private.png', 'node_modules/ai/tests/fixture.json']) assert.equal(filter(join(project, path), {isDirectory: () => false}), false, path)
})

test('本地 Electron 预检真实版本/架构，架构或系统不匹配在 builder 前拒绝', async () => {
  const {inspectLocalRuntime} = await import('../../scripts/packaging-runtime.mjs')
  const current = await inspectLocalRuntime(project, process.platform, process.arch)
  const electron = JSON.parse(readFileSync(join(project, 'node_modules/electron/package.json'), 'utf8'))
  assert.equal(current.version, electron.version)
  assert.equal(current.arch, process.arch)
  assert.equal(current.platform, process.platform)
  assert.match(current.electronDist, /node_modules\/electron\/dist$/)
  const otherArch = process.arch === 'arm64' ? 'x64' : 'arm64'
  await assert.rejects(inspectLocalRuntime(project, process.platform, otherArch), /架构|architecture/)
  await assert.rejects(inspectLocalRuntime(project, process.platform === 'darwin' ? 'win32' : 'darwin', process.arch), /系统|platform/)
})
