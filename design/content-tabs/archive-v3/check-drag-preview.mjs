import { chromium } from '@playwright/test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

// Independent software preview process; never attaches to the user's browser.
const directory = path.dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, ignoreDefaultArgs: ['--hide-scrollbars'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 820 }, deviceScaleFactor: 1 });
const cases = [], errors = [];
page.on('pageerror', error => errors.push(String(error)));
const tab = id => page.locator('.tab-track [data-id="' + id + '"]');
const order = () => page.locator('.tab-track [role="tab"]').evaluateAll(nodes => nodes.map(el => el.dataset.id));
const active = () => page.locator('.tab-track [aria-selected="true"]').getAttribute('data-id');
async function clearDrag() {
  assert.equal(await page.locator('.drag-preview, .drag-source').count(), 0);
  assert.equal(await page.locator('.drop-marker').getAttribute('hidden'), '');
}
async function reset() {
  await page.getByRole('button', { name: '正常', exact: true }).click();
  await page.getByRole('button', { name: '3 个', exact: true }).click();
  await page.getByRole('button', { name: '重置标签', exact: true }).click();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.evaluate(() => { globalThis.previewBodyNode = document.querySelector('.body h2'); });
}
async function sameBody() { assert(await page.evaluate(() => globalThis.previewBodyNode === document.querySelector('.body h2'))); }
async function begin(id) {
  const rect = await tab(id).boundingBox(); assert(rect);
  await tab(id).evaluate(el => el.addEventListener('pointerdown', event => { globalThis.previewPointerId = event.pointerId; }, { once: true }));
  await page.mouse.move(rect.x + 28, rect.y + rect.height / 2); await page.mouse.down();
  return rect;
}
async function drag(id, x, y) { await begin(id); await page.mouse.move(x, y, { steps: 12 }); await page.mouse.up(); await clearDrag(); }
async function saved(name, detail = {}) { cases.push({ name, order: await order(), active: await active(), ...detail }); }
try {
  await page.goto(pathToFileURL(path.join(directory, 'index.html')).href);
  await reset();
  let target = await tab('sample-3').boundingBox();
  await drag('sample-1', target.x + target.width - 12, target.y + 16);
  assert.deepEqual(await order(), ['sample-2', 'sample-3', 'sample-1']); assert.equal(await active(), 'sample-1'); await sameBody();
  await saved('selected tab moves right; active and body node retained');
  await page.getByRole('button', { name: '关闭 章节标题示意：穿过长街之后的一段非常长的名称 · 正文', exact: true }).click();
  assert.equal(await active(), 'sample-3'); await saved('close uses previous neighbour in reordered sequence');

  await reset(); target = await tab('sample-1').boundingBox();
  await drag('sample-3', target.x + 3, target.y + 16);
  assert.deepEqual(await order(), ['sample-3', 'sample-1', 'sample-2']); assert.equal(await active(), 'sample-1'); await sameBody();
  await saved('inactive tab moves left without activating');
  await tab('sample-2').click(); assert.equal(await active(), 'sample-2'); await saved('ordinary click after drag is not swallowed');

  await reset(); const jitter = await begin('sample-2');
  await page.mouse.move(jitter.x + 30, jitter.y + 16); await page.mouse.up();
  assert.deepEqual(await order(), ['sample-1', 'sample-2', 'sample-3']); assert.equal(await active(), 'sample-2'); await clearDrag();
  await saved('2px movement remains a click');

  await reset(); await begin('sample-2'); target = await tab('sample-3').boundingBox();
  await page.mouse.move(target.x + target.width - 12, target.y + 16, { steps: 10 });
  assert.equal(await page.locator('.drag-preview').count(), 1);
  assert.equal(await page.locator('.drag-preview').getAttribute('aria-hidden'), 'true');
  assert.equal(await page.locator('.drag-preview').evaluate(el => getComputedStyle(el).cursor), 'default');
  assert.equal(await page.locator('.drop-marker').getAttribute('hidden'), null);
  assert(await page.evaluate(() => Number(getComputedStyle(document.querySelector('.drop-marker')).zIndex) > Number(getComputedStyle(document.querySelector('.drag-preview')).zIndex)));
  assert(await page.evaluate(() => document.querySelector('.drag-preview').getBoundingClientRect().top > document.querySelector('.tab-viewport').getBoundingClientRect().bottom));
  await page.locator('#panel').screenshot({ path: path.join(directory, 'preview-drag-panel.png') });
  await page.keyboard.press('Escape'); await page.mouse.up();
  assert.deepEqual(await order(), ['sample-1', 'sample-2', 'sample-3']); assert.equal(await active(), 'sample-1'); await sameBody(); await clearDrag();
  await saved('Escape cancels and clears ghost/insertion marker');
  await tab('sample-2').click(); assert.equal(await active(), 'sample-2'); await saved('ordinary click works after cancellation');

  await reset(); await begin('sample-2'); target = await tab('sample-3').boundingBox();
  await page.mouse.move(target.x + target.width - 12, target.y + 70, { steps: 10 }); await page.mouse.up();
  assert.deepEqual(await order(), ['sample-1', 'sample-2', 'sample-3']); assert.equal(await active(), 'sample-1'); await sameBody(); await clearDrag();
  await saved('drop outside tab viewport cancels');

  for (const reason of ['pointercancel', 'lostpointercapture', 'blur']) {
    await reset(); await begin('sample-2'); target = await tab('sample-3').boundingBox();
    await page.mouse.move(target.x + target.width - 12, target.y + 16, { steps: 10 });
    if (reason === 'pointercancel') await tab('sample-2').evaluate(el => el.dispatchEvent(new PointerEvent('pointercancel', { pointerId: globalThis.previewPointerId, bubbles: true })));
    else if (reason === 'lostpointercapture') await tab('sample-2').evaluate(el => el.releasePointerCapture(globalThis.previewPointerId));
    else await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await page.waitForFunction(() => !document.querySelector('.drag-preview'));
    await page.mouse.up();
    assert.deepEqual(await order(), ['sample-1', 'sample-2', 'sample-3']); assert.equal(await active(), 'sample-1'); await sameBody(); await clearDrag();
    await saved(reason + ' cancels', { trigger: reason === 'lostpointercapture' ? 'browser pointer capture released by test' : 'controlled DOM event; not OS-native input' });
  }

  await reset(); await page.getByRole('button', { name: '关闭 故事创作', exact: true }).click();
  assert.deepEqual(await order(), ['sample-1', 'sample-3']); await clearDrag(); await saved('close button does not start drag');

  await reset(); await tab('sample-2').focus(); await page.keyboard.press('Alt+ArrowRight');
  assert.deepEqual(await order(), ['sample-1', 'sample-3', 'sample-2']); assert.equal(await active(), 'sample-1'); await sameBody();
  assert.equal(await page.evaluate(() => document.activeElement.dataset.id), 'sample-2');
  assert.match(await page.locator('#sort-status').textContent(), /第 3 个/);
  await page.keyboard.press('Alt+ArrowRight'); assert.deepEqual(await order(), ['sample-1', 'sample-3', 'sample-2']);
  await page.keyboard.press('Alt+ArrowLeft'); assert.deepEqual(await order(), ['sample-1', 'sample-2', 'sample-3']);
  await saved('Alt arrows reorder, retain focus and active item, announce position, stop at boundary');

  await reset(); await page.getByRole('button', { name: '14 个', exact: true }).click();
  await page.getByRole('button', { name: '窄面板', exact: true }).click();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.evaluate(() => { globalThis.previewBodyNode = document.querySelector('.body h2'); });
  let vr = await page.locator('.tab-viewport').boundingBox(); await begin('sample-1');
  await page.mouse.move(vr.x + vr.width - 2, vr.y + 16, { steps: 8 });
  await page.waitForFunction(() => { const el = document.querySelector('.tab-viewport'); return el.scrollLeft >= el.scrollWidth - el.clientWidth - 2; }, undefined, { timeout: 10000 });
  const rightEdgeScroll = await page.locator('.tab-viewport').evaluate(el => el.scrollLeft);
  assert(rightEdgeScroll > 400); await page.mouse.up();
  assert.equal((await order()).at(-1), 'sample-1'); assert.equal(await active(), 'sample-1'); await sameBody(); await clearDrag();
  await saved('right edge auto-scroll reaches offscreen last position', { scrollLeft: rightEdgeScroll });
  await page.getByRole('button', { name: '所有标签', exact: true }).click();
  const menuOrder = await page.getByRole('menuitemradio').evaluateAll(els => els.map(el => el.getAttribute('aria-label')));
  const tabOrder = await page.locator('.tab-track [role="tab"]').evaluateAll(els => els.map(el => el.getAttribute('aria-label')));
  assert.deepEqual(menuOrder, tabOrder); await page.keyboard.press('Escape'); await saved('overflow menu matches reordered tab order');

  vr = await page.locator('.tab-viewport').boundingBox(); await begin('sample-1');
  await page.mouse.move(vr.x + 2, vr.y + 16, { steps: 8 });
  await page.waitForFunction(() => document.querySelector('.tab-viewport').scrollLeft <= 1, undefined, { timeout: 10000 });
  await page.mouse.up(); assert.equal((await order())[0], 'sample-1'); assert.equal(await active(), 'sample-1'); await sameBody(); await clearDrag();
  await saved('left edge auto-scroll reaches first position');
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(directory, 'drag-preview-observations.json'), JSON.stringify({ purpose: 'Isolated design HTML software checks only; no product or OS-native acceptance', revision: 'rect-drag-v3', browser: await browser.version(), node: process.version, cases, pageErrors: errors }, null, 2) + '\n');
  console.log(JSON.stringify({ purpose: 'isolated-drag-design-preview', cases: cases.length, pageErrors: errors.length }));
} finally { await browser.close(); }
