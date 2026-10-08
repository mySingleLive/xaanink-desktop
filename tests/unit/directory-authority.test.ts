import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdtemp, mkdir, rename, rm, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DirectoryAuthority } from "../../desktop/main/directory-authority"

async function fixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "xuanxiang-grants-"))
  try { await run(root) } finally { await rm(root, { recursive: true, force: true }) }
}
test("IPC-02: directory grants are scoped to purpose and frame, expire, and can only be consumed once", () => fixture(async root => {
  let clock = 100; const grants = new DirectoryAuthority(() => clock)
  const grant = await grants.issue(root, "create-work", "frame-a")
  await assert.rejects(grants.consume(grant.id, "open-work", "frame-a"), /授权/)
  await assert.rejects(grants.consume(grant.id, "create-work", "frame-b"), /授权/)
  assert.equal((await grants.consume(grant.id, "create-work", "frame-a")).path, grant.path)
  await assert.rejects(grants.consume(grant.id, "create-work", "frame-a"), /授权/)
  const expired = await grants.issue(root, "create-work", "frame-a"); clock += 600001
  await assert.rejects(grants.consume(expired.id, "create-work", "frame-a"), /授权/)
}))
test("IPC-02: a swapped selected directory cannot confer access to its replacement or symlink target", () => fixture(async root => {
  const selected = join(root, "selected"); await mkdir(selected); await mkdir(join(root, "unselected"))
  const grants = new DirectoryAuthority(); const grant = await grants.issue(selected, "create-work", "frame-a")
  await rename(selected, join(root, "previous")); await symlink(join(root, "unselected"), selected, "dir")
  await assert.rejects(grants.consume(grant.id, "create-work", "frame-a"), /变化/)
  await rm(selected); await mkdir(selected)
  await assert.rejects(grants.consume(grant.id, "create-work", "frame-a"), /授权/)
}))
test("IPC-02: closing a frame revokes all its outstanding directory grants", () => fixture(async root => {
  const grants = new DirectoryAuthority(); const a = await grants.issue(root, "default-parent", "frame-a"); const b = await grants.issue(root, "open-work", "frame-b")
  grants.revokeOwner("frame-a")
  await assert.rejects(grants.consume(a.id, "default-parent", "frame-a"), /授权/)
  assert.equal((await grants.consume(b.id, "open-work", "frame-b")).path, b.path)
}))
