import assert from "node:assert/strict"
import test from "node:test"
import { chromium, type Browser } from "playwright-core"
import { frames, withContentTabs } from "../helpers/content-tabs-fixture"

let browser: Browser
test.before(async () => { browser = await chromium.launch({ headless: true, ...(process.env.XAANINK_TEST_CHROMIUM ? { executablePath: process.env.XAANINK_TEST_CHROMIUM } : {}) }) })
test.after(async () => { await browser?.close() })

test("AIDRAG-01 clipped tabs and close buttons never exclude the adjacent AI caption after scroll/resize", () => withContentTabs(browser, { count: 20, width: 520 }, async page => {
  for (const width of [520, 450, 650]) for (const id of ["t0", "t10", "t19"]) {
    await page.evaluate(({ width, id }) => { (window as any).tabsFixture.resize(width); (window as any).tabsFixture.activate(id) }, { width, id })
    await frames(page); await frames(page)
    const geometry = await page.evaluate(() => {
      const pane = document.querySelector("#fixture-pane")!.getBoundingClientRect(), viewport = document.querySelector(".content-tabs-viewport")!
      const caption = document.querySelector(".content-tabs-caption")!.getBoundingClientRect()
      return {
        scrollLeft: viewport.scrollLeft,
        viewportRegion: getComputedStyle(viewport).getPropertyValue("-webkit-app-region"),
        exclusionsOutsidePane: Array.from(document.querySelectorAll(".content-tabs-caption *")).filter(el => {
          const r = el.getBoundingClientRect()
          return getComputedStyle(el).getPropertyValue("-webkit-app-region") === "no-drag" && r.height > 0 && r.top < caption.bottom && r.bottom > caption.top && (r.left < pane.left || r.right > pane.right)
        }).map(el => ({ className: el.className, role: el.getAttribute("role") })),
        descendantRegions: Array.from(viewport.querySelectorAll("*")).map(el => getComputedStyle(el).getPropertyValue("-webkit-app-region")),
      }
    })
    if (id === "t19") assert(geometry.scrollLeft > 0, "Must exercise offscreen tabs")
    assert.deepEqual(geometry.exclusionsOutsidePane, [], "Clipped no-drag boxes must not invade the AI caption")
    assert.equal(geometry.viewportRegion, "no-drag")
    assert(geometry.descendantRegions.every(region => region === "none"), "Only the bounded viewport registers the exclusion")
  }
}))

test("AIDRAG-02 a short single tab leaves native draggable blank space before fixed tools", () => withContentTabs(browser, { count: 1, width: 700 }, async page => {
  await page.evaluate(() => (window as any).tabsFixture.rename("t0", "短标题")); await frames(page); await frames(page)
  const result = await page.evaluate(() => {
    const viewport = document.querySelector(".content-tabs-viewport")!, tab = viewport.querySelector(".content-tab")!, tools = document.querySelector(".content-tabs-tools")!
    const v = viewport.getBoundingClientRect(), t = tab.getBoundingClientRect(), controls = tools.getBoundingClientRect()
    const hit = document.elementFromPoint(v.right + 20, v.top + v.height / 2)!
    return { gap: controls.left - v.right, viewportWidth: v.width, tabWidth: t.width, blankRegion: getComputedStyle(hit).getPropertyValue("-webkit-app-region"), blankCaption: hit.classList.contains("content-tabs-caption") }
  })
  assert(Math.abs(result.viewportWidth - result.tabWidth) < 1)
  assert(result.gap > 80, "Single tab must not consume the whole caption")
  assert(result.blankCaption); assert.equal(result.blankRegion, "drag")
  await page.getByRole("tab").click(); await page.getByRole("tab").press("Enter")
  await page.getByRole("button", { name: "关闭 短标题 · 正文", exact: true }).click()
  assert.equal(await page.getByRole("tab").count(), 0)
}))

test("AIDRAG-03 long single tab expands again after a narrow pane at every supported zoom", () => withContentTabs(browser, { count: 1, width: 700 }, async page => {
  for (const zoom of [.75, 1, 1.25, 1.5, 2]) {
    await page.evaluate(zoom => { (window as any).tabsFixture.appearance(zoom, 14, "paper"); (window as any).tabsFixture.resize(220) }, zoom)
    await frames(page); await frames(page)
    const narrow = await page.getByRole("tab").evaluate(el => el.getBoundingClientRect().width)
    await page.evaluate(() => (window as any).tabsFixture.resize(700)); await frames(page); await frames(page)
    const expanded = await page.getByRole("tab").evaluate(el => el.getBoundingClientRect().width)
    assert(Math.abs(expanded * zoom - 208) < .3, `Long tab must recover its width at zoom ${zoom}`)
    assert(expanded > narrow + 5)
  }
}))
