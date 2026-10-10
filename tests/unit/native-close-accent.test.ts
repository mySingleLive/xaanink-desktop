import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { transformSync } from "esbuild"
import ts from "typescript"

const load = () => import("../../desktop/main/native-close-accent")
for (const file of ["index", "root-maintenance-window", "root-relocation-window"]) test(`CLOSE-01 ${file} connects the accent to its actual owned window`, () => {
  const source = ts.createSourceFile(file + ".ts", readFileSync(`desktop/main/${file}.ts`, "utf8"), ts.ScriptTarget.Latest, true)
  let expression = ""
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && node.expression.getText(source) === "installWindowsCloseAccent") expression = node.getText(source)
    ts.forEachChild(node, visit)
  }
  visit(source)
  const calls: unknown[][] = [], owner = {}, api = { BaseWindow: {}, ImageView: {}, nativeImage: {}, screen: {} }
  const code = transformSync(expression ? `${expression};` : "", { loader: "ts" }).code
  new Function("process", "current", "owned", "window", "BaseWindow", "ImageView", "nativeImage", "screen", "nativeAppearance", "installWindowsCloseAccent", code)(
    { platform: "win32" }, owner, owner, owner, api.BaseWindow, api.ImageView, api.nativeImage, api.screen,
    { titleBarOverlay: { symbolColor: "#2b251b" } }, (...args: unknown[]) => calls.push(args))
  assert.equal(calls.length, 1, "The real native window must install its close accent")
  assert.equal(calls[0][0], owner); assert.deepEqual(calls[0][1], api); assert.equal(calls[0][2], "#2b251b")
})
test("CLOSE-02 glyph geometry uses client bounds and does not depend on hidden maximize borders or application zoom", async () => {
  const { nativeCloseGeometry } = await load()
  assert.deepEqual(nativeCloseGeometry({ x: 100, y: 200, width: 1440, height: 940 }), { x: 1494, y: 201, width: 46, height: 31 })
  assert.deepEqual(nativeCloseGeometry({ x: 0, y: 0, width: 2560, height: 1392 }, true), { x: 2514, y: 0, width: 46, height: 32 })
})
test("CLOSE-03 OS-scale glyph is symmetric, thicker than the native diagonal and correctly premultiplies BGRA", async () => {
  const { closeGlyphBitmap } = await load()
  for (const [scale, size] of [[1, 10], [1.25, 13], [1.5, 15], [2, 20]]) {
    const glyph = closeGlyphBitmap(scale, "#2b251b")
    assert.equal(glyph.width, size); assert.equal(glyph.height, size); assert.equal(glyph.scaleFactor, scale)
    assert.equal(glyph.pixels.length, size * size * 4)
    let alpha = 0
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4, a = glyph.pixels[i + 3]; alpha += a / 255
      assert.equal(a, glyph.pixels[(x * size + y) * 4 + 3]); assert.equal(a, glyph.pixels[(y * size + size - x - 1) * 4 + 3])
      assert.equal(glyph.pixels[i], Math.round(27 * a / 255)); assert.equal(glyph.pixels[i + 1], Math.round(37 * a / 255)); assert.equal(glyph.pixels[i + 2], Math.round(43 * a / 255))
    }
    if (scale === 1) assert(alpha > 33 && alpha < 42, `Expected compensated X ink, got ${alpha}`)
  }
  const white = closeGlyphBitmap(1, "#ffffff")
  for (let i = 0; i < white.pixels.length; i += 4) assert.equal(white.pixels[i], white.pixels[i + 3])
})
async function fixture() {
  const module = await load(), owner = new EventEmitter() as EventEmitter & Record<string, any>, display = new EventEmitter() as EventEmitter & Record<string, any>
  Object.assign(owner, { content: { x: 100, y: 200, width: 1440, height: 940 }, maximized: false, minimized: false, fullscreen: false, visible: true, enabled: true, destroyed: false, children: [] })
  Object.assign(owner, { getContentBounds: () => owner.content, getBounds: () => ({ x: -7, y: -7, width: 2576, height: 1408 }), getChildWindows: () => owner.children,
    isDestroyed: () => owner.destroyed, isMaximized: () => owner.maximized, isMinimized: () => owner.minimized, isFullScreen: () => owner.fullscreen, isVisible: () => owner.visible, isEnabled: () => owner.enabled, getMediaSourceId: () => "window:owned:0" })
  const images: any[] = [], options: any[] = [], creations: any[] = []
  class Decoration {
    destroyed = false; visible = false; bounds: any; ignored = false; shape: any; shapeCalls = 0; above: any; contentView = { addChildView: (v: any) => creations.push(v) }
    constructor(value: any) { options.push(value); creations.push(this) }
    setIgnoreMouseEvents(value: boolean) { this.ignored = value }
    setBounds(value: any) { this.bounds = value }
    setShape(value: any) { this.shape = value; this.shapeCalls++ }
    showInactive() { this.visible = true }
    hide() { this.visible = false }
    isVisible() { return this.visible }
    isDestroyed() { return this.destroyed }
    moveAbove(value: any) { this.above = value }
    destroy() { this.destroyed = true }
  }
  class Image {
    bounds: any
    setBackgroundColor(value: string) { assert.equal(value, "#00000000") }
    setBounds(value: any) { this.bounds = value }
    setImage(value: any) { images.push(value) }
  }
  let scale = 1.5, projectionShift = 0, cursor = { x: 0, y: 0 }, tick = () => {}, clears = 0
  Object.assign(display, { getDisplayMatching: () => ({ scaleFactor: scale }), getCursorScreenPoint: () => cursor,
    dipToScreenRect: (window: any, rect: any) => { assert.equal(window, owner); assert.equal(rect.width, 0); assert.equal(rect.height, 0); return { ...rect, x: Math.round(rect.x * scale), y: Math.round(rect.y * scale) + (rect.y === owner.content.y ? 0 : projectionShift) } } })
  const api = { BaseWindow: Decoration, ImageView: Image, nativeImage: { createFromBitmap: (pixels: Buffer, o: any) => ({ pixels, ...o }) }, screen: display }
  const clock = { every: (fn: () => void, ms: number) => { assert.equal(ms, 40); tick = fn; return { unref() {} } }, clear: () => { clears++ } }
  const controller = module.installWindowsCloseAccent(owner as any, api as any, "#2b251b", clock as any)
  return { ...module, owner, display, options, images, view: creations[1] as Image, decoration: creations[0] as Decoration, controller, tick: () => tick(), cursor: (p: typeof cursor) => { cursor = p }, scale: (value: number) => { scale = value }, projectionShift: (value: number) => { projectionShift = value }, clears: () => clears }
}

