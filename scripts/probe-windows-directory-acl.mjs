import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, open, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, basename, dirname, resolve } from 'node:path'
assert.equal(process.platform, 'win32')
const root = await mkdtemp(join(tmpdir(), 'xaanink-dir-permission-'))
const sid = execFileSync('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true }).match(/S-1-\d+(?:-\d+)+/)[0]
let denied = false, restored = false, code
try {
  await writeFile(join(root, 'old.md'), 'keep')
  execFileSync('icacls.exe', [root, '/deny', `*${sid}:(WD,AD)`], { windowsHide: true }); denied = true
  await assert.rejects(async () => { const file = await open(join(root, 'write-probe'), 'wx'); await file.close() }, error => { code = error.code; return ['EACCES', 'EPERM'].includes(error.code) })
} finally {
  if (denied) { execFileSync('icacls.exe', [root, '/remove:d', `*${sid}`], { windowsHide: true }); restored = true }
  assert.equal(dirname(resolve(root)).toLowerCase(), resolve(tmpdir()).toLowerCase()); assert(basename(root).startsWith('xaanink-dir-permission-'))
  await rm(root, { recursive: true, force: true })
}
console.log(JSON.stringify({ platform: process.platform, isolated: true, nativeDeniedCreateFile: code, aclRestored: restored, directoryRemoved: true }))
