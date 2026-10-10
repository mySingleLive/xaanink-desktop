import assert from "node:assert/strict"
import test from "node:test"
import { chromium, type Browser, type Page } from "playwright-core"
import { frames, withContentTabs } from "../helpers/content-tabs-fixture"

let browser: Browser
test.before(async () => { browser = await chromium.launch({ headless: true, ignoreDefaultArgs: ["--hide-scrollbars"], ...(process.env.XAANINK_TEST_CHROMIUM ? { executablePath: process.env.XAANINK_TEST_CHROMIUM } : {}) }) })
test.after(async () => { await browser?.close() })
const tab = (page: Page, id: string) => page.locator(`.content-tabs-track .content-tab[data-tab-id="${id}"]`)
const order = (page: Page) => page.evaluate(() => (window as any).tabsFixture.order() as string[])
const active = (page: Page) => page.evaluate(() => (window as any).tabsFixture.state().activeTabId as string | null)
const menu = (page: Page) => page.getByRole("button", { name: "所有标签", exact: true })
async function openMenu(page: Page) {
  if (await menu(page).getAttribute("aria-expanded") !== "true") await menu(page).click()
  await page.getByRole("menuitemradio").first().waitFor({ state: "visible" })
}
async function layout(page: Page) {
  assert.equal(await page.locator(".content-tabs-caption").count(), 1, "Approved layout requires separate caption, clipped tablist and tool group")
  return page.evaluate(() => {
    const caption = document.querySelector<HTMLElement>(".content-tabs-caption")!, viewport = document.querySelector<HTMLElement>(".content-tabs-viewport")!, track = document.querySelector<HTMLElement>(".content-tabs-track")!, selected = track.querySelector<HTMLElement>('[aria-selected="true"]')!, panel = caption.closest<HTMLElement>(".content-tabs")!, tools = document.querySelector<HTMLElement>(".content-tabs-tools")!
    const c = caption.getBoundingClientRect(), v = viewport.getBoundingClientRect(), s = selected.getBoundingClientRect(), css = getComputedStyle(selected), vcs = getComputedStyle(viewport), line = getComputedStyle(caption, "::after")
    return { captionHeight: c.height, tabHeight: s.height, top: s.top - c.top, bottom: c.bottom - s.bottom, radius: parseFloat(css.borderRadius), background: css.backgroundColor, bodyBackground: getComputedStyle(panel).backgroundColor, border: css.borderTopColor, shadow: css.boxShadow, cursor: css.cursor, allDefault: [...caption.querySelectorAll("button,.content-tab *")].every(el => getComputedStyle(el).cursor === "default"), overflowX: vcs.overflowX, overflowY: vcs.overflowY, clientHeight: viewport.clientHeight, scrollHeight: viewport.scrollHeight, viewportWidth: v.width, selectedVisible: s.right > v.left && s.left < v.right, widths: [...track.querySelectorAll<HTMLElement>(".content-tab")].map(el => el.getBoundingClientRect().width), line: { content: line.content, bottom: line.bottom, height: line.height }, controls: [...tools.querySelectorAll("button")].map(el => { const r = el.getBoundingClientRect(); return { center: r.top + r.height / 2 - c.top, right: r.right, width: r.width } }), paddingRight: parseFloat(getComputedStyle(caption).paddingRight), paneRight: panel.getBoundingClientRect().right, region: getComputedStyle(caption).getPropertyValue("-webkit-app-region"), tabRegion: css.getPropertyValue("-webkit-app-region") }
  })
}
const near = (actual: number, expected: number, label: string) => assert(Math.abs(actual - expected) < .15, `${label}: ${actual} expected ${expected}`)
async function approvedGeometry(page: Page, zoom: number, theme: "paper" | "ink") {
  const g = await layout(page)
  near(g.captionHeight * zoom, 44, "caption DIP height"); near(g.tabHeight * zoom, 32, "tab DIP height")
  near(g.top * zoom, 6, "top spacing"); near(g.bottom * zoom, 6, "bottom spacing"); near(g.radius * zoom, 6, "small rectangular radius")
  assert.equal(g.overflowX, "hidden"); assert.equal(g.overflowY, "hidden"); assert.equal(g.clientHeight, g.scrollHeight)
  assert.equal(g.shadow, "none"); assert.equal(g.cursor, "default"); assert.equal(g.allDefault, true)
  assert(g.widths.every(w => w <= 208 / zoom + .15 && w <= g.viewportWidth + .15))
  assert.equal(g.line.bottom, "0px"); assert.notEqual(g.line.content, "none"); assert(parseFloat(g.line.height) > 0)
  assert.equal(g.region, "drag"); assert.equal(g.tabRegion, "no-drag")
  for (const control of g.controls) { near(control.center * zoom, 16, "control center DIP"); near(control.width * zoom, 24, "control size DIP"); assert(control.right <= g.paneRight - g.paddingRight + .2) }
  if (theme === "paper") assert.equal(g.background, g.bodyBackground)
  else { assert.equal(g.background, "rgb(42, 40, 38)"); assert.equal(g.border, "rgb(75, 70, 64)"); assert.notEqual(g.background, g.bodyBackground) }
}
async function assertFade(page: Page) {
  await frames(page)
  const titles = await page.locator(".content-tab-title").evaluateAll(els => els.map(el => { const h = el as HTMLElement, css = getComputedStyle(el); return { overflow: h.scrollWidth > h.clientWidth + 1, marked: h.dataset.overflow === "true", mask: css.maskImage, textOverflow: css.textOverflow } }))
  assert(titles.length > 0)
  for (const t of titles) { assert.equal(t.marked, t.overflow); assert.equal(t.mask !== "none", t.overflow); assert.notEqual(t.textOverflow, "ellipsis") }
}
async function beginDrag(page: Page, id: string) {
  const r = await tab(page, id).boundingBox(); assert(r)
  const x = r.x + 21, y = r.y + 11
  await page.evaluate(() => { document.addEventListener("pointerdown", e => { (window as any).fixturePointer = e.pointerId }, { once: true, capture: true }) })
  await page.mouse.move(x, y); await page.mouse.down()
  return { x, y, left: r.x, top: r.y }
}
async function clearDrag(page: Page) { await frames(page); assert.equal(await page.locator(".content-tab-drag-preview").count(), 0); assert.equal(await page.locator(".content-tab-drag-source").count(), 0); assert.equal(await page.locator(".content-tabs-drop-marker:visible").count(), 0); assert(await page.locator(".content-tabs-track .content-tab").evaluateAll(els => els.every(el => !el.hasPointerCapture((window as any).fixturePointer)))) }

