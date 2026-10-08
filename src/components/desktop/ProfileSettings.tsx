"use client"
import { useEffect, useRef, useState } from "react"
import { ImagePlus, LoaderCircle, Pencil, X } from "lucide-react"
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useDesktopStore, saveDesktopProfile } from "@/stores/desktop"
import { settingsSchema, type Settings } from "@desktop/core/settings"
import type { AvatarDraft } from "@desktop/shared/ipc"

function Avatar({ name, source }: { name: string; source?: string }) {
  return <>{name.slice(0,1)}{source && <img key={source} src={source} alt="" className="absolute inset-0 size-full object-cover" onError={event => { event.currentTarget.hidden = true }} />}</>
}
const assetUrl = (id: string | null) => id ? `xaanink://asset/global/${id}` : undefined
export function ProfileSettings() {
  const user = useDesktopStore(state => state.bootstrap!.settings.user)
  const [profile,setProfile] = useState<Settings["user"] | null>(null)
  const [avatar,setAvatar] = useState<AvatarDraft | null>(null)
  const [choosing,setChoosing] = useState(false), [saving,setSaving] = useState(false), [error,setError] = useState("")
  const session = useRef<string | null>(null), sequence = useRef(0), locked = useRef(false), editButton = useRef<HTMLButtonElement>(null)
  function release() {
    const id = session.current; session.current = null; sequence.current++
    if (id) void window.desktop?.cancelAvatar(id).catch(() => undefined)
  }
  useEffect(() => () => { release() },[])
  function close() { if (locked.current) return; release(); setProfile(null); setAvatar(null); setChoosing(false); setError("") }
  function edit() { release(); session.current = crypto.randomUUID(); locked.current = false; setProfile(structuredClone(user)); setAvatar(null); setChoosing(false); setSaving(false); setError("") }
  async function choose() {
    const id = session.current
    if (!id || locked.current || !window.desktop) return
    const request = ++sequence.current; setChoosing(true); setError("")
    try {
      const selected = await window.desktop.chooseAvatar(id)
      if (session.current !== id || sequence.current !== request) return
      if (selected) setAvatar(selected)
    } catch (cause) { if (session.current === id && sequence.current === request) setError(cause instanceof Error ? cause.message : "头像读取失败") }
    finally { if (session.current === id && sequence.current === request) setChoosing(false) }
  }
  async function save() {
    const id = session.current
    if (!profile || !id || locked.current || choosing) return
    const parsed = settingsSchema.shape.user.safeParse(profile)
    if (!parsed.success) { setError("请填写1至80字的笔名和有效的邮件地址，邮件也可以留空"); return }
    locked.current = true; setSaving(true); setError("")
    try {
      await saveDesktopProfile(id,parsed.data,avatar?.draftId)
      if (session.current === id) { locked.current = false; close() }
    } catch (cause) { if (session.current === id) setError(cause instanceof Error ? cause.message : "资料保存失败") }
    finally { if (session.current === id || session.current === null) { locked.current = false; setSaving(false) } }
  }
  return <><div className="desktop-user-card"><div className="desktop-user-avatar relative overflow-hidden"><Avatar name={user.penName} source={assetUrl(user.avatarAssetId)} /></div><div className="min-w-0 flex-1"><strong className="block truncate" title={user.penName}>{user.penName}</strong><p className="truncate" title={user.email}>{user.email}</p></div><Button ref={editButton} variant="ghost" size="icon" aria-label="编辑用户" title="编辑用户" className="shrink-0" onClick={edit}><Pencil size={17} /></Button></div>
    <Dialog open={profile !== null} onOpenChange={value => { if (!value) close() }}><DialogContent data-desktop-settings-surface showCloseButton={false} finalFocus={editButton} className="desktop-profile-editor"><div className="flex items-center justify-between"><DialogTitle>编辑用户</DialogTitle><Button variant="ghost" size="icon-sm" aria-label="关闭编辑用户" disabled={saving} onClick={close}><X size={17} /></Button></div><DialogDescription className="sr-only">修改本地头像、笔名与邮件，保存后生效</DialogDescription>{profile && <><div className="flex gap-5"><button className="desktop-user-avatar profile relative overflow-hidden" aria-label="选择头像" title="选择 PNG、JPEG 或 WebP 图片（不超过10MB）" disabled={saving} onClick={() => { void choose() }}><Avatar name={profile.penName} source={avatar?.previewDataUrl ?? assetUrl(profile.avatarAssetId)} /><span className="desktop-avatar-action">{choosing ? <LoaderCircle size={15} className="animate-spin" /> : <ImagePlus size={15} />}{choosing ? "读取中…" : "更换头像"}</span></button><fieldset className="flex min-w-0 flex-1 flex-col gap-4" disabled={saving}><label>笔名<Input aria-label="笔名" autoComplete="off" maxLength={80} value={profile.penName} onChange={event => setProfile({ ...profile, penName: event.target.value })} /></label><label>邮件<Input aria-label="邮件" type="email" autoComplete="off" value={profile.email} onChange={event => setProfile({ ...profile, email: event.target.value })} /></label></fieldset></div>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<div className="flex justify-end gap-2"><Button variant="outline" disabled={saving} onClick={close}>取消</Button><Button disabled={saving || choosing} onClick={() => { void save() }}>{saving && <LoaderCircle className="animate-spin" size={15} />}保存</Button></div></>}</DialogContent></Dialog>
  </>
}
