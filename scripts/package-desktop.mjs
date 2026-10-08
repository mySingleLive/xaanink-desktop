import {fileURLToPath} from 'node:url'
import {dirname, join} from 'node:path'
import {createRequire} from 'node:module'
import {build, Platform} from 'electron-builder'
import {Arch} from 'builder-util'
import {inspectLocalRuntime} from './packaging-runtime.mjs'
import {preparePackageResources} from './prepare-package-resources.mjs'
import {inspectPackagedApp, verifyProjectResources, verifyPackagedDependencies} from './inspect-packaged-app.mjs'
import {writeFile} from 'node:fs/promises'
import {installMacMenuLocalization} from './macos-menu-localization.mjs'

const project = dirname(dirname(fileURLToPath(import.meta.url)))
const allowedArguments = new Set(['--dir', '--dmg', '--zip'])
const arguments_ = process.argv.slice(2)
if (arguments_.length > 1 || arguments_.some(value => !allowedArguments.has(value))) throw new Error('用法：node scripts/package-desktop.mjs [--dir|--dmg|--zip]；仅匹配本机构建')
const runtime = await inspectLocalRuntime(project, process.platform, process.arch)
await preparePackageResources(project)
const require = createRequire(import.meta.url)
const config = {
  ...require(join(project, 'electron-builder.config.cjs')),
  electronDist: runtime.electronDist,
  // This hook completes before archive targets. A missing worker/resource or
  // package-external dependency must fail instead of producing an installer.
  afterPack: async context => {
    const application = context.electronPlatformName === 'darwin' ? join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`) : context.appOutDir
    const appRoot = context.electronPlatformName === 'darwin' ? join(application, 'Contents/Resources/app') : join(application, 'resources/app')
    if(context.electronPlatformName==='darwin')await installMacMenuLocalization(application)
    const contents = context.electronPlatformName === 'darwin' ? await inspectPackagedApp(project, application) : await verifyProjectResources(project, appRoot)
    const dependencies = await verifyPackagedDependencies(appRoot)
    await writeFile(join(context.outDir, `package-static-${process.platform}-${process.arch}.json`), JSON.stringify({contents, dependencies, scope: 'Packaged resources under Node, not Electron/native acceptance'}, null, 2) + '\n')
    console.log(JSON.stringify({stage: 'after-pack-resources-verified', projectResources: contents.projectResources, platform: process.platform, arch: process.arch, pgliteClosed: dependencies.pgliteClosed, publish: 'never'}))
  },
}
const platform = process.platform === 'darwin' ? Platform.MAC : Platform.WINDOWS
const target = arguments_[0]?.slice(2)
if (process.platform === 'win32' && target && target !== 'dir') throw new Error('Windows 本机仅支持默认 NSIS 或 --dir')
console.log(JSON.stringify({stage: 'native-preflight', ...runtime, publish: 'never', signing: 'disabled', target: target ?? 'configured'}, null, 2))
const artifacts = await build({projectDir: project, config, publish: 'never', targets: platform.createTarget(target, Arch[process.arch])})
console.log(JSON.stringify({stage: 'packaged', artifacts}, null, 2))
