import { lstatSync, realpathSync, type BigIntStats } from 'node:fs'
import { open } from 'node:fs/promises'
import { isAbsolute } from 'node:path'

interface DirectoryIdentity { path: string; device: string; inode: string }
function matches(info: BigIntStats, root: DirectoryIdentity) {
  return info.isDirectory() && !info.isSymbolicLink() && String(info.dev) === root.device && String(info.ino) === root.inode
}
function assertCurrent(root: DirectoryIdentity) {
  if (!isAbsolute(root.path) || !matches(lstatSync(root.path, { bigint: true }), root) || realpathSync(root.path) !== root.path) throw Error('DIRECTORY_CHANGED')
}

/** Windows cannot FlushFileBuffers a read-only directory handle. This reports
 * that capability limit; it does not establish directory metadata durability.
 * Callers still require file sync and their complete post-write authorization. */
export async function syncOwnedDirectory(input: Readonly<DirectoryIdentity>, platform: NodeJS.Platform = process.platform) {
  const root = Object.freeze({ ...input })
  assertCurrent(root)
  let phase: 'open' | 'stat' | 'sync' | 'close' = 'open'
  try {
    const handle = await open(root.path, 'r')
    try {
      phase = 'stat'
      if (!matches(await handle.stat({ bigint: true }), root)) throw Error('DIRECTORY_CHANGED')
      assertCurrent(root)
      phase = 'sync'; await handle.sync()
    } finally {
      const previous = phase; phase = 'close'; await handle.close(); phase = previous
    }
  } catch (cause) {
    const error = cause as NodeJS.ErrnoException
    const unsupported = phase === 'open' && error?.code === 'EISDIR'
      || (phase === 'open' || phase === 'sync') && ['ENOTSUP', 'EOPNOTSUPP', 'ENOSYS'].includes(error?.code ?? '')
      || phase === 'sync' && (error?.code === 'EINVAL' || error?.code === 'EPERM' && error.syscall === 'fsync')
    if (platform !== 'win32' || !unsupported) throw cause
  }
  assertCurrent(root)
}
