import type { BrowserWindow } from "electron"
import type { EventEmitter } from "node:events"

type Rect = { x: number; y: number; width: number; height: number }
type NativeApi = Pick<typeof import("electron"), "BaseWindow" | "ImageView" | "nativeImage" | "screen">
const colors = new WeakMap<object, (color: string) => void>()

// Geometry is pinned to this app's Electron 44 Windows caption (46 DIP slot,
// 10 DIP symbol, 32 DIP overlay). Normal captions exclude the top 1 DIP border.
// Content bounds exclude maximized frame insets; these cells were calibrated
// against this pinned Electron's normal and maximized native symbol positions.
export function nativeCloseGeometry(content: Rect, maximized = false): Rect {
  return { x: content.x + content.width - 46, y: content.y + (maximized ? 0 : 1), width: 46, height: maximized ? 32 : 31 }
}

export function closeCaptionPhase(content: Rect, bounds: Rect, scale: number, project: (rect: Rect) => Rect) {
  const start = project({ ...content, width: 0, height: 0 }), host = project({ ...bounds, width: 0, height: 0 })
  // The native symbol is rounded in its owner's local client coordinates.
  // An independently positioned window rounds its screen origin separately.
  return { x: start.x + Math.round((bounds.x - content.x) * scale) - host.x,
    y: start.y + Math.round((bounds.y - content.y) * scale) - host.y }
}

export function closeGlyphBitmap(scaleFactor: number, color: string) {
  if (!Number.isFinite(scaleFactor) || scaleFactor <= 0 || !/^#[0-9a-f]{6}$/i.test(color)) throw new Error("INVALID_CAPTION_BITMAP")
  const size = Math.round(10 * scaleFactor), pixels = Buffer.alloc(size * size * 4)
  const rgb = [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16))
  // Compensate diagonal coverage while keeping the native symbol's extent.
  const stroke = Math.SQRT2 * Math.round(scaleFactor)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let covered = 0
    for (let sy = 0; sy < 8; sy++) for (let sx = 0; sx < 8; sx++) {
      const u = x + (sx + .5) / 8, v = y + (sy + .5) / 8
      if (Math.min(Math.abs(u - v), Math.abs(u + v - size)) / Math.SQRT2 <= stroke / 2) covered++
    }
    const alpha = Math.round(covered / 64 * 255), offset = (y * size + x) * 4
    // NativeImage bitmap data on Windows is premultiplied BGRA.
    pixels[offset] = Math.round(rgb[2] * alpha / 255)
    pixels[offset + 1] = Math.round(rgb[1] * alpha / 255)
    pixels[offset + 2] = Math.round(rgb[0] * alpha / 255)
    pixels[offset + 3] = alpha
  }
  return { pixels, width: size, height: size, scaleFactor }
}

export function closeCaptionBitmap(scale: number, color: string, cell: Pick<Rect, "width" | "height">, phase: { x: number; y: number }) {
  const glyph = closeGlyphBitmap(scale, color), width = Math.round(cell.width * scale), height = Math.ceil(cell.height * scale)
  const pixels = Buffer.alloc(width * height * 4), x = Math.floor((width - glyph.width) / 2) + phase.x, y = Math.floor((height - glyph.height) / 2) + phase.y
  for (let row = 0; row < glyph.height; row++) glyph.pixels.copy(pixels, ((row + y) * width + x) * 4, row * glyph.width * 4, (row + 1) * glyph.width * 4)
  return { pixels, width, height, scaleFactor: scale }
}

export function updateWindowsCloseAccentColor(owner: object, color: string) { colors.get(owner)?.(color) }

