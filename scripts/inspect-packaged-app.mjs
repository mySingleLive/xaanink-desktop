import {verifyMacMenuLocalization} from './macos-menu-localization.mjs'
import {readFile, readdir, lstat, realpath, mkdtemp, writeFile, rm} from 'node:fs/promises'
import {join, relative, resolve, dirname, sep} from 'node:path'
import {tmpdir} from 'node:os'
import {createHash} from 'node:crypto'
import {createRequire, isBuiltin} from 'node:module'
import {fileURLToPath, pathToFileURL} from 'node:url'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'

const execute = promisify(execFile)
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const inside = (root, path) => path === root || path.startsWith(root + sep)
const entries = ['dist/main/index.cjs', 'dist/service/index.cjs', 'dist/preload/index.cjs', 'dist/preload/maintenance.cjs', 'dist/preload/root-relocation.cjs']

async function walk(root, directory = root, files = []) {
  for (const name of (await readdir(directory)).sort()) {
    const path = join(directory, name), stat = await lstat(path)
    if (stat.isSymbolicLink()) {
      if (!inside(await realpath(root), await realpath(path))) throw new Error(`包内符号链接指向包外：${relative(root, path)}`)
      files.push({path, link: true})
    } else if (stat.isDirectory()) await walk(root, path, files)
    else if (stat.isFile()) files.push({path, link: false})
    else throw new Error(`包内非普通文件：${relative(root, path)}`)
  }
  return files
}

