import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID, createHash } from 'node:crypto'
import { FileExports } from '../../desktop/main/file-export'

const input = () => ({ id: randomUUID(), format: 'md' as const, filename: 'selected.md', bytes: new TextEncoder().encode('隔离目录同步测试') })
const failure = (code: string, syscall?: string) => Object.assign(Error('private injected IO'), { code, ...(syscall ? { syscall } : {}) })
async function fixture(run: (root: string) => Promise<void>) {
  const root = await fs.mkdtemp(join(tmpdir(), 'xaanink-directory-sync-'))
  try { await run(await fs.realpath(root)) } finally { await fs.rm(root, { recursive: true, force: true }) }
}

test('WDS-02 verified Windows read-only directory fsync EPERM allows exact export receipt after stat and close', async t => fixture(async root => {
  const original = fs.open, calls: string[] = [], source = input()
  t.mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
    if (String(args[0]) !== root || args[1] !== 'r') return original(...args)
    calls.push('open'); const handle = await original(...args), stat = handle.stat.bind(handle), close = handle.close.bind(handle)
    handle.stat = (async (...args: Parameters<typeof handle.stat>) => { calls.push('stat'); return stat(...args) }) as typeof handle.stat
    handle.sync = async () => { calls.push('sync'); throw failure('EPERM', 'fsync') }
    handle.close = async () => { calls.push('close'); await close() }
    return handle
  }); syncBuiltinESMExports()
  try {
    const result = await new FileExports({ platform: 'win32', assertOwner() {}, guardTarget: async () => {}, chooseSave: async () => join(root, 'selected.md') }).save('isolated-owner', source)
    assert.deepEqual(result, { id: source.id, status: 'saved', bytesWritten: source.bytes.length, sha256: createHash('sha256').update(source.bytes).digest('hex') })
    assert.deepEqual(calls, ['open', 'stat', 'sync', 'close']); assert.deepEqual(await fs.readFile(join(root, 'selected.md')), Buffer.from(source.bytes)); assert.deepEqual(await fs.readdir(root), ['selected.md'])
  } finally { t.mock.restoreAll(); syncBuiltinESMExports() }
}))

