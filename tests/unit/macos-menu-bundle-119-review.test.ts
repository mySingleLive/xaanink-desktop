import assert from 'node:assert/strict'
import {test} from 'node:test'
import {createRequire} from 'node:module'
import {mkdtemp, mkdir, writeFile, readFile, readdir, realpath, stat, unlink, symlink, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

const require = createRequire(import.meta.url)
require('app-builder-lib') // Initialize the installed builder's circular module graph.
const {MacPackager} = require('app-builder-lib/out/macPackager.js')
const {createMacApp} = require('app-builder-lib/out/electron/electronMac.js')
const {savePlistFile, parsePlistFile} = require('app-builder-lib/out/util/plist.js')
const config = require('../../electron-builder.config.cjs')
const expectedLocalization = Buffer.from('"CFBundleName" = "玄印";\n', 'utf8')

async function localizedFixture() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'xuanxiang-localization119-')))
  const resources = join(directory, 'Contents/Resources')
  await mkdir(join(resources, 'en.lproj'), {recursive: true})
  await mkdir(join(resources, 'zh_CN.lproj'))
  return {directory, resources}
}

test('MB119-R01 actual createMacApp helpers must match Electron44 CFBundleName lookup without renaming the full app executable', {timeout: 5000}, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'xuanxiang-menu119-'))
  try {
    const contents = join(directory, 'Electron.app/Contents')
    const suffixes = [' Helper', ' Helper (Renderer)', ' Helper (GPU)', ' Helper (Plugin)']
    await mkdir(join(contents, 'MacOS'), {recursive: true})
    await mkdir(join(contents, 'Resources'), {recursive: true})
    await writeFile(join(contents, 'MacOS/Electron'), 'Non-executable isolated filename fixture; never launched.')
    await savePlistFile(join(contents, 'Info.plist'), {CFBundleName: 'Electron', CFBundleExecutable: 'Electron', CFBundleIdentifier: 'com.github.Electron'})
    for (const suffix of suffixes) {
      const helper = join(contents, 'Frameworks', `Electron${suffix}.app/Contents`)
      await mkdir(join(helper, 'MacOS'), {recursive: true})
      await writeFile(join(helper, 'MacOS', `Electron${suffix}`), 'Non-executable isolated helper filename fixture; never launched.')
      await savePlistFile(join(helper, 'Info.plist'), {CFBundleName: `Electron${suffix}`, CFBundleExecutable: `Electron${suffix}`})
    }
    const host = {
      appInfo: {productName: config.productName, sanitizedProductName: config.productName, productFilename: config.productName, version: '0.1.0', buildVersion: '0.1.0', macBundleIdentifier: config.appId},
      config, platformSpecificBuildOptions: config.mac,
      info: {config, framework: {distMacOsAppName: 'Electron.app'}},
      fileAssociations: [], getIconPath: async () => null, getResource: async () => null,
      applyCommonInfo: MacPackager.prototype.applyCommonInfo,
    }
    await createMacApp(host, directory, null, false)
    const app = join(directory, '玄印写作.app'), frameworks = join(app, 'Contents/Frameworks')
    const plist = await parsePlistFile(join(app, 'Contents/Info.plist'))
    assert.equal(plist.CFBundleExecutable, '玄印写作')
    assert.equal(plist.CFBundleDisplayName, '玄印写作')
    assert.equal(plist.CFBundleVersion, '0.1.0')
    assert.equal(plist.CFBundleShortVersionString, '0.1.0')
    assert.equal(plist.CFBundleIdentifier, config.appId)
    assert((await stat(join(app, 'Contents/MacOS/玄印写作'))).isFile())
    const actual = await readdir(frameworks)
    // Electron44 OverrideChildProcessPath first tries its built-in brand, then
    // GetApplicationName(), which reads the non-localized CFBundleName key.
    for (const suffix of suffixes) {
      const candidates = ['Electron', plist.CFBundleName].map(name => `${name}${suffix}.app`)
      const found = candidates.find(name => actual.includes(name))
      assert(found, `Missing Electron44 helper lookup candidate ${candidates.join(' or ')}; actual: ${actual.join(', ')}`)
      const helper = join(frameworks, found!, 'Contents'), info = await parsePlistFile(join(helper, 'Info.plist'))
      assert((await stat(join(helper, 'MacOS', info.CFBundleExecutable))).isFile())
      assert.equal(info.CFBundleVersion, plist.CFBundleVersion)
    }
  } finally {
    await rm(directory, {recursive: true, force: true})
  }
})

