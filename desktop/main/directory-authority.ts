import { randomUUID } from "node:crypto"
import { realpath, stat, access } from "node:fs/promises"
import { constants } from "node:fs"

export type DirectoryPurpose = "create-work" | "open-work" | "data-root" | "default-parent"
export interface DirectoryProof { path: string; device: string; inode: string }
interface Grant { path: string; selectedPath: string; purpose: DirectoryPurpose; owner: string; device: bigint; inode: bigint; expires: number }
/** Only native dialog results enter issue(); renderer messages may only consume IDs. */
export class DirectoryAuthority {
  private readonly grants = new Map<string, Grant>()
  constructor(private readonly clock = Date.now) {}
  async issue(selectedPath: string, purpose: DirectoryPurpose, owner: string): Promise<{ id: string; path: string }> {
    const path = await realpath(selectedPath); const info = await stat(path, { bigint: true })
    if (!info.isDirectory()) throw new Error("请选择文件夹")
    await access(path, constants.R_OK | constants.W_OK)
    for (const [id, grant] of this.grants) if (grant.expires <= this.clock()) this.grants.delete(id)
    if (this.grants.size >= 128) throw new Error("目录选择过多，请关闭对话框后重试")
    const id = randomUUID()
    this.grants.set(id, { path, selectedPath, purpose, owner, device: info.dev, inode: info.ino, expires: this.clock() + 600000 })
    return { id, path }
  }
  async consume(id: string, purpose: DirectoryPurpose, owner: string): Promise<DirectoryProof> {
    const grant = this.grants.get(id)
    if (!grant || grant.purpose !== purpose || grant.owner !== owner || grant.expires <= this.clock()) throw new Error("目录授权无效或已过期，请重新选择")
    this.grants.delete(id)
    try {
      const actual = await realpath(grant.selectedPath); const info = await stat(actual, { bigint: true })
      if (actual !== grant.path || !info.isDirectory() || info.dev !== grant.device || info.ino !== grant.inode) throw new Error("changed")
      await access(actual, constants.R_OK | constants.W_OK)
    } catch { throw new Error("所选目录已发生变化或不可写，请重新选择") }
    return { path: grant.path, device: String(grant.device), inode: String(grant.inode) }
  }
  revokeOwner(owner: string) { for (const [id, grant] of this.grants) if (grant.owner === owner) this.grants.delete(id) }
}