export async function verifyProjectResources(project, appRoot) {
  const root = await realpath(appRoot)
  const packaged = (await walk(root)).map(file => relative(root, file.path).split(sep).join('/'))
  const allowed = path => entries.includes(path) || path.startsWith('out/') || path.startsWith('prisma/migrations/') || path.startsWith('runtime-licenses/') || ['package.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md'].includes(path)
  for (const path of packaged) {
    if (path.endsWith('.map') || /(^|\/)\.env(\.|$)/.test(path) || /\.(db(?:-shm|-wal)?|sqlite3?(?:-shm|-wal)?)$/.test(path) || /(^|\/)PG_VERSION$/.test(path) || /^out\/(?:.*\/)?(?:database|backups|\.(?:xuanxiang|xaanink)(?:-storage)?)\//.test(path)) throw new Error(`包中含禁止的文件：${path}`)
    if (!path.startsWith('node_modules/') && !allowed(path)) throw new Error(`包中含禁止的项目文件：${path}`)
    if (/^node_modules\/.*\/(test|tests|__tests__|example|examples)\//.test(path)) throw new Error(`包中含依赖开发资源：${path}`)
  }
  const expected = [...entries, 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'out/index.html', 'out/fonts/noto-sans-sc/NotoSansSC-Regular.ttf.gz', 'out/brand/logo-icon-paper.svg', 'runtime-licenses/provenance.json']
  for (const directory of ['out', 'prisma/migrations', 'runtime-licenses']) for (const file of await walk(join(project, directory))) {
    const path = `${directory}/${relative(join(project, directory), file.path).split(sep).join('/')}`
    if (!path.endsWith('.map') && !expected.includes(path)) expected.push(path)
  }
  if (!expected.some(path => path.startsWith('prisma/migrations/') && path.endsWith('/migration.sql'))) throw new Error('迁移SQL输入缺失')
  for (const path of expected) {
    const actual = await readFile(join(root, path)).catch(error => {throw new Error(`运行资源缺失：${path}`, {cause: error})})
    if (hash(actual) !== hash(await readFile(join(project, path)))) throw new Error(`运行资源与输入不一致：${path}`)
  }
  if (!packaged.some(path => /^out\/_next\/static\/media\/editor\.worker\..+\.js$/.test(path))) throw new Error('Monaco 离线 worker 缺失')
  return {projectResources: expected.length, packaged}
}

function externalDependencies(source, typescript) {
  const tree = typescript.createSourceFile('bundle.cjs', source, typescript.ScriptTarget.Latest, true, typescript.ScriptKind.JS)
  const names = new Set()
  function visit(node) {
    if (typescript.isCallExpression(node) && node.arguments.length === 1 && typescript.isStringLiteral(node.arguments[0]) && (node.expression.kind === typescript.SyntaxKind.ImportKeyword || (typescript.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      const name = node.arguments[0].text
      if (!name.startsWith('.') && !name.startsWith('/') && !isBuiltin(name) && name !== 'electron') names.add(name)
    }
    typescript.forEachChild(node, visit)
  }
  visit(tree)
  return [...names].sort()
}

export async function inspectPackagedApp(project, appPath) {
  if (process.platform !== 'darwin') throw new Error('当前实际 app 静态验包仅支持 macOS；Windows 留待对应机器验证')
  const app = await realpath(appPath), appRoot = join(app, 'Contents/Resources/app')
  const {stdout} = await execute('/usr/bin/plutil', ['-convert', 'json', '-o', '-', join(app, 'Contents/Info.plist')], {timeout: 10000})
  const info = JSON.parse(stdout)
  const metadata = JSON.parse(await readFile(join(project, 'package.json'), 'utf8'))
  const packagedMetadata = JSON.parse(await readFile(join(appRoot, 'package.json'), 'utf8'))
  for (const [key, value] of Object.entries({CFBundleIdentifier: 'ink.xaanink.desktop', CFBundleName: '玄印写作', CFBundleDisplayName: '玄印写作', CFBundleShortVersionString: metadata.version, CFBundleVersion: metadata.version, CFBundleExecutable: '玄印写作'})) if (info[key] !== value) throw new Error(`实际 Info.plist 错误：${key}`)
  if (packagedMetadata.version !== metadata.version || packagedMetadata.main !== 'dist/main/index.cjs') throw new Error('实际包 metadata 与入口/版本不一致')
  const nativeMenu=await verifyMacMenuLocalization(app)
  const resources = await verifyProjectResources(project, appRoot)
  const toolRequire = createRequire(join(project, 'package.json'))
  const typescript = toolRequire('typescript')
  const externalModules = []
  for (const entry of entries) {
    const fromPackage = createRequire(join(appRoot, entry))
    for (const name of externalDependencies(await readFile(join(appRoot, entry), 'utf8'), typescript)) {
      const modulePath = await realpath(fromPackage.resolve(name))
      if (!inside(appRoot, modulePath)) throw new Error(`依赖从包外解析：${entry} -> ${name}`)
      externalModules.push({entry, name, path: relative(appRoot, modulePath)})
    }
  }
  for (const name of ['@electric-sql/pglite/dist/pglite.wasm', '@electric-sql/pglite/dist/pglite.data', '@prisma/client/runtime/query_compiler_fast_bg.postgresql.wasm-base64.js', 'sharp/LICENSE', '@electric-sql/pglite/LICENSE', 'monaco-editor/LICENSE']) {
    if (!(await readFile(join(appRoot, 'node_modules', name))).length) throw new Error(`生产依赖资源空缺：${name}`)
  }
  const binaryPaths = [join(app, 'Contents/MacOS', info.CFBundleExecutable)]
  const files = []
  for (const file of await walk(app)) {
    const path = relative(app, file.path).split(sep).join('/')
    if (file.link) {files.push({path, symbolicLinkTarget: relative(app, await realpath(file.path))}); continue}
    const bytes = await readFile(file.path)
    files.push({path, bytes: bytes.length, sha256: hash(bytes)})
    if (/\.(node|dylib)$/.test(path) || path.endsWith('/Electron Framework')) binaryPaths.push(file.path)
  }
  const architectures = []
  for (const path of binaryPaths) {
    const {stdout} = await execute('/usr/bin/lipo', ['-archs', path], {timeout: 10000})
    if (!stdout.trim().split(/\s+/).includes(process.arch === 'x64' ? 'x86_64' : process.arch)) throw new Error(`实际运行包含错误架构：${relative(app, path)}`)
    architectures.push({path: relative(app, path), architectures: stdout.trim().split(/\s+/)})
  }
  return {format: 'xaanink-macos-static-package-check', schemaVersion: 1, scope: 'Static .app contents and dependencies only; no Electron execution/native acceptance', checkedAt: new Date().toISOString(), app, version: metadata.version, bundleId: info.CFBundleIdentifier, nativeMenu, arch: process.arch, projectResources: resources.projectResources, productionModulesIncludeNextAndPrisma: resources.packaged.includes('node_modules/next/package.json') && resources.packaged.includes('node_modules/prisma/package.json'), externalModules, architectures, files}
}

export async function verifyPackagedDependencies(appRoot) {
  const temporary = await mkdtemp(join(tmpdir(), 'xaanink-package-resources-'))
  const environment = {...process.env}
  delete environment.NODE_PATH
  let passed = false
  try {
    const {stdout, stderr} = await execute(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), 'packaged-resource-probe.cjs'), await realpath(appRoot)], {cwd: temporary, env: environment, timeout: 45000, killSignal: 'SIGKILL', maxBuffer: 2 * 1024 * 1024})
    if (stderr.trim()) throw new Error(`包内资源检查异常：${stderr}`)
    const result = JSON.parse(stdout)
    if (!result.pgliteClosed) throw new Error('包内 PGlite 未正常关闭')
    passed = true
    return {...result, exitCode: 0, forcedTermination: false}
  } catch (error) {
    await writeFile(join(temporary, 'failure.json'), JSON.stringify({error: String(error), stdout: error.stdout, stderr: error.stderr, forcedTermination: !!error.killed, scope: 'Resource probe, not Electron or author data'}, null, 2) + '\n')
    throw new Error(`包内资源检查失败，保留 ${temporary}`, {cause: error})
  } finally {if (passed) await rm(temporary, {recursive: true})}
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const project = dirname(dirname(fileURLToPath(import.meta.url)))
  const app = process.argv[2] ? resolve(process.argv[2]) : join(project, `release/mac-${process.arch}/玄印写作.app`)
  const manifest = await inspectPackagedApp(project, app)
  const dependencies = await verifyPackagedDependencies(join(app, 'Contents/Resources/app'))
  const output = join(project, 'release/package-static-manifest.json')
  await writeFile(output, JSON.stringify({...manifest, dependencies}, null, 2) + '\n')
  console.log(JSON.stringify({passed: true, scope: manifest.scope, version: manifest.version, arch: manifest.arch, files: manifest.files.length, projectResources: manifest.projectResources, externalModules: manifest.externalModules.length, output}, null, 2))
}