test('MB119-N02 actual localization install covers each native locale and rejects missing or additional metadata', {timeout: 5000}, async () => {
  const {installMacMenuLocalization, verifyMacMenuLocalization} = await import('../../scripts/macos-menu-localization.mjs')
  const {directory, resources} = await localizedFixture()
  try {
    await mkdir(join(resources, 'es_419.lproj'))
    assert.deepEqual(await installMacMenuLocalization(directory), {locales: 3, menuName: '玄印', runtimeName: '玄印写作'})
    for (const name of ['en.lproj', 'zh_CN.lproj', 'es_419.lproj']) {
      assert((await readFile(join(resources, name, 'InfoPlist.strings'))).equals(expectedLocalization))
    }
    const path = join(resources, 'zh_CN.lproj/InfoPlist.strings')
    await writeFile(path, Buffer.concat([expectedLocalization, Buffer.from('"CFBundleDisplayName" = "other";\n')]))
    await assert.rejects(verifyMacMenuLocalization(directory), /unexpected native menu localization/)
    await unlink(path)
    await assert.rejects(verifyMacMenuLocalization(directory), {code: 'ENOENT'})
  } finally {await rm(directory, {recursive: true, force: true})}
})

test('MB119-N03 locale and metadata links are rejected and existing metadata is never overwritten', {timeout: 5000}, async () => {
  const {installMacMenuLocalization, verifyMacMenuLocalization} = await import('../../scripts/macos-menu-localization.mjs')
  const {directory, resources} = await localizedFixture()
  try {
    const outside = join(directory, 'owned-sibling')
    await mkdir(outside)
    await rm(join(resources, 'en.lproj'), {recursive: true})
    await symlink(outside, join(resources, 'en.lproj'))
    await assert.rejects(installMacMenuLocalization(directory), /Unsafe native locale/)
    assert.deepEqual(await readdir(outside), [])
    await unlink(join(resources, 'en.lproj'))
    await mkdir(join(resources, 'en.lproj'))
    const path = join(resources, 'en.lproj/InfoPlist.strings')
    await writeFile(path, 'owned existing metadata sentinel')
    await assert.rejects(installMacMenuLocalization(directory), {code: 'EEXIST'})
    assert.equal(await readFile(path, 'utf8'), 'owned existing metadata sentinel')
    await unlink(path)
    await installMacMenuLocalization(directory)
    const target = join(outside, 'valid-but-linked.strings')
    await writeFile(target, expectedLocalization)
    await unlink(path)
    await symlink(target, path)
    await assert.rejects(verifyMacMenuLocalization(directory), /unexpected native menu localization/)
    assert((await readFile(target)).equals(expectedLocalization))
  } finally {await rm(directory, {recursive: true, force: true})}
})

