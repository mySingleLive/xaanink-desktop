import {readFile, readdir, stat} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {join} from 'node:path'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'

const execute = promisify(execFile)
const json = async (path) => JSON.parse(await readFile(path, 'utf8'))

async function verifyBinary(path, platform, arch) {
  if (!(await stat(path)).isFile()) throw new Error(`运行二进制缺失：${path}`)
  if (platform === 'darwin') {
    const {stdout} = await execute('/usr/bin/lipo', ['-archs', path], {timeout: 10000})
    const expected = arch === 'x64' ? 'x86_64' : arch
    const architectures = stdout.trim().split(/\s+/)
    if (!architectures.includes(expected)) throw new Error(`二进制架构不匹配：${path} (${architectures.join(',')})`)
  } else {
    const bytes = await readFile(path)
    if (bytes.length < 64 || bytes.toString('ascii', 0, 2) !== 'MZ') throw new Error(`无效的 Windows 二进制：${path}`)
    const offset = bytes.readUInt32LE(60)
    if (offset + 6 > bytes.length || bytes.toString('ascii', offset, offset + 4) !== 'PE\0\0') throw new Error(`无效的 PE 二进制：${path}`)
    const machine = bytes.readUInt16LE(offset + 4)
    if (machine !== (arch === 'x64' ? 0x8664 : 0xaa64)) throw new Error(`二进制架构不匹配：${path}`)
  }
}

// A preflight, rather than an electronDist hook: hook exceptions may download
// another distribution. Never enter builder on a mismatched native host.
export async function inspectLocalRuntime(project, platform, arch) {
  if (platform !== process.platform || !['darwin', 'win32'].includes(platform)) throw new Error('目标操作系统必须与本机构建系统一致')
  if (arch !== process.arch || !['arm64', 'x64'].includes(arch)) throw new Error('目标架构必须与本机安装运行库架构一致')
  const packageMetadata = await json(join(project, 'package.json'))
  const electronMetadata = await json(join(project, 'node_modules/electron/package.json'))
  const electronDist = join(project, 'node_modules/electron/dist')
  const version = (await readFile(join(electronDist, 'version'), 'utf8')).trim()
  if (version !== electronMetadata.version || version !== packageMetadata.devDependencies.electron) throw new Error('Electron 本地发行版本与锁定版本不一致')
  const executable = platform === 'darwin' ? join(electronDist, 'Electron.app/Contents/MacOS/Electron') : join(electronDist, 'electron.exe')
  await verifyBinary(executable, platform, arch)
  const sharpRoot = join(project, `node_modules/@img/sharp-${platform}-${arch}`)
  const sharpMetadata = await json(join(sharpRoot, 'package.json'))
  if (!sharpMetadata.os?.includes(platform) || !sharpMetadata.cpu?.includes(arch)) throw new Error('Sharp 平台包架构不一致')
  const sharpBinary = join(sharpRoot, `lib/sharp-${platform}-${arch}.node`)
  await verifyBinary(sharpBinary, platform, arch)
  let libvipsRoot = sharpRoot
  if (platform === 'darwin') {
    libvipsRoot = join(project, `node_modules/@img/sharp-libvips-${platform}-${arch}`)
    const metadata = await json(join(libvipsRoot, 'package.json'))
    if (!metadata.os?.includes(platform) || !metadata.cpu?.includes(arch)) throw new Error('libvips 平台包架构不一致')
  }
  const binaries = (await readdir(join(libvipsRoot, 'lib'))).filter(name => /\.(dylib|dll)$/.test(name))
  if (!binaries.length) throw new Error('缺少 libvips 本机动态库')
  for (const name of binaries) await verifyBinary(join(libvipsRoot, 'lib', name), platform, arch)
  const require = createRequire(join(project, 'package.json'))
  const sharp = require('sharp')
  if (!sharp.versions.vips) throw new Error('Sharp 未加载本机 libvips')
  return {platform, arch, version, executable, electronDist, sharpBinary, sharpVersion: sharp.versions.sharp, libvipsVersion: sharp.versions.vips}
}