const firstInk = (pixels: Buffer) => { for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3]) return pixels.subarray(i, i + 4); throw new Error("No glyph") }
test("CLOSE-04 decorative native view is click-through, has no renderer, and resets visibility at identical bounds/cursor", async () => {
  const f = await fixture(), d = f.decoration, o = f.options[0]
  assert.equal(f.options.length, 1); assert.equal(o.parent, f.owner); assert.equal(o.focusable, false); assert.equal(o.skipTaskbar, true)
  assert.equal(o.transparent, true); assert.equal(o.frame, false); assert.equal(o.hasShadow, false); assert.equal(d.ignored, true)
  assert.equal(o.webPreferences, undefined); assert(d.visible); assert.deepEqual(d.shape, [{ x: 0, y: 0, width: 46, height: 31 }])
  assert.equal(d.above, f.owner.getMediaSourceId())
  f.owner.minimized = true; f.tick(); assert.equal(d.visible, false)
  f.owner.minimized = false; f.tick(); assert.equal(d.visible, true)
  f.owner.visible = false; f.tick(); assert.equal(d.visible, false)
  f.owner.visible = true; f.tick(); assert.equal(d.visible, true)
  f.owner.fullscreen = true; f.tick(); assert.equal(d.visible, false)
  f.owner.fullscreen = false; f.tick(); assert.equal(d.visible, true)
  f.owner.children = [{ isVisible: () => true, isModal: () => true }]; f.tick(); assert.equal(d.visible, false)
  f.owner.children = []; f.tick(); assert.equal(d.visible, true)
  f.owner.enabled = false; f.tick(); assert.equal(d.visible, false)
  f.owner.enabled = true; f.tick(); assert.equal(d.visible, true)
  f.controller.dispose()
})
test("CLOSE-05 move/display/hover/theme update the real controller; closing removes every listener and timer", async () => {
  const f = await fixture()
  f.owner.content = { x: 0, y: 0, width: 2560, height: 1392 }; f.owner.maximized = true; f.owner.emit("move")
  assert.deepEqual(f.decoration.bounds, { x: 2514, y: 0, width: 46, height: 32 })
  f.cursor({ x: 2538, y: 16 }); f.tick(); const white = firstInk(f.images.at(-1).pixels); assert.equal(white[0], white[3])
  f.cursor({ x: 0, y: 0 }); f.updateWindowsCloseAccentColor(f.owner, "#ece7e1"); f.tick()
  const ink = firstInk(f.images.at(-1).pixels); assert.equal(ink[0], Math.round(225 * ink[3] / 255))
  f.scale(2); f.display.emit("display-metrics-changed"); assert.equal(f.images.at(-1).width, 92)
  f.owner.emit("closed"); assert.equal(f.decoration.destroyed, true); assert.equal(f.clears(), 1)
  assert.deepEqual(f.owner.eventNames(), []); assert.deepEqual(f.display.eventNames(), [])
  const count = f.images.length; f.updateWindowsCloseAccentColor(f.owner, "#ffffff"); f.tick(); assert.equal(f.images.length, count)
})

