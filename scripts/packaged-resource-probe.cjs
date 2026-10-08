// This tooling process never launches Electron or a production service.
const {createRequire, registerHooks, isBuiltin} = require('node:module')
const {realpathSync} = require('node:fs')
const {fileURLToPath} = require('node:url')
const {join, sep} = require('node:path')
const assert = require('node:assert/strict')
const appRoot = realpathSync(process.argv[2])
const resolvedModules = new Set()
registerHooks({resolve(specifier, context, nextResolve) {
  const result = nextResolve(specifier, context)
  if (result.url.startsWith('file:')) {
    const path = realpathSync(fileURLToPath(result.url))
    if (path !== appRoot && !path.startsWith(appRoot + sep)) throw new Error(`Dependency escaped packaged application: ${specifier}`)
    resolvedModules.add(path.slice(appRoot.length + 1))
  } else if (!isBuiltin(result.url)) throw new Error(`Unexpected module URL: ${result.url}`)
  return result
}})
const originalFetch = globalThis.fetch
globalThis.fetch = (input, options) => {
  const value = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (/^https?:/i.test(value)) throw new Error('Network is forbidden in package resource probe')
  return originalFetch(input, options)
}
async function probe() {
  const packagedRequire = createRequire(join(appRoot, 'dist/service/index.cjs'))
  const sharp = packagedRequire('sharp')
  const png = await sharp({create: {width: 2, height: 3, channels: 4, background: '#b03524'}}).png().toBuffer()
  const image = await sharp(png).metadata()
  const {wasm} = packagedRequire('@prisma/client/runtime/query_compiler_fast_bg.postgresql.wasm-base64.js')
  const compilerWasmMagic = Buffer.from(wasm, 'base64').subarray(0, 4).toString('hex')
  assert.equal(compilerWasmMagic, '0061736d')
  const {PGlite} = packagedRequire('@electric-sql/pglite')
  let engine, queryResult, pgliteClosed = false
  try {
    engine = await PGlite.create({dataDir: 'memory://', relaxedDurability: false})
    queryResult = (await engine.query('SELECT 42::integer AS answer')).rows[0].answer
    assert.equal(queryResult, 42)
  } finally {
    if (engine) {await engine.close(); pgliteClosed = engine.closed === true; assert.equal(pgliteClosed, true)}
  }
  console.log(JSON.stringify({scope: 'Actual packaged dependencies under Node with memory-only PGlite; no Electron acceptance', pid: process.pid, pgliteClosed, queryResult, sharp: {format: image.format, width: image.width, height: image.height, version: sharp.versions.sharp}, compilerWasmMagic, resolvedModules: [...resolvedModules].sort()}))
}
probe().catch(error => {console.error(error); process.exitCode = 1})