for (const theme of ["paper", "ink"] as const) test(`TABS-01/03 actual ${theme} geometry, cursor, clipped scrollbar and selected treatment (1/3/20 tabs)`, async () => {
  for (const count of [1, 3, 20]) await withContentTabs(browser, { count, theme }, async page => { await approvedGeometry(page, 1, theme); await assertFade(page); assert.equal(await menu(page).count(), count === 20 ? 1 : 0) })
})
test("TABS-04/05 font/zoom/pane changes and actual title overflow, full suffix/badge/cover", () => withContentTabs(browser, { count: 6 }, async page => {
  await layout(page)
  for (const zoom of [.75, 1, 1.25, 1.5, 2]) for (const font of [11, 14, 24]) {
    await page.evaluate(({ zoom, font }) => (window as any).tabsFixture.appearance(zoom, font, "paper"), { zoom, font }); await frames(page)
    await approvedGeometry(page, zoom, "paper"); await assertFade(page)
  }
  await page.evaluate(() => (window as any).tabsFixture.appearance(1, 14, "paper")); await frames(page)
  assert.equal(await tab(page, "t0").locator('[data-tab-type="chapter-content"]').innerText(), "· 正文")
  assert.equal(await tab(page, "t4").locator('[data-tab-type="chapter-outline"]').innerText(), "· 大纲")
  assert.equal(await tab(page, "t5").locator('[data-tab-type="chapter-candidate"]').innerText(), "· 候选稿")
  assert.equal(await tab(page, "t3").getByText("暂定", { exact: true }).count(), 1); assert.equal(await tab(page, "t3").locator("img").count(), 1)
  await page.evaluate(() => (window as any).tabsFixture.rename("t0", "短")); await assertFade(page); assert.notEqual(await tab(page, "t0").locator(".content-tab-title").getAttribute("data-overflow"), "true")
  await page.evaluate(() => (window as any).tabsFixture.rename("t0", "English title that keeps extending until it exceeds the available rectangle width many times")); await assertFade(page)
  for (const width of [440, 320, 220]) {
    await page.evaluate(w => (window as any).tabsFixture.resize(w), width); await frames(page); await assertFade(page)
    assert.equal(await menu(page).count(), 1); assert(await menu(page).isVisible())
    const r = await menu(page).boundingBox(); assert(r); assert(r.x >= 1200 - width - .2 && r.x + r.width <= 1200 - 138)
  }
  // Font metrics changing without a title update must be observed too.
  await page.addStyleTag({ content: ".content-tab-title {font-family:monospace!important;font-size:18px!important}" }); await assertFade(page)
}))
test("TABS-06/07 manual roving focus, click/middle/close and native tools", () => withContentTabs(browser, {}, async page => {
  await layout(page); await tab(page, "t0").focus(); await page.keyboard.press("ArrowRight")
  assert.equal(await active(page), "t0"); assert(await tab(page, "t1").evaluate(el => el === document.activeElement))
  assert.equal(await page.locator('.content-tabs-track [role="tab"][tabindex="0"]').count(), 1)
  await page.keyboard.press("End"); assert(await tab(page, "t2").evaluate(el => el === document.activeElement)); assert.equal(await active(page), "t0")
  await page.keyboard.press("Enter"); assert.equal(await active(page), "t2")
  await page.keyboard.press("Home"); await page.keyboard.press("Space"); assert.equal(await active(page), "t0")
  await tab(page, "t1").click(); assert.equal(await active(page), "t1")
  await tab(page, "t2").click({ button: "middle" }); assert.deepEqual(await order(page), ["t0", "t1"])
  await tab(page, "t1").getByRole("button", { name: /^关闭 / }).click(); assert.equal(await active(page), "t0")
  await page.getByRole("button", { name: "进入全屏", exact: true }).click(); assert.equal(await page.getByRole("button", { name: "退出全屏", exact: true }).getAttribute("aria-pressed"), "true")
  await page.getByRole("button", { name: "显示 / 隐藏内容面板", exact: true }).press("Enter"); assert.equal(await page.locator(".content-tabs").count(), 0)
  await page.locator("#fixture-restore").click(); await layout(page)
  await tab(page, "t0").getByRole("button", { name: /^关闭 / }).click(); assert.equal(await page.getByRole("tablist").count(), 0)
  await page.getByRole("button", { name: "隐藏内容面板", exact: true }).click(); await page.locator("#fixture-restore").click()
  assert(await page.getByRole("button", { name: "隐藏内容面板", exact: true }).isVisible())
}))
test("TABS-01/07 initial empty panel exposes native hide and restoration", () => withContentTabs(browser, { count: 0, width: 440 }, async page => {
  assert.equal(await page.getByRole("tablist").count(), 0)
  const hide = page.getByRole("button", { name: "隐藏内容面板", exact: true }); assert(await hide.isVisible())
  const geometry = await hide.evaluate(el => { const header = el.parentElement!, h = header.getBoundingClientRect(), b = el.getBoundingClientRect(); return { height: h.height, center: b.top + b.height / 2, right: b.right, region: getComputedStyle(header).getPropertyValue("-webkit-app-region") } })
  near(geometry.height, 44, "empty caption"); near(geometry.center, 16, "empty hide center"); assert(geometry.right <= 1200 - 138); assert.equal(geometry.region, "drag")
  await hide.press("Space"); assert.equal(await page.locator(".content-tabs").count(), 0); await page.locator("#fixture-restore").click(); assert(await hide.isVisible())
}))
test("TABS-05/07 extreme narrow viewport keeps all-label menu and compact fullscreen/hide actions reachable", () => withContentTabs(browser, { count: 20, width: 240 }, async page => {
  assert.equal(await page.locator(".content-tabs-caption").count(), 1)
  const trigger = menu(page); assert(await trigger.isVisible()); const r = await trigger.boundingBox(); assert(r); assert(r.x >= 960 && r.x + r.width <= 1200 - 138)
  const width = await page.locator(".content-tabs-viewport").evaluate(el => el.getBoundingClientRect().width); assert(width < 50)
  await openMenu(page); assert.equal(await page.getByRole("menuitemradio").count(), 20)
  assert(await page.getByRole("menuitem", { name: "进入全屏", exact: true }).isVisible()); assert(await page.getByRole("menuitem", { name: "显示 / 隐藏内容面板", exact: true }).isVisible())
  await page.getByRole("menuitemradio").last().click(); assert.equal(await active(page), "t19")
  await openMenu(page); await page.getByRole("menuitem", { name: "关闭 隔离标题 19", exact: true }).click(); assert.equal(await active(page), "t18")
  await openMenu(page); await page.getByRole("menuitem", { name: "进入全屏", exact: true }).click(); assert.deepEqual(await page.evaluate(() => (window as any).tabsFixture.calls), ["fullscreen"])
  await openMenu(page); await page.getByRole("menuitem", { name: "显示 / 隐藏内容面板", exact: true }).click(); assert.equal(await page.locator(".content-tabs").count(), 0)
}))
test("TABS-05/06 overflow menu full labels/radio/close/keys/escape and local wheel/reveal", () => withContentTabs(browser, { count: 20, width: 440 }, async page => {
  await layout(page); await openMenu(page); assert.equal(await page.getByRole("menuitemradio").count(), 20)
  const first = page.getByRole("menuitemradio").first(); assert.equal(await first.getAttribute("aria-checked"), "true")
  assert.equal(await first.locator("button").count(), 0); assert((await first.innerText()).includes("用于测试文字渐隐"))
  const nonce = await page.evaluate(() => (window as any).tabsFixture.state().activationNonce)
  await first.click(); assert.equal(await page.evaluate(() => (window as any).tabsFixture.state().activationNonce), nonce + 1, "Selecting the current menu radio retains normal repeated activation semantics")
  await page.getByRole("menu", { name: "所有标签", exact: true }).waitFor({ state: "hidden", timeout: 3000 })
  assert.equal(await menu(page).getAttribute("aria-expanded"), "false", "Selecting current radio closes the popup")
  await openMenu(page)
  await page.keyboard.press("ArrowDown"); await page.keyboard.press("Escape")
  await page.waitForFunction(() => document.querySelector(".content-tabs-menu-trigger") === document.activeElement, null, { timeout: 3000 })
  await openMenu(page); await page.getByRole("menuitemradio").last().click(); assert.equal(await active(page), "t19")
  await page.getByRole("menu", { name: "所有标签", exact: true }).waitFor({ state: "hidden", timeout: 3000 })
  assert.equal(await menu(page).getAttribute("aria-expanded"), "false", "Selecting last radio closes the popup"); await frames(page)
  const scroll = await page.locator(".content-tabs-viewport").evaluate(el => ({ left: el.scrollLeft, outer: document.querySelector("#outer-fixture")!.scrollLeft, windowX: scrollX, windowY: scrollY }))
  assert(scroll.left > 0); assert.equal(scroll.outer, 0); assert.equal(scroll.windowX, 0); assert.equal(scroll.windowY, 0); assert((await layout(page)).selectedVisible)
  await openMenu(page); await page.getByRole("menuitem", { name: "关闭 隔离标题 19", exact: true }).click(); assert.equal(await active(page), "t18"); assert.equal((await order(page)).length, 19); await page.keyboard.press("Escape")
  const viewport = page.locator(".content-tabs-viewport"); const before = await viewport.evaluate(el => el.scrollLeft)
  await viewport.hover(); await page.mouse.wheel(-150, 0); await frames(page); const after = await viewport.evaluate(el => el.scrollLeft); assert(after < before)
  assert.deepEqual(await page.evaluate(() => [document.querySelector("#outer-fixture")!.scrollLeft, scrollX, scrollY]), [0, 0, 0])
}))
test("TABS-12 real global command capture yields to focused tab sorting while other/close-button focus keeps navigation", () => withContentTabs(browser, { commands: true }, async page => {
  await layout(page); await page.evaluate(() => (window as any).tabsFixture.seedHistory()); await frames(page)
  assert.equal(await active(page), "t1")
  assert.deepEqual(await page.evaluate(() => (window as any).tabsFixture.navigationSnapshot()), { canBack: true, canForward: true, pending: false })
  const nonce = await page.evaluate(() => (window as any).tabsFixture.state().activationNonce)
  await tab(page, "t1").focus()
  for (const modified of ["Control+Alt+ArrowRight", "Meta+Alt+ArrowRight", "Shift+Alt+ArrowRight"]) {
    await page.keyboard.press(modified); await frames(page); assert.deepEqual(await order(page), ["t0", "t1", "t2"], modified)
    assert.equal(await active(page), "t1"); assert.deepEqual(await page.evaluate(() => (window as any).tabsFixture.navigationCalls), [])
  }
  await page.keyboard.press("Alt+ArrowRight"); await frames(page)
  assert.deepEqual(await order(page), ["t0", "t2", "t1"], "Tab owns Alt+ArrowRight before window capture navigation")
  assert.equal(await active(page), "t1"); assert.equal(await page.evaluate(() => (window as any).tabsFixture.state().activationNonce), nonce)
  assert.deepEqual(await page.evaluate(() => (window as any).tabsFixture.navigationCalls), [])
  await page.keyboard.press("Alt+ArrowLeft"); await frames(page); assert.deepEqual(await order(page), ["t0", "t1", "t2"])
  assert.equal(await active(page), "t1"); assert.deepEqual(await page.evaluate(() => (window as any).tabsFixture.navigationCalls), [])
  await tab(page, "t0").focus(); await page.keyboard.press("Alt+ArrowLeft"); await frames(page)
  assert.deepEqual(await order(page), ["t0", "t1", "t2"]); assert.equal(await active(page), "t1"); assert.deepEqual(await page.evaluate(() => (window as any).tabsFixture.navigationCalls), [], "First-tab boundary still belongs to sorting")
  await tab(page, "t1").getByRole("button", { name: /^关闭 / }).focus(); await page.keyboard.press("Alt+ArrowLeft"); await frames(page)
  assert.equal(await active(page), "t0", "Close button keeps normal global back navigation")
  assert.deepEqual(await order(page), ["t0", "t1", "t2"], "Close button must not bubble into sorting")
  assert.deepEqual(await page.evaluate(() => (window as any).tabsFixture.navigationCalls), ["t0"])
  await page.locator("#fixture-restore").focus(); await page.keyboard.press("Alt+ArrowRight"); await frames(page)
  assert.equal(await active(page), "t1"); assert.deepEqual(await page.evaluate(() => (window as any).tabsFixture.navigationCalls), ["t0", "t1"])
  await page.getByRole("textbox", { name: "草稿 t1", exact: true }).focus(); await page.keyboard.press("Alt+ArrowRight"); await frames(page)
  assert.equal(await active(page), "t2"); assert.deepEqual(await order(page), ["t0", "t1", "t2"]); assert.deepEqual(await page.evaluate(() => (window as any).tabsFixture.navigationCalls), ["t0", "t1", "t2"])
}))
test("TABS-11/12 real global Escape handler yields to drag cancellation and remains valid without dragging", () => withContentTabs(browser, { commands: true }, async page => {
  await layout(page); await tab(page, "t0").focus(); const start = await beginDrag(page, "t0")
  await page.mouse.move(start.x + 60, start.y + 10); assert.equal(await page.locator(".content-tab-drag-preview").count(), 1)
  await page.keyboard.press("Alt+Escape"); await frames(page)
  assert.equal(await page.locator(".content-tab-drag-preview").count(), 1, "Modified Escape keeps dragging")
  assert.deepEqual(await page.evaluate(() => (window as any).tabsFixture.stopCalls), [])
  await page.keyboard.press("Escape"); await frames(page)
  const result = await page.evaluate(() => ({ stops: (window as any).tabsFixture.stopCalls.length, ghosts: document.querySelectorAll(".content-tab-drag-preview").length, sources: document.querySelectorAll(".content-tab-drag-source").length }))
  assert.deepEqual(result, { stops: 0, ghosts: 0, sources: 0 }, "Pure Escape during drag belongs to cancellation before global ai.stop capture")
  await page.mouse.up(); await clearDrag(page); assert.deepEqual(await order(page), ["t0", "t1", "t2"]); assert.equal(await active(page), "t0")
  await tab(page, "t0").focus(); await page.keyboard.press("Alt+Escape"); await frames(page)
  assert.deepEqual(await page.evaluate(() => (window as any).tabsFixture.stopCalls), [], "Modified Escape does not invoke the pure global binding")
  await page.locator("#fixture-restore").focus(); await page.keyboard.press("Escape"); await frames(page)
  assert.deepEqual(await page.evaluate(() => (window as any).tabsFixture.stopCalls), ["stop"], "The real catalog ai.stop handler remains active outside dragging")
}))
test("TABS-08/10 pointer reorder retains active DOM/draft/state; inactive and keyboard moves preserve menu order", () => withContentTabs(browser, {}, async page => {
  await layout(page); await page.getByRole("textbox", { name: "草稿 t0", exact: true }).fill("隔离草稿保留")
  const instance = await page.locator('[data-panel-id="t0"]').getAttribute("data-instance")
  await page.evaluate(() => { const f = (window as any).tabsFixture; (window as any).beforeTabs = f.state().tabs; (window as any).beforePanel = document.querySelector('[data-panel-id="t0"]'); (window as any).beforeMeta = { nonce: f.state().activationNonce, subTabs: f.state().subTabs, focus: f.state().panelFocus } })
  const a = await beginDrag(page, "t0"), c = await tab(page, "t2").boundingBox(); assert(c)
  await page.mouse.move(c.x + c.width - 8, a.y, { steps: 6 }); await page.mouse.up(); await clearDrag(page)
  assert.deepEqual(await order(page), ["t1", "t2", "t0"]); assert.equal(await active(page), "t0")
  assert.equal(await page.locator('[data-panel-id="t0"]').getAttribute("data-instance"), instance); assert.equal(await page.getByRole("textbox", { name: "草稿 t0", exact: true }).inputValue(), "隔离草稿保留")
  assert(await page.evaluate(() => { const w = window as any, s = w.tabsFixture.state(); return w.beforePanel === document.querySelector('[data-panel-id="t0"]') && s.tabs.every((t: unknown) => w.beforeTabs.includes(t)) && s.activationNonce === w.beforeMeta.nonce && s.subTabs === w.beforeMeta.subTabs && s.panelFocus === w.beforeMeta.focus }))
  const inactive = await beginDrag(page, "t2"), b = await tab(page, "t1").boundingBox(); assert(b)
  await page.mouse.move(b.x + 3, inactive.y, { steps: 5 }); await page.mouse.up(); await clearDrag(page); assert.deepEqual(await order(page), ["t2", "t1", "t0"]); assert.equal(await active(page), "t0")
  await tab(page, "t1").focus(); await page.keyboard.press("Alt+ArrowRight"); assert.deepEqual(await order(page), ["t2", "t0", "t1"]); assert.equal(await active(page), "t0")
  assert(await tab(page, "t1").evaluate(el => el === document.activeElement)); assert.match(await page.getByRole("status").innerText(), /3/)
  await page.keyboard.press("Alt+ArrowRight"); assert.deepEqual(await order(page), ["t2", "t0", "t1"])
  await page.keyboard.press("Alt+ArrowLeft"); assert.deepEqual(await order(page), ["t2", "t1", "t0"])
  await page.evaluate(() => (window as any).tabsFixture.resize(440)); await frames(page); await openMenu(page)
  const labels = await page.getByRole("menuitemradio").allTextContents(); assert(labels[0].includes("A very long")); assert(labels[1].includes("短名")); assert(labels[2].includes("中文长标题"))
  await page.keyboard.press("Escape"); await tab(page, "t0").getByRole("button", { name: /^关闭 / }).click(); assert.equal(await active(page), "t1")
}))
test("TABS-10/11 noncentral XY preview follows above/below/outside, returns and commits; threshold and close excluded", () => withContentTabs(browser, {}, async page => {
  await layout(page); const start = await beginDrag(page, "t0")
  for (const [dx, dy] of [[35, 70], [100, -10], [-100, 45], [180, 100]]) {
    await page.mouse.move(start.x + dx, start.y + dy); await frames(page)
    const ghost = page.locator(".content-tab-drag-preview"), r = await ghost.boundingBox(); assert(r)
    near(r.x, start.left + dx, "ghost X grab offset"); near(r.y, start.top + dy, "ghost Y grab offset")
    assert.equal(await ghost.getAttribute("aria-hidden"), "true"); assert.equal(await ghost.locator('[role="tab"],[id],[tabindex="0"]').count(), 0); assert.equal(await ghost.evaluate(el => getComputedStyle(el).cursor), "default")
  }
  const end = await tab(page, "t2").boundingBox(); assert(end); await page.mouse.move(end.x + end.width - 8, start.y); await page.mouse.up(); await clearDrag(page); assert.deepEqual(await order(page), ["t1", "t2", "t0"]); assert.equal(await active(page), "t0")
  await tab(page, "t1").click(); assert.equal(await active(page), "t1")
  const tiny = await beginDrag(page, "t2"); await page.mouse.move(tiny.x + 2, tiny.y + 2); assert.equal(await page.locator(".content-tab-drag-preview").count(), 0); await page.mouse.up(); assert.equal(await active(page), "t2")
  const close = tab(page, "t0").getByRole("button", { name: /^关闭 / }), r = await close.boundingBox(); assert(r)
  await close.hover(); await page.mouse.down(); await page.mouse.move(r.x + r.width / 2 + 20, r.y + r.height / 2); assert.equal(await page.locator(".content-tab-drag-preview").count(), 0); await page.mouse.up()
}))
test("TABS-11/12 all cancel paths clear ghost/capture/marker and permit next click", () => withContentTabs(browser, {}, async page => {
  await layout(page)
  // pointercancel/blur/visibility are controlled DOM event tests, not OS input claims.
  for (const reason of ["escape", "outside", "pointercancel", "lostcapture", "blur", "visibility", "resize", "rename", "delete", "unmount"]) {
    await page.evaluate(() => (window as any).tabsFixture.reset(3)); await frames(page)
    const start = await beginDrag(page, "t0"); await page.mouse.move(start.x + 60, start.y); assert.equal(await page.locator(".content-tab-drag-preview").count(), 1)
    if (reason === "escape") await page.keyboard.press("Escape")
    if (reason === "outside") { await page.mouse.move(start.x + 60, 180); await page.mouse.up() }
    if (reason === "pointercancel") await tab(page, "t0").evaluate(el => el.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerId: (window as any).fixturePointer })))
    if (reason === "lostcapture") await tab(page, "t0").evaluate(el => el.releasePointerCapture((window as any).fixturePointer))
    if (reason === "blur") await page.evaluate(() => dispatchEvent(new Event("blur")))
    if (reason === "visibility") await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, value: true }); document.dispatchEvent(new Event("visibilitychange")); Object.defineProperty(document, "hidden", { configurable: true, value: false }) })
    if (reason === "resize") { await page.evaluate(() => (window as any).tabsFixture.resize(900)); await frames(page) }
    if (reason === "rename") await page.evaluate(() => (window as any).tabsFixture.rename("t1", "外部标题更新"))
    if (reason === "delete") await page.evaluate(() => (window as any).tabsFixture.close("t2"))
    if (reason === "unmount") await page.evaluate(() => (window as any).tabsFixture.hide())
    await page.mouse.up(); await clearDrag(page)
    if (reason === "unmount") { await page.locator("#fixture-restore").click(); await frames(page) }
    assert.deepEqual(await order(page), reason === "delete" ? ["t0", "t1"] : ["t0", "t1", "t2"], reason)
    await tab(page, "t1").click(); assert.equal(await active(page), "t1", `${reason} allows ordinary click`)
  }
  const start = await beginDrag(page, "t1"); await page.mouse.move(start.x + 50, start.y); await page.evaluate(() => (window as any).tabsFixture.unmount()); await page.mouse.up(); await clearDrag(page)
}))
test("TABS-10/11 cover image mouse drag avoids native DnD and scaled body ghost preserves source child sizes", () => withContentTabs(browser, { count: 6, zoom: 1.5, font: 24 }, async page => {
  await layout(page); await tab(page, "t3").focus(); await frames(page)
  const image = tab(page, "t3").locator("img"), i = await image.boundingBox(), source = await tab(page, "t3").boundingBox(); assert(i); assert(source)
  await page.evaluate(() => { (window as any).fixtureNativeDrags = 0; document.addEventListener("dragstart", () => { (window as any).fixtureNativeDrags++ }) })
  const x = i.x + i.width / 2, y = i.y + i.height / 2
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 60, y + 40, { steps: 8 }); await frames(page)
  assert.equal(await page.evaluate(() => (window as any).fixtureNativeDrags), 0, "Cover must not start native image drag")
  const ghost = page.locator(".content-tab-drag-preview"), g = await ghost.boundingBox(); assert(g, "Cover dragging must use the ContentTabs preview")
  near(g.x, source.x + 60, "cover ghost X"); near(g.y, source.y + 40, "cover ghost Y")
  await page.keyboard.press("Escape"); await page.mouse.up(); await clearDrag(page)
  await tab(page, "t0").focus(); await frames(page)
  const sizes = (el: Element) => { const selectors = [":scope > svg", ".content-tab-close", ".content-tab-close svg", ".content-tab-title", ".content-tab-suffix"]; return selectors.map(selector => { const child = el.querySelector(selector)!; const r = child.getBoundingClientRect(), s = getComputedStyle(child); return { width: r.width, height: r.height, fontSize: s.fontSize, lineHeight: s.lineHeight } }) }
  const original = await tab(page, "t0").evaluate(sizes), start = await beginDrag(page, "t0")
  await page.mouse.move(start.x + 45, start.y + 50); await frames(page)
  const copy = await page.locator(".content-tab-drag-preview").evaluate(sizes)
  for (let n = 0; n < original.length; n++) { near(copy[n].width, original[n].width, `ghost child ${n} width`); near(copy[n].height, original[n].height, `ghost child ${n} height`); assert.equal(copy[n].fontSize, original[n].fontSize); assert.equal(copy[n].lineHeight, original[n].lineHeight) }
  await page.keyboard.press("Escape"); await page.mouse.up(); await clearDrag(page)
}))
test("TABS-10/11 narrow viewport edge scrolling reaches hidden last/first tabs without external scroll", () => withContentTabs(browser, { count: 20, width: 440 }, async page => {
  await layout(page); const viewport = page.locator(".content-tabs-viewport"), r = await viewport.boundingBox(); assert(r)
  const start = await beginDrag(page, "t0"); await page.mouse.move(r.x + r.width - 2, start.y)
  await page.waitForFunction(() => { const el = document.querySelector<HTMLElement>(".content-tabs-viewport")!; return el.scrollLeft >= el.scrollWidth - el.clientWidth - 2 }, null, { timeout: 12000 })
  await page.mouse.up(); await clearDrag(page); assert.equal((await order(page)).at(-1), "t0"); assert.equal(await active(page), "t0")
  assert.deepEqual(await page.evaluate(() => [document.querySelector("#outer-fixture")!.scrollLeft, scrollX, scrollY]), [0, 0, 0])
  const back = await beginDrag(page, "t0"); await page.mouse.move(r.x + 2, back.y)
  await page.waitForFunction(() => document.querySelector<HTMLElement>(".content-tabs-viewport")!.scrollLeft <= 2, null, { timeout: 12000 }); await page.mouse.up(); await clearDrag(page)
  assert.equal((await order(page))[0], "t0"); assert.equal(await active(page), "t0")
}))