test('MB119-N04 actual inspector rejects wrong raw runtime, display, executable or version metadata before resource probes', {timeout: 5000}, async () => {
  const {inspectPackagedApp} = await import('../../scripts/inspect-packaged-app.mjs')
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'xuanxiang-plist119-')))
  try {
    const project = join(directory, 'project'), app = join(directory, '玄印写作.app')
    await mkdir(project)
    await mkdir(join(app, 'Contents/Resources/app'), {recursive: true})
    await writeFile(join(project, 'package.json'), JSON.stringify({version: '0.1.0'}))
    await writeFile(join(app, 'Contents/Resources/app/package.json'), JSON.stringify({version: '0.1.0', main: 'dist/main/index.cjs'}))
    const valid = {CFBundleIdentifier: config.appId, CFBundleName: '玄印写作', CFBundleDisplayName: '玄印写作', CFBundleExecutable: '玄印写作', CFBundleVersion: '0.1.0', CFBundleShortVersionString: '0.1.0'}
    for (const [key, value] of [['CFBundleName', '玄印'], ['CFBundleDisplayName', 'other'], ['CFBundleExecutable', 'other'], ['CFBundleVersion', '2.0.0']]) {
      await savePlistFile(join(app, 'Contents/Info.plist'), {...valid, [key!]: value})
      await assert.rejects(inspectPackagedApp(project, app), new RegExp(`Info.plist.*${key}`))
    }
  } finally {await rm(directory, {recursive: true, force: true})}
})

test('MB119-N05 actual createMacApp output with no locale directories safely receives both required localizations', {timeout: 5000}, async () => {
  const {installMacMenuLocalization, verifyMacMenuLocalization} = await import('../../scripts/macos-menu-localization.mjs')
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'xuanxiang-empty-locales119-')))
  try {
    const contents = join(directory, 'Electron.app/Contents')
    const helper = join(contents, 'Frameworks/Electron Helper.app/Contents')
    await mkdir(join(contents, 'MacOS'), {recursive: true})
    await mkdir(join(contents, 'Resources/app'), {recursive: true})
    await mkdir(join(helper, 'MacOS'), {recursive: true})
    await writeFile(join(contents, 'MacOS/Electron'), 'Non-executable isolated filename fixture; never launched.')
    await writeFile(join(helper, 'MacOS/Electron Helper'), 'Non-executable isolated helper filename fixture; never launched.')
    await writeFile(join(contents, 'Resources/default_app.asar'), 'retained resource sentinel')
    await savePlistFile(join(contents, 'Info.plist'), {CFBundleName: 'Electron', CFBundleExecutable: 'Electron', CFBundleIdentifier: 'com.github.Electron'})
    await savePlistFile(join(helper, 'Info.plist'), {CFBundleName: 'Electron Helper', CFBundleExecutable: 'Electron Helper'})
    const host = {
      appInfo: {productName: config.productName, sanitizedProductName: config.productName, productFilename: config.productName, version: '0.1.0', buildVersion: '0.1.0', macBundleIdentifier: config.appId},
      config, platformSpecificBuildOptions: config.mac,
      info: {config, framework: {distMacOsAppName: 'Electron.app'}},
      fileAssociations: [], getIconPath: async () => null, getResource: async () => null,
      applyCommonInfo: MacPackager.prototype.applyCommonInfo,
    }
    await createMacApp(host, directory, null, false)
    const app = join(directory, '玄印写作.app'), resources = join(app, 'Contents/Resources')
    assert.equal((await readdir(resources)).filter(name => name.endsWith('.lproj')).length, 0)
    assert.deepEqual(await installMacMenuLocalization(app), {locales: 2, menuName: '玄印', runtimeName: '玄印写作'})
    assert.deepEqual(await verifyMacMenuLocalization(app), {locales: 2, menuName: '玄印', runtimeName: '玄印写作'})
    for (const locale of ['en.lproj', 'zh_CN.lproj']) assert((await readFile(join(resources, locale, 'InfoPlist.strings'))).equals(expectedLocalization))
    assert.equal(await readFile(join(resources, 'default_app.asar'), 'utf8'), 'retained resource sentinel')
    const info = await parsePlistFile(join(app, 'Contents/Info.plist'))
    assert.equal(info.CFBundleName, '玄印写作')
    assert.equal(info.CFBundleExecutable, '玄印写作')
    assert.equal(info.CFBundleDisplayName, '玄印写作')
  } finally {await rm(directory, {recursive: true, force: true})}
})
