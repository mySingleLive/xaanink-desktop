import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { join, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { syncOwnedDirectory } from '../../desktop/core/directory-sync'

async function fixture(run: (root: { path: string; device: string; inode: string }, base: string) => Promise<void>) {
  const base = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'xaanink-directory-identity-'))), path = join(base, 'selected')
  await fs.mkdir(path); const info = await fs.lstat(path, { bigint: true })
  try { await run({ path, device: String(info.dev), inode: String(info.ino) }, base) } finally { await fs.rm(base, { recursive: true, force: true }) }
}
const unsupported = () => Object.assign(Error('read-only directory capability'), { code: 'EPERM', syscall: 'fsync' })

test('WDS-helper rejects stale identity, noncanonical paths, files and symlink/junction directories before open', async t => fixture(async (root, base) => {
  const original = fs.open; let opened = 0
  const file = join(base, 'file'); await fs.writeFile(file, 'keep'); const fileInfo = await fs.lstat(file, { bigint: true })
  const alias = join(base, 'alias'); await fs.symlink(root.path, alias, process.platform === 'win32' ? 'junction' : 'dir')
  t.mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => { opened++; return original(...args) }); syncBuiltinESMExports()
  try {
    for (const input of [ { ...root, path: relative(base, root.path) }, { ...root, inode: String(BigInt(root.inode) + 1n) }, { ...root, path: root.path + '/../selected' }, { ...root, path: alias }, { path: file, device: String(fileInfo.dev), inode: String(fileInfo.ino) } ]) await assert.rejects(syncOwnedDirectory(input, 'win32'), /DIRECTORY_CHANGED/)
    assert.equal(opened, 0); assert.equal(await fs.readFile(file, 'utf8'), 'keep')
  } finally { t.mock.restoreAll(); syncBuiltinESMExports() }
}))

test('WDS-helper rejects replacements while opening, syncing and closing, preserving foreign contents', async t => {
  for (const phase of ['open', 'sync', 'close']) await fixture(async root => {
    const original = fs.open; let closed = 0, synced = 0
    const replace = async () => { await fs.rename(root.path, root.path + '-owned'); await fs.mkdir(root.path); await fs.writeFile(join(root.path, 'foreign'), 'keep') }
    t.mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
      const handle = await original(...args), close = handle.close.bind(handle)
      if (phase === 'open') await replace()
      handle.sync = async () => { synced++; if (phase === 'sync') await replace(); throw unsupported() }
      handle.close = async () => { closed++; await close(); if (phase === 'close') await replace() }
      return handle
    }); syncBuiltinESMExports()
    try {
      await assert.rejects(syncOwnedDirectory(root, 'win32'), /DIRECTORY_CHANGED/); assert.equal(closed, 1); assert.equal(synced, phase === 'open' ? 0 : 1); assert.equal(await fs.readFile(join(root.path, 'foreign'), 'utf8'), 'keep')
    } finally { t.mock.restoreAll(); syncBuiltinESMExports() }
  })
})

test('WDS-helper verifies the opened handle is a directory with the pinned identity before fsync', async t => {
  for (const scenario of ['non-directory', 'identity']) await fixture(async root => {
    const original = fs.open; let closed = 0, synced = 0
    t.mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
      const handle = await original(...args), stat = handle.stat.bind(handle), close = handle.close.bind(handle)
      handle.stat = (async () => { const info = await stat({ bigint: true }); if (scenario === 'identity') info.ino++; else info.isDirectory = () => false; return info }) as typeof handle.stat
      handle.sync = async () => { synced++; throw unsupported() }; handle.close = async () => { closed++; await close() }; return handle
    }); syncBuiltinESMExports()
    try { await assert.rejects(syncOwnedDirectory(root, 'win32'), /DIRECTORY_CHANGED/); assert.equal(synced, 0); assert.equal(closed, 1) }
    finally { t.mock.restoreAll(); syncBuiltinESMExports() }
  })
})

test('WDS-helper close failure overrides an otherwise exempted fsync failure', async t => fixture(async root => {
  const original = fs.open
  t.mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
    const handle = await original(...args), close = handle.close.bind(handle)
    handle.sync = async () => { throw unsupported() }; handle.close = async () => { await close(); throw Object.assign(Error('private close'), { code: 'ENOSYS', syscall: 'fsync' }) }; return handle
  }); syncBuiltinESMExports()
  try { await assert.rejects(syncOwnedDirectory(root, 'win32'), { code: 'ENOSYS' }) }
  finally { t.mock.restoreAll(); syncBuiltinESMExports() }
}))

test('WDS-helper pins a private copy of caller identity before the asynchronous open', async t => fixture(async (root, base) => {
  const original = fs.open, selected = root.path; await fs.mkdir(join(base, 'other')); const other = await fs.lstat(join(base, 'other'), { bigint: true })
  t.mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
    assert.equal(args[0], selected); const handle = await original(...args)
    root.path = join(base, 'other'); root.device = String(other.dev); root.inode = String(other.ino)
    handle.sync = async () => { throw unsupported() }; return handle
  }); syncBuiltinESMExports()
  try { await syncOwnedDirectory(root, 'win32') }
  finally { t.mock.restoreAll(); syncBuiltinESMExports() }
}))
