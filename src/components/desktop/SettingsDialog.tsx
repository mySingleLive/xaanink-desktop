"use client"
import { useEffect, useState, type ReactNode } from "react"
import { Bot, Box, CircleHelp, Keyboard, Monitor, Settings, User, X } from "lucide-react"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { useDesktopStore, updateDesktopSettings } from "@/stores/desktop"
import type { Settings as AppSettings } from "@desktop/core/settings"
import { ShortcutSettings } from "./ShortcutSettings"
import { AppearanceNumber } from "./AppearanceNumber"
import { localFontFamilies } from "@/lib/desktop/appearance"
import { ModelSettings } from "./ModelSettings"
import { AgentSettings } from "./AgentSettings"
import { ProfileSettings } from "./ProfileSettings"
import {ConfigurationImportButton,ConfigurationExportButton} from "./ConfigurationTransfer"
import {DataRootMigrationButton} from "./DataRootMigrationButton"
const sections = [{ id: "general", label: "通用", Icon: Settings }, { id: "user", label: "用户", Icon: User }, { id: "agent", label: "智能体", Icon: Bot }, { id: "models", label: "模型", Icon: Box }, { id: "appearance", label: "外观", Icon: Monitor }, { id: "shortcuts", label: "快捷键", Icon: Keyboard }, { id: "about", label: "关于我们", Icon: CircleHelp }]
function Group({ title, children }: { title: string; children: ReactNode }) { return <section className="desktop-settings-group"><h3>{title}</h3><div>{children}</div></section> }
function Row({ title, hint, stacked, children }: { title: string; hint?: string; stacked?: boolean; children: ReactNode }) { return <div className={`desktop-setting-row ${stacked ? "stacked" : ""}`}><label><span>{title}</span>{hint && <small>{hint}</small>}</label><div className="desktop-setting-control">{children}</div></div> }
export function SettingsDialog({ open, onOpenChange, initialSection }: { open: boolean; onOpenChange(open: boolean): void; initialSection?: string }) {
  const bootstrap = useDesktopStore(state => state.bootstrap)!
  const saving = useDesktopStore(state => state.saving)
  const error = useDesktopStore(state => state.error)
  const [page, setPage] = useState("general")
  useEffect(() => { if (open && initialSection && sections.some(section => section.id === initialSection)) setPage(initialSection) }, [open,initialSection])
  const [fonts, setFonts] = useState<string[]>([])
  const [fontError, setFontError] = useState("")
  const [fontsLoaded, setFontsLoaded] = useState(false)
  const fontMissing = (font: string) => fontsLoaded && !["system","serif","sans-serif","monospace"].includes(font) && !fonts.includes(font)
  async function loadFonts() { try { setFonts(await localFontFamilies()); setFontsLoaded(true); setFontError("") } catch { setFontsLoaded(false); setFontError("无法读取本机字体，可继续使用系统默认和通用字体") } }
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      const surfaces = [...document.querySelectorAll<HTMLElement>('[data-desktop-settings-surface], .desktop-settings, [data-slot="select-content"]')]
      if (surfaces.some(surface => { const r=surface.getBoundingClientRect(); return r.width > 0 && r.height > 0 && event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom })) return
      event.preventDefault(); event.stopImmediatePropagation()
      let cleanupTimer: ReturnType<typeof setTimeout> | undefined
      const cleanupGesture = () => {
        clearTimeout(cleanupTimer)
        document.removeEventListener("click",blockClick,true)
        document.removeEventListener("pointerup",releaseGesture,true)
        document.removeEventListener("pointercancel",cleanupGesture,true)
        window.removeEventListener("blur",cleanupGesture,true)
      }
      const blockClick = (click: MouseEvent) => { click.preventDefault(); click.stopImmediatePropagation(); cleanupGesture() }
      const releaseGesture = () => { cleanupTimer = setTimeout(cleanupGesture,0) }
      document.addEventListener("click",blockClick,{capture:true,once:true})
      document.addEventListener("pointerup",releaseGesture,{capture:true,once:true})
      document.addEventListener("pointercancel",cleanupGesture,{capture:true,once:true})
      window.addEventListener("blur",cleanupGesture,{capture:true,once:true})
      onOpenChange(false)
    }
    document.addEventListener("pointerdown",outside,true)
    return () => document.removeEventListener("pointerdown",outside,true)
  }, [open,onOpenChange])
  const settings = bootstrap.settings
  const change = (update: (before: AppSettings) => AppSettings) => { void updateDesktopSettings(update).catch(error => toast.error(error.message)) }
  const appearance = (key: keyof AppSettings["appearance"], value: string | number | boolean) => change(before => ({ ...before, appearance: { ...before.appearance, [key]: value } }))
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent data-desktop-settings-surface showCloseButton={false} className="desktop-settings chatpane">
    <aside className="desktop-settings-nav"><DialogTitle className="desktop-settings-title">设置</DialogTitle><DialogDescription className="sr-only">管理本地应用、用户、智能体和外观配置</DialogDescription><nav aria-label="设置分类">{sections.map(({ id, label, Icon }) => <button key={id} aria-current={page === id ? "page" : undefined} onClick={() => { setPage(id); if (id === "appearance") void loadFonts() }}><Icon size={17} />{label}</button>)}</nav></aside>
    <div className="desktop-settings-right"><button className="desktop-settings-close desktop-control" aria-label="关闭设置" onClick={() => onOpenChange(false)}><X size={17} /></button><div className="desktop-settings-body">
      {page === "general" && <><Group title="本地创作"><Row title="应用数据目录" stacked><div className="flex gap-2"><Input readOnly value={bootstrap.dataRoot} aria-label="应用数据目录" />{open&&<DataRootMigrationButton/>}</div></Row><Row title="默认作品父目录" hint="每个新作品仍需指定独立目录" stacked><div className="flex gap-2"><Input readOnly value={settings.general.defaultParent} aria-label="默认作品父目录" placeholder="尚未选择" /><Button variant="outline" onClick={async () => { const grant = await window.desktop?.chooseDirectory("default-parent"); if (grant) change(before => ({ ...before, general: { ...before.general, defaultParent: grant.path } })) }}>选择</Button></div></Row><Row title="启动时恢复上次工作台"><Switch aria-label="启动时恢复上次工作台" checked={settings.general.restoreSession} onCheckedChange={value => change(before => ({ ...before, general: { ...before.general, restoreSession: value } }))} /></Row></Group><Group title="草稿"><Row title="保留的草稿"><Button variant="outline" onClick={()=>window.dispatchEvent(new Event("desktop:recovery"))}>查看草稿</Button></Row></Group><Group title="配置管理"><Row title="配置导入">{open&&<ConfigurationImportButton/>}</Row><Row title="配置导出">{open&&<ConfigurationExportButton/>}</Row></Group></>}
      {open && page === "user" && <ProfileSettings />}
      {page === "agent" && <AgentSettings />}
      {open && page === "models" && <ModelSettings />}
      {page === "appearance" && <><Group title="界面"><Row title="主题" stacked><div className="desktop-theme-options">{(['paper','ink','system'] as const).map((theme,index) => <button key={theme} aria-pressed={settings.appearance.theme === theme} onClick={() => appearance('theme', theme)}><div className={`desktop-theme-preview ${theme}`}><i /><div><b /><span /><span /><span /></div></div><span>{['宣纸','玄墨','跟随系统'][index]}</span></button>)}</div></Row><Row title="界面字体"><select aria-label="界面字体" value={settings.appearance.uiFont} onChange={event => appearance('uiFont',event.target.value)}><option value="system">系统默认</option><option value="serif">宋体</option><option value="sans-serif">无衬线</option><option value="monospace">等宽字体</option>{[...new Set([...fonts,settings.appearance.uiFont])].filter(font => !['system','serif','sans-serif','monospace'].includes(font)).map(font => <option value={font} key={font}>{font}{fontMissing(font) ? "（不可用）" : ""}</option>)}</select>{fontError && <small role="status">{fontError}</small>}{fontMissing(settings.appearance.uiFont) && <small role="status">此字体当前不可用，已回退到系统默认字体（system-ui）。</small>}</Row><Row title="界面字号"><AppearanceNumber label="界面字号" value={settings.appearance.uiFontSize} min={11} max={24} step={1} onValue={value => updateDesktopSettings(before => ({ ...before, appearance: { ...before.appearance, uiFontSize: value } }))} /></Row><Row title="界面缩放"><select aria-label="界面缩放" value={settings.appearance.zoom} onChange={event => appearance('zoom',Number(event.target.value))}>{[.75,1,1.25,1.5,2].map(value => <option key={value} value={value}>{value*100}%</option>)}</select></Row></Group><Group title="正文"><Row title="正文字体"><select aria-label="正文字体" value={settings.appearance.bodyFont} onChange={event => appearance('bodyFont',event.target.value)}><option value="serif">宋体</option><option value="system">系统默认</option><option value="sans-serif">无衬线</option><option value="monospace">等宽字体</option>{[...new Set([...fonts,settings.appearance.bodyFont])].filter(font => !['system','serif','sans-serif','monospace'].includes(font)).map(font => <option value={font} key={font}>{font}{fontMissing(font) ? "（不可用）" : ""}</option>)}</select>{fontMissing(settings.appearance.bodyFont) && <small role="status">此字体当前不可用，已回退到{["Noto Serif SC","Songti SC","STSong","SimSun"].find(font => fonts.includes(font)) ?? "系统衬线字体（serif）"}；缺字使用系统回退。</small>}</Row><Row title="正文字号"><AppearanceNumber label="正文字号" value={settings.appearance.bodyFontSize} min={12} max={40} step={1} onValue={value => updateDesktopSettings(before => ({ ...before, appearance: { ...before.appearance, bodyFontSize: value } }))} /></Row><Row title="正文行距"><AppearanceNumber label="正文行距" value={settings.appearance.lineHeight} min={1.2} max={3} step={0.1} onValue={value => updateDesktopSettings(before => ({ ...before, appearance: { ...before.appearance, lineHeight: value } }))} /></Row><Row title="显示正文行号" hint="仅编辑或分屏模式显示"><Switch aria-label="显示正文行号" checked={settings.appearance.lineNumbers} onCheckedChange={value => appearance('lineNumbers',value)} /></Row><Row title="正文自动换行"><Switch aria-label="正文自动换行" checked={settings.appearance.wordWrap} onCheckedChange={value => appearance('wordWrap',value)} /></Row></Group></>}
      {open && page === "shortcuts" && <ShortcutSettings />}
      {page === "about" && <Group title="玄印写作"><Row title="当前版本"><span>{bootstrap.version}</span></Row><Row title="问题反馈"><Button variant="outline" onClick={() => { void window.desktop?.command('help.feedback') }}>填写反馈</Button></Row><Row title="帮助文档" hint="官网文档上线后启用"><Button variant="outline" disabled title="帮助文档尚未上线">查看文档</Button></Row></Group>}
    </div>{(saving > 0 || error) && <div className="desktop-settings-status" role="status">{error ?? '正在保存…'}</div>}</div>

  </DialogContent></Dialog>
}
