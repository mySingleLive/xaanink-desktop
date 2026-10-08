import {copyFile, mkdir, readFile, writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {createRequire} from 'node:module'

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
function chunk(type, bytes) {
  const header = Buffer.alloc(8)
  header.write(type, 0, 4, 'ascii')
  header.writeUInt32BE(bytes.length + 8, 4)
  return Buffer.concat([header, bytes])
}

export async function preparePackageResources(project) {
  const require = createRequire(join(project, 'package.json'))
  const sharp = require('sharp')
  const build = join(project, 'build'), licenses = join(project, 'runtime-licenses')
  await mkdir(build, {recursive: true})
  await mkdir(licenses, {recursive: true})
  const brand = await readFile(join(project, 'public/brand/logo-icon-paper.svg'))
  const foreground = await sharp(brand).resize(704, 704).png().toBuffer()
  const tile = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect x="64" y="64" width="896" height="896" rx="196" fill="#f5f0e5"/></svg>')
  const image = await sharp(tile).composite([{input: foreground, top: 160, left: 160}]).png().toBuffer()
  await writeFile(join(build, 'icon.png'), image)
  const resized = new Map()
  for (const size of [16, 32, 48, 64, 128, 256, 512, 1024]) resized.set(size, await sharp(image).resize(size, size).png().toBuffer())
  const icnsBody = Buffer.concat([chunk('ic07', resized.get(128)), chunk('ic08', resized.get(256)), chunk('ic09', resized.get(512)), chunk('ic10', resized.get(1024)), chunk('ic11', resized.get(64)), chunk('ic12', resized.get(128)), chunk('ic13', resized.get(256)), chunk('ic14', resized.get(512))])
  await writeFile(join(build, 'icon.icns'), chunk('icns', icnsBody))
  const sizes = [16, 32, 48, 64, 128, 256]
  const icoHeader = Buffer.alloc(6 + 16 * sizes.length)
  icoHeader.writeUInt16LE(1, 2); icoHeader.writeUInt16LE(sizes.length, 4)
  let offset = icoHeader.length
  sizes.forEach((size, index) => {
    const position = 6 + 16 * index, png = resized.get(size)
    icoHeader[position] = size === 256 ? 0 : size
    icoHeader[position + 1] = size === 256 ? 0 : size
    icoHeader.writeUInt16LE(1, position + 4); icoHeader.writeUInt16LE(32, position + 6)
    icoHeader.writeUInt32LE(png.length, position + 8); icoHeader.writeUInt32LE(offset, position + 12)
    offset += png.length
  })
  await writeFile(join(build, 'icon.ico'), Buffer.concat([icoHeader, ...sizes.map(size => resized.get(size))]))
  const copies = [
    ['public/fonts/noto-sans-sc/LICENSE', 'NotoSansSC-OFL.txt'],
    ['public/brands/providers/LICENSE.txt', 'LobeHub-Icons-MIT.txt'],
    ['node_modules/lucide-react/LICENSE', 'Lucide-ISC.txt'],
    ['node_modules/monaco-editor/LICENSE', 'Monaco-MIT.txt'],
    ['node_modules/electron/dist/LICENSE', 'Electron-MIT.txt'],
    ['node_modules/electron/dist/LICENSES.chromium.html', 'Electron-Chromium-LICENSES.html'],
    ['scripts/assets/sharp-libvips-v1.2.4-THIRD-PARTY-NOTICES.md', 'Sharp-libvips-THIRD-PARTY-NOTICES.md'],
  ]
  const resources = []
  for (const [source, name] of copies) {
    await copyFile(join(project, source), join(licenses, name))
    resources.push({source, packagedPath: `runtime-licenses/${name}`, sha256: sha(await readFile(join(project, source)))})
  }
  const platform = `${process.platform}-${process.arch}`
  const nativeRoot = process.platform === 'darwin' ? `@img/sharp-libvips-${platform}` : `@img/sharp-${platform}`
  const nativeMetadata = JSON.parse(await readFile(join(project, 'node_modules', nativeRoot, 'package.json'), 'utf8'))
  const versionsPath = join(project, 'node_modules', nativeRoot, 'versions.json')
  const versions = JSON.parse(await readFile(versionsPath, 'utf8'))
  const manifest = {
    format: 'xaanink-packaged-resource-provenance', schemaVersion: 1,
    brandSource: {path: 'public/brand/logo-icon-paper.svg', sha256: sha(brand)},
    resources,
    nativeLibraries: {package: nativeMetadata.name, version: nativeMetadata.version, license: nativeMetadata.license, versions, noticesSource: 'https://github.com/lovell/sharp-libvips/blob/v1.2.4/THIRD-PARTY-NOTICES.md'},
  }
  await writeFile(join(licenses, 'provenance.json'), JSON.stringify(manifest, null, 2) + '\n')
  return manifest
}