test('WDS-03/04/05/06 only documented directory operation failures may continue on Windows', async t => fixture(async root => {
  const original = fs.open
  const scenarios: Array<[NodeJS.Platform, string, string, string | undefined, boolean]> = [
    ['win32', 'open', 'EPERM', 'open', false], ['win32', 'stat', 'EPERM', 'fstat', false], ['win32', 'close', 'EPERM', 'close', false],
    ...['open', 'stat', 'close'].map(phase => ['win32', phase, 'EPERM', 'fsync', false] as const),
    ['win32', 'sync', 'EPERM', undefined, false], ['win32', 'sync', 'EPERM', 'write', false],
    ...['EIO', 'EACCES', 'ENOENT', 'EBADF'].map(code => ['win32', 'sync', code, 'fsync', false] as const),
    ...['stat', 'close'].flatMap(phase => ['EINVAL', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EISDIR'].map(code => ['win32', phase, code, 'fsync', false] as const)),
    ...['EISDIR', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS'].map(code => ['win32', 'open', code, 'open', true] as const),
    ...['EINVAL', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS'].map(code => ['win32', 'sync', code, 'fsync', true] as const),
    ...(['darwin', 'linux'] as const).flatMap(platform => [
      ['sync', 'EPERM', 'fsync'], ...['EISDIR', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS'].map(code => ['open', code, 'open']),
      ...['EINVAL', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS'].map(code => ['sync', code, 'fsync']),
    ].map(([phase, code, syscall]) => [platform, phase, code, syscall, false] as const)),
  ].map(row => [...row] as [NodeJS.Platform, string, string, string | undefined, boolean])
  try {
    for (const [index, [platform, phase, code, syscall, allowed]] of scenarios.entries()) {
      let attempts = 0, closed = 0
      t.mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
        if (String(args[0]) !== root || args[1] !== 'r') return original(...args)
        attempts++; if (phase === 'open') throw failure(code, syscall)
        const handle = await original(...args), close = handle.close.bind(handle)
        if (phase === 'stat') handle.stat = async () => { throw failure(code, syscall) }
        handle.sync = async () => { if (phase === 'sync') throw failure(code, syscall) }
        handle.close = async () => { closed++; await close(); if (phase === 'close') throw failure(code, syscall) }
        return handle
      }); syncBuiltinESMExports()
      const source = input(), path = join(root, `${index}.md`), result = await new FileExports({ platform, assertOwner() {}, guardTarget: async () => {}, chooseSave: async () => path }).save('isolated-owner', source)
      assert.equal(attempts, 1); assert.equal(closed, phase === 'open' ? 0 : 1)
      assert.equal(result.status, allowed ? 'saved' : 'failed', `${platform}/${phase}/${code}/${syscall}`)
      if (!allowed && result.status === 'failed') assert.equal(result.code, 'EXPORT_DURABILITY_UNCONFIRMED')
      assert.doesNotMatch(JSON.stringify(result), /private injected/); assert.deepEqual(await fs.readFile(path), Buffer.from(source.bytes))
      t.mock.restoreAll(); syncBuiltinESMExports()
    }
  } finally { t.mock.restoreAll(); syncBuiltinESMExports() }
}))

test('WDS-07 directory replacement during exempted fsync never confirms a saved receipt', async t => fixture(async root => {
  const selected = join(root, 'selected'); await fs.mkdir(selected); const canonical = await fs.realpath(selected), original = fs.open
  t.mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
    const handle = await original(...args)
    if (String(args[0]) === canonical && args[1] === 'r') handle.sync = async () => {
      await fs.rename(canonical, canonical + '-owned'); await fs.mkdir(canonical); await fs.writeFile(join(canonical, 'foreign.md'), 'keep')
      throw failure('EPERM', 'fsync')
    }
    return handle
  }); syncBuiltinESMExports()
  try {
    const result = await new FileExports({ platform: 'win32', assertOwner() {}, guardTarget: async () => {}, chooseSave: async () => join(canonical, 'selected.md') }).save('isolated-owner', input())
    assert.equal(result.status, 'failed'); if (result.status === 'failed') assert.equal(result.code, 'EXPORT_DURABILITY_UNCONFIRMED')
    assert.equal(await fs.readFile(join(canonical, 'foreign.md'), 'utf8'), 'keep'); assert.ok((await fs.readdir(canonical + '-owned')).includes('selected.md'))
  } finally { t.mock.restoreAll(); syncBuiltinESMExports() }
}))

test('WDS-08 ordinary file fsync EPERM never receives the directory capability exemption', async t => fixture(async root => {
  const original = fs.open, path = join(root, 'selected.md'); await fs.writeFile(path, 'keep')
  t.mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
    const handle = await original(...args)
    if (args[1] === 'wx') handle.sync = async () => { throw failure('EPERM', 'fsync') }
    return handle
  }); syncBuiltinESMExports()
  try {
    const result = await new FileExports({ platform: 'win32', assertOwner() {}, guardTarget: async () => {}, chooseSave: async () => path }).save('isolated-owner', input())
    assert.equal(result.status, 'failed'); if (result.status === 'failed') assert.equal(result.code, 'EXPORT_WRITE_FAILED'); assert.equal(await fs.readFile(path, 'utf8'), 'keep'); assert.deepEqual(await fs.readdir(root), ['selected.md'])
  } finally { t.mock.restoreAll(); syncBuiltinESMExports() }
}))

test('WDS-08-race sync-failure cleanup preserves a foreign replacement arriving during asynchronous lstat', async t => fixture(async root => {
  const originalOpen = fs.open, originalStat = fs.lstat, path = join(root, 'selected.md'); let temporary = '', injected = false
  await fs.writeFile(path, 'keep')
  t.mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
    const handle = await originalOpen(...args)
    if (args[1] === 'wx') { temporary = String(args[0]); handle.sync = async () => { throw failure('EPERM', 'fsync') } }
    return handle
  })
  t.mock.method(fs, 'lstat', async (...args: Parameters<typeof fs.lstat>) => {
    const info = await originalStat(...args)
    if (String(args[0]) === temporary && !injected) { injected = true; await fs.rename(temporary, temporary + '-owned'); await fs.writeFile(temporary, 'foreign retained') }
    return info
  }); syncBuiltinESMExports()
  try {
    const result = await new FileExports({ platform: 'win32', assertOwner() {}, guardTarget: async () => {}, chooseSave: async () => path }).save('isolated-owner', input())
    assert.equal(result.status, 'failed'); assert.equal(injected, true); assert.equal(await fs.readFile(temporary, 'utf8'), 'foreign retained'); assert.equal(await fs.readFile(path, 'utf8'), 'keep'); assert.deepEqual(await fs.readFile(temporary + '-owned'), Buffer.from(input().bytes))
  } finally { t.mock.restoreAll(); syncBuiltinESMExports() }
}))
