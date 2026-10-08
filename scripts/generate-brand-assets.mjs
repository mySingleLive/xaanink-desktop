import {createHash} from 'node:crypto'
import {readFile, readdir, writeFile} from 'node:fs/promises'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import fontkit from '@pdf-lib/fontkit'
import sharp from 'sharp'

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const brand = '玄印写作'
const englishBrand = 'XaanInk'
const fontSource = 'design/assets/NotoSansSC-Regular.ttf'
const fontBytes = await readFile(join(project, fontSource))
const fontHash = createHash('sha256').update(fontBytes).digest('hex')
const font = fontkit.create(fontBytes)
const previousBrand = ['玄', '香', '印'].join('')

// Return the first complete drawing group, including all its nested groups.
// The approved symbol is retained byte-for-byte; only later lettering changes.
function firstDrawingGroup(svg) {
  const start = svg.indexOf('<g ')
  if (start < 0) throw new Error('Brand asset is missing its symbol group')
  let depth = 0
  const tags = svg.slice(start).matchAll(/<\/?g\b[^>]*>/g)
  for (const match of tags) {
    depth += match[0].startsWith('</') ? -1 : 1
    if (depth === 0) return {start, end: start + match.index + match[0].length}
  }
  throw new Error('Brand asset has an unclosed symbol group')
}

const number = value => Number(value.toFixed(6))

function outlinedWordmark(text, fill, box) {
  const run = font.layout(text)
  if (run.glyphs.some(glyph => glyph.id === 0)) throw new Error(`Font lacks a glyph for ${text}`)
  let penX = 0, penY = 0
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  const paths = run.glyphs.map((glyph, index) => {
    const position = run.positions[index]
    const x = penX + position.xOffset, y = penY + position.yOffset
    minX = Math.min(minX, x + glyph.bbox.minX)
    minY = Math.min(minY, y + glyph.bbox.minY)
    maxX = Math.max(maxX, x + glyph.bbox.maxX)
    maxY = Math.max(maxY, y + glyph.bbox.maxY)
    penX += position.xAdvance
    penY += position.yAdvance
    return `<path data-glyph-id="${glyph.id}" transform="translate(${number(x)} ${number(y)})" d="${glyph.path.toSVG()}"/>`
  })
  const scale = Math.min(box.width / (maxX - minX), box.height / (maxY - minY))
  const x = box.x + (box.width - (maxX - minX) * scale) / 2
  const y = box.y + (box.height - (maxY - minY) * scale) / 2
  return `<g data-outlined-label="${text}" fill="${fill}" transform="translate(${number(x)} ${number(y)}) scale(${number(scale)} ${number(-scale)}) translate(${number(-minX)} ${number(-maxY)})">${paths.join('')}</g>`
}

const directories = ['public/brand', 'design/assets']
let vectors = 0, bitmaps = 0
for (const directory of directories) {
  const files = (await readdir(join(project, directory))).filter(name => /(?:logo|seal|favicon).*\.svg$/.test(name)).sort()
  for (const name of files) {
    const path = join(project, directory, name)
    let svg = (await readFile(path, 'utf8')).replaceAll(previousBrand, brand)
    if (/horizontal|formal/.test(name)) {
      const symbol = firstDrawingGroup(svg)
      const fill = name.includes('paper') ? '#2b251b' : '#ece7e1'
      const wordmark = outlinedWordmark(brand, fill, /horizontal/.test(name)
        ? {x: 164, y: 24.7, width: 248, height: 74}
        : {x: 56, y: 308, width: 248, height: 74})
      const english = /formal/.test(name)
        ? outlinedWordmark(englishBrand, fill, {x: 77, y: 402, width: 206, height: 24})
        : ''
      svg = svg.slice(0, symbol.end) + wordmark + english + '</svg>\n'
      svg = svg.replace(/ data-wordmark(?:-[a-z]+)?="[^"]*"/g, '')
      svg = svg.replace('<svg ', `<svg data-wordmark="${brand}" data-wordmark-en="${englishBrand}" data-wordmark-font="${fontSource}" data-wordmark-sha="${fontHash}" `)
    }
    await writeFile(path, svg)
    vectors++
  }
  if (directory === 'public/brand') {
    const pngs = (await readdir(join(project, directory))).filter(name => name.endsWith('.png')).sort()
    for (const name of pngs) {
      const path = join(project, directory, name)
      const {width, height, density} = await sharp(path).metadata()
      const vector = join(project, directory, name.replace(/\.png$/, '.svg'))
      await sharp(await readFile(vector), {density}).resize(width, height).png().toFile(path)
      bitmaps++
    }
  }
}
console.log(JSON.stringify({brand, englishBrand, vectors, bitmaps, fontSource, fontHash}))