test("CLOSE-06 actual theme setter repaints an installed accent for paper, ink and system", async () => {
  const f = await fixture(), { applyWindowAppearance } = await import("../../desktop/main/window-appearance")
  const overlays: any[] = []
  Object.assign(f.owner, { setBackgroundColor() {}, setTitleBarOverlay: (value: any) => overlays.push(value) })
  for (const [theme, dark, blue] of [["paper", true, 27], ["ink", false, 225], ["system", false, 27], ["system", true, 225]] as const) {
    applyWindowAppearance(f.owner as any, "win32", theme, dark)
    const pixels = firstInk(f.images.at(-1).pixels)
    assert.equal(pixels[0], Math.round(blue * pixels[3] / 255)); assert.equal(overlays.at(-1).height, 32)
  }
  f.controller.dispose()
})

test("CLOSE-07 caption canvas retains transparent padding and correct whole-pixel phase at fractional DPI", async () => {
  const { closeCaptionBitmap, closeCaptionPhase } = await load()
  const project = (r: any) => ({ ...r, x: Math.round(r.x * 1.5), y: Math.round(r.y * 1.5) })
  assert.deepEqual(closeCaptionPhase({ x: 831, y: 405, width: 900, height: 582 }, { x: 1685, y: 406, width: 46, height: 31 }, 1.5, project), { x: 0, y: 1 })
  assert.deepEqual(closeCaptionPhase({ x: 830, y: 404, width: 900, height: 582 }, { x: 1684, y: 405, width: 46, height: 31 }, 1.5, project), { x: 0, y: 0 })
  assert.deepEqual(closeCaptionPhase({ x: 0, y: 0, width: 2560, height: 1392 }, { x: 2514, y: 0, width: 46, height: 32 }, 1.5, project), { x: 0, y: 0 })
  for (const scale of [1, 1.25, 1.5, 2]) for (const height of [31, 32]) for (const phase of [{ x: -1, y: -1 }, { x: 0, y: 0 }, { x: 1, y: 1 }]) {
    const b = closeCaptionBitmap(scale, "#2b251b", { width: 46, height }, phase), size = Math.round(10 * scale)
    assert.equal(b.width, Math.round(46 * scale)); assert.equal(b.height, Math.ceil(height * scale))
    const left = Math.floor((b.width - size) / 2) + phase.x, top = Math.floor((b.height - size) / 2) + phase.y
    for (let y = 0; y < b.height; y++) for (let x = 0; x < b.width; x++) {
      const i = (y * b.width + x) * 4
      if (x < left || x >= left + size || y < top || y >= top + size) assert.deepEqual([...b.pixels.subarray(i, i + 4)], [0, 0, 0, 0])
    }
    assert(b.pixels[(top * b.width + left) * 4 + 3] > 0); assert.equal(b.scaleFactor, scale)
  }
})

test("CLOSE-08 projection and scale changes repaint at identical DIP bounds, reshape, and include the maximized top hover edge", async () => {
  const f = await fixture(), bounds = { ...f.decoration.bounds }, first = f.images.at(-1), count = f.images.length
  f.projectionShift(1); f.tick(); assert.deepEqual(f.decoration.bounds, bounds); assert.equal(f.images.length, count + 1); assert.notDeepEqual(f.images.at(-1).pixels, first.pixels)
  const shapes = f.decoration.shapeCalls; f.scale(2); f.tick(); assert.equal(f.decoration.shapeCalls, shapes + 1)
  f.owner.maximized = true; f.owner.emit("maximize"); assert.equal(f.decoration.bounds.y, 200); assert.equal(f.view.bounds.height, 32); assert.equal(f.decoration.shape[0].height, 32)
  f.cursor({ x: 1494, y: 200 }); f.tick(); const white = firstInk(f.images.at(-1).pixels); assert.equal(white[0], white[3])
  for (const cursor of [{ x: 1540, y: 200 }, { x: 1494, y: 232 }]) { f.cursor(cursor); f.tick(); const normal = firstInk(f.images.at(-1).pixels); assert.equal(normal[0], Math.round(27 * normal[3] / 255)) }
  f.owner.maximized = false; f.owner.emit("unmaximize"); assert.equal(f.view.bounds.height, 31); assert.equal(f.decoration.shape[0].height, 31)
  f.controller.dispose()
})