export function installWindowsCloseAccent(owner: BrowserWindow, api: NativeApi, initialColor: string,
  clock = { every: (fn: () => void, ms: number) => setInterval(fn, ms), clear: (timer: ReturnType<typeof setInterval>) => clearInterval(timer) }) {
  // No renderer, preload, IPC, session, network or author-data access. Native
  // caption hit testing, Snap, hover background and close/save remain in charge.
  const decoration = new api.BaseWindow({ parent: owner, width: 46, height: 31, frame: false, transparent: true,
    thickFrame: false, hasShadow: false, roundedCorners: false, focusable: false, skipTaskbar: true,
    resizable: false, minimizable: false, maximizable: false, show: false, title: "" })
  decoration.setIgnoreMouseEvents(true)
  const image = new api.ImageView()
  image.setBackgroundColor("#00000000"); image.setBounds({ x: 0, y: 0, width: 46, height: 31 })
  decoration.contentView.addChildView(image)
  let color = initialColor, disposed = false, bitmapKey = "", boundsKey = ""
  const lifecycle: EventEmitter = owner, displays: EventEmitter = api.screen
  const ownerEvents = ["move", "resize", "maximize", "unmaximize", "minimize", "restore", "show", "hide", "focus", "blur", "enter-full-screen", "leave-full-screen"] as const
  const displayEvents = ["display-metrics-changed", "display-added", "display-removed"] as const
  const dispose = () => {
    if (disposed) return
    disposed = true; clock.clear(timer); colors.delete(owner)
    for (const event of ownerEvents) lifecycle.removeListener(event, sync)
    lifecycle.removeListener("closed", dispose)
    for (const event of displayEvents) displays.removeListener(event, sync)
    if (!decoration.isDestroyed()) decoration.destroy()
  }
  const sync = () => {
    if (disposed) return
    if (owner.isDestroyed() || decoration.isDestroyed()) { dispose(); return }
    if (!owner.isVisible() || !owner.isEnabled() || owner.isMinimized() || owner.isFullScreen() || owner.getChildWindows().some(child => child.isModal() && child.isVisible())) {
      decoration.hide(); return
    }
    const content = owner.getContentBounds(), bounds = nativeCloseGeometry(content, owner.isMaximized())
    const scale = api.screen.getDisplayMatching(owner.getBounds()).scaleFactor, cursor = api.screen.getCursorScreenPoint()
    const hovered = cursor.x >= bounds.x && cursor.x < bounds.x + bounds.width && cursor.y >= bounds.y && cursor.y < bounds.y + bounds.height
    // Pin both coordinate conversions to the owner's display, including when
    // the decoration's origin lies over a neighboring monitor with another DPI.
    const phase = closeCaptionPhase(content, bounds, scale, rect => api.screen.dipToScreenRect(owner, rect))
    const nextBitmap = `${scale}:${bounds.height}:${phase.x}:${phase.y}:${hovered ? "#ffffff" : color}`, nextBounds = `${scale}:${JSON.stringify(bounds)}`
    if (nextBitmap !== bitmapKey) {
      const glyph = closeCaptionBitmap(scale, hovered ? "#ffffff" : color, bounds, phase)
      image.setImage(api.nativeImage.createFromBitmap(glyph.pixels, { width: glyph.width, height: glyph.height, scaleFactor: glyph.scaleFactor }))
      bitmapKey = nextBitmap
    }
    if (nextBounds !== boundsKey) {
      decoration.setBounds(bounds); image.setBounds({ x: 0, y: 0, width: bounds.width, height: bounds.height })
      decoration.setShape([{ x: 0, y: 0, width: bounds.width, height: bounds.height }]); boundsKey = nextBounds
    }
    // Visibility is deliberately independent of bitmap/geometry cache. Show
    // without activation, directly above its owner rather than other apps.
    if (!decoration.isVisible()) { decoration.showInactive(); decoration.moveAbove(owner.getMediaSourceId()) }
  }
  const updateColor = (value: string) => { color = value; sync() }
  colors.set(owner, updateColor)
  for (const event of ownerEvents) lifecycle.on(event, sync)
  for (const event of displayEvents) displays.on(event, sync)
  lifecycle.once("closed", dispose)
  const timer = clock.every(sync, 40); timer.unref?.(); sync()
  return { dispose, sync, updateColor }
}
