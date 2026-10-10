"use client"
import { useEffect, useRef, useState, type ComponentProps } from "react"
import { ArrowLeft, ArrowRight, ImagePlus, LoaderCircle, Pencil, X } from "lucide-react"
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useDesktopStore, saveDesktopProfile } from "@/stores/desktop"
import { settingsSchema, type Settings } from "@desktop/core/settings"
import type { AvatarDraft } from "@desktop/shared/ipc"

function Avatar({ name, source }: { name: string; source?: string }) {
  return <>{name.slice(0, 1)}{source && <img key={source} src={source} alt="" className="absolute inset-0 size-full object-cover" onError={event => { event.currentTarget.hidden = true }} />}</>
}
const assetUrl = (id: string | null) => id ? `xaanink://asset/global/${id}` : undefined
export interface ProfileEditorDialogProps {
  open?: boolean
  title?: string
  submitLabel?: string
  onBack?(): void
  onClose(): void
  onSaved?(): void
  onDraftChanged?(): void
  onRetry?(): Promise<unknown>
  blocked?: boolean
  confirmationPending?: boolean
  finalFocus?: ComponentProps<typeof DialogContent>["finalFocus"]
  onSubmit?(sessionId: string, user: Settings["user"], avatarDraftId?: string): Promise<unknown>
}
export function ProfileEditorDialog({ open = true, title = "编辑用户", submitLabel = "保存", onBack, onClose, onSaved, onDraftChanged, onRetry, blocked = false, confirmationPending = false, finalFocus, onSubmit }: ProfileEditorDialogProps) {
  const user = useDesktopStore(state => state.bootstrap!.settings.user)
  const [profile, setProfile] = useState(() => structuredClone(user))
  const [avatar, setAvatar] = useState<AvatarDraft | null>(null)
  const [choosing, setChoosing] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState("")
  const session = useRef<string | null>(null), sequence = useRef(0), locked = useRef(false), alive = useRef(true), visible = useRef(open), blockedRef = useRef(blocked)
  const nameInput = useRef<HTMLInputElement>(null), emailInput = useRef<HTMLInputElement>(null)
  visible.current = open; blockedRef.current = blocked
  const onboarding = !!onSubmit
  const disabled = saving || blocked || !open
  const fieldsDisabled = disabled || confirmationPending
  function release() {
    const id = session.current; session.current = null; sequence.current++
    if (id) void window.desktop?.cancelAvatar(id).catch(() => undefined)
  }
  useEffect(() => {
    alive.current = true; session.current = crypto.randomUUID()
    return () => { alive.current = false; release() }
  }, [])
  useEffect(() => {
    if (!open) {
      sequence.current++; setChoosing(false)
      const id = session.current
      if (id) void window.desktop?.cancelAvatarSelection?.({ sessionId: id, draftId: avatar?.draftId ?? null }).catch(() => undefined)
    }
  }, [open])
  // open=false suspends the popup; the lifetime and avatar draft stay intact.
  function close() { if (!visible.current || blockedRef.current || locked.current) return; onClose() }
  function back() { if (!visible.current || blockedRef.current || confirmationPending || locked.current) return; onBack?.() }
  async function choose() {
    const id = session.current
    if (!visible.current || blockedRef.current || confirmationPending || !id || locked.current || !window.desktop) return
    const request = ++sequence.current; setChoosing(true); setError("")
    try {
      const selected = await window.desktop.chooseAvatar(id, avatar?.draftId ?? null)
      if (!alive.current || session.current !== id || sequence.current !== request) return
      if (selected) { setAvatar(selected); onDraftChanged?.() }
    } catch (cause) { if (alive.current && session.current === id && sequence.current === request) setError(cause instanceof Error ? cause.message : "头像读取失败") }
    finally { if (alive.current && session.current === id && sequence.current === request) setChoosing(false) }
  }
  async function save() {
    const id = session.current
    if (!visible.current || blockedRef.current || locked.current || choosing) return
    if (confirmationPending) {
      if (!onRetry) { setError("上次提交尚待确认，请重新打开引导"); return }
      locked.current = true; setSaving(true); setError("")
      try { await onRetry(); if (alive.current) { release(); (onSaved ?? onClose)() } }
      catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : "资料保存确认失败") }
      finally { locked.current = false; if (alive.current) setSaving(false) }
      return
    }
    if (!id) return
    const parsed = settingsSchema.shape.user.safeParse(profile)
    if (!parsed.success) {
      setError("请填写1至80字的笔名和有效的邮件地址，邮件也可以留空")
      if (parsed.error.issues.some(issue => issue.path[0] === "penName")) nameInput.current?.focus(); else emailInput.current?.focus()
      return
    }
    locked.current = true; setSaving(true); setError("")
    try {
      await (onSubmit ?? saveDesktopProfile)(id, parsed.data, avatar?.draftId)
      if (alive.current && session.current === id) { release(); (onSaved ?? onClose)() }
    } catch (cause) { if (alive.current && session.current === id) setError(cause instanceof Error ? cause.message : "资料保存失败") }
    finally { locked.current = false; if (alive.current) setSaving(false) }
  }
  return <Dialog open={open} onOpenChange={value => { if (!value) close() }}>
    <DialogContent data-desktop-settings-surface showCloseButton={false} initialFocus={nameInput} finalFocus={finalFocus} className={`desktop-profile-editor${onboarding ? " desktop-onboarding desktop-onboarding-editor" : ""}`}>
      <div className={onboarding ? "desktop-onboarding-head" : "flex items-center justify-between"}>
        <DialogTitle>{title}</DialogTitle>
        <Button variant="ghost" size="icon-sm" className={onboarding ? "desktop-onboarding-close" : undefined} aria-label={onboarding ? "暂时退出引导" : "关闭编辑用户"} disabled={disabled} onClick={close}><X size={17} /></Button>
        <DialogDescription className={onboarding ? "desktop-onboarding-description" : "sr-only"}>{onboarding ? "为你的创作署名。头像和邮件可以稍后补充。" : "修改本地头像、笔名与邮件，保存后生效"}</DialogDescription>
      </div>
      <div className={onboarding ? "desktop-onboarding-body" : "desktop-profile-body"}>
        <div className="desktop-profile-form">
          <button type="button" className="desktop-user-avatar profile relative overflow-hidden" aria-label="选择头像" title="选择 PNG、JPEG 或 WebP 图片（不超过10MB）" disabled={fieldsDisabled} onClick={() => { void choose() }}>
            <Avatar name={profile.penName} source={avatar?.previewDataUrl ?? assetUrl(profile.avatarAssetId)} /><span className="desktop-avatar-action">{choosing ? <LoaderCircle size={15} className="animate-spin" /> : <ImagePlus size={15} />}{choosing ? "读取中…" : "更换头像"}</span>
          </button>
          <fieldset className="flex min-w-0 flex-1 flex-col gap-4" disabled={fieldsDisabled}>
            <label>笔名<Input ref={nameInput} aria-label="笔名" autoComplete="off" maxLength={80} value={profile.penName} onChange={event => { if (fieldsDisabled) return; setProfile({ ...profile, penName: event.target.value }); setError(""); onDraftChanged?.() }} /></label>
            <label>邮件{onboarding && <span className="desktop-onboarding-optional">可选</span>}<Input ref={emailInput} aria-label="邮件" type="email" autoComplete="off" value={profile.email} placeholder={onboarding ? "可以留空" : undefined} onChange={event => { if (fieldsDisabled) return; setProfile({ ...profile, email: event.target.value }); setError(""); onDraftChanged?.() }} /></label>
          </fieldset>
        </div>
        {onboarding && <p className="desktop-onboarding-form-hint">资料仅用于本地身份显示。头像支持 PNG、JPEG、WebP，不超过 10 MB。</p>}
        {confirmationPending && <p role="status" className="desktop-onboarding-form-hint">上次提交已保存，请先点击继续确认写入后再修改。</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </div>
      <div className={onboarding ? "desktop-onboarding-footer" : "flex justify-end gap-2"}>
        {onBack ? <Button variant="ghost" disabled={fieldsDisabled} onClick={back}><ArrowLeft size={16} />返回</Button> : <Button variant="outline" disabled={disabled} onClick={close}>取消</Button>}
        <Button className={onboarding ? "desktop-onboarding-continue" : undefined} disabled={disabled || choosing} onClick={() => { void save() }}>{saving && <LoaderCircle className="animate-spin" size={15} />}{submitLabel}{onboarding && <ArrowRight size={16} />}</Button>
      </div>
    </DialogContent>
  </Dialog>
}
export function ProfileSettings() {
  const user = useDesktopStore(state => state.bootstrap!.settings.user)
  const [editing, setEditing] = useState(false)
  const editButton = useRef<HTMLButtonElement>(null)
  return <>
    <div className="desktop-user-card"><div className="desktop-user-avatar relative overflow-hidden"><Avatar name={user.penName} source={assetUrl(user.avatarAssetId)} /></div><div className="min-w-0 flex-1"><strong className="block truncate" title={user.penName}>{user.penName}</strong><p className="truncate" title={user.email}>{user.email}</p></div><Button ref={editButton} variant="ghost" size="icon" aria-label="编辑用户" title="编辑用户" className="shrink-0" onClick={() => setEditing(true)}><Pencil size={17} /></Button></div>
    {editing && <ProfileEditorDialog finalFocus={editButton} onClose={() => setEditing(false)} />}
  </>
}
