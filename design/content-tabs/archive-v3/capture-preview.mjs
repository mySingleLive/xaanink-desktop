import { chromium } from '@playwright/test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const directory = path.dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, ignoreDefaultArgs: ['--hide-scrollbars'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 820 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
const records = [];
try {
  await page.goto(pathToFileURL(path.join(directory, 'index.html')).href);
  await page.evaluate(() => document.fonts.ready);
  async function record(name) {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.waitForFunction(() => Array.from(document.querySelectorAll('.tab-title')).every(el => el.dataset.overflow === String(el.scrollWidth > el.clientWidth + 1)));
    const geometry = await page.evaluate(() => {
      const caption = document.querySelector('.caption'), tab = document.querySelector('[aria-selected="true"][role="tab"]');
      const viewport = document.querySelector('.tab-viewport'), body = document.querySelector('.body');
      const cr = caption.getBoundingClientRect(), tr = tab.getBoundingClientRect(), br = body.getBoundingClientRect(), vr = viewport.getBoundingClientRect();
      const sr = document.querySelector('#fullscreen').getBoundingClientRect();
      const labels = Array.from(document.querySelectorAll('.tab-title')).map(el => ({ text: el.textContent, width: el.clientWidth, scrollWidth: el.scrollWidth, fade: el.dataset.overflow, mask: getComputedStyle(el).maskImage }));
      const ts = getComputedStyle(tab);
      return { headerHeight: cr.height, tabTop: tr.top - cr.top, tabHeight: tr.height, tabBottomGap: cr.bottom - tr.bottom,
        cornerRadii: [ts.borderTopLeftRadius, ts.borderTopRightRadius, ts.borderBottomRightRadius, ts.borderBottomLeftRadius], boxShadow: ts.boxShadow, borderColor: ts.borderTopColor,
        cursors: Array.from(document.querySelectorAll('.tab-track .content-tab, .tab-track .content-tab *, .panel-tools button')).map(el => getComputedStyle(el).cursor),
        tabBackground: getComputedStyle(tab).backgroundColor, bodyBackground: getComputedStyle(body).backgroundColor,
        overflowX: getComputedStyle(viewport).overflowX, overflowY: getComputedStyle(viewport).overflowY,
        viewportHeight: viewport.clientHeight, viewportScrollHeight: viewport.scrollHeight,
        viewportWidth: viewport.clientWidth, viewportScrollWidth: viewport.scrollWidth, scrollLeft: viewport.scrollLeft,
        menuVisible: !document.querySelector('#all-tabs').hidden, toolCentreY: (sr.top + sr.height / 2) - cr.top,
        selectedLeft: tr.left - vr.left, selectedRight: tr.right - vr.left,
        widths: Array.from(document.querySelectorAll('[role="tab"]')).map(el => el.getBoundingClientRect().width), labels };
    });
    assert.equal(geometry.headerHeight, 44); assert.equal(geometry.tabTop, 6); assert.equal(geometry.tabHeight, 32);
    assert.equal(geometry.tabBottomGap, 6); assert.equal(geometry.tabBackground, geometry.bodyBackground);
    assert(geometry.cornerRadii.every(radius => Number.parseFloat(radius) === 6)); assert.equal(geometry.boxShadow, 'none');
    assert(geometry.cursors.every(cursor => cursor === 'default'));
    assert.notEqual(geometry.borderColor, 'rgb(176, 53, 36)'); assert.notEqual(geometry.borderColor, 'rgb(224, 122, 95)');
    assert.equal(geometry.overflowX, 'hidden'); assert.equal(geometry.overflowY, 'hidden');
    assert.equal(geometry.viewportScrollHeight, geometry.viewportHeight); assert.equal(geometry.toolCentreY, 16);
    assert(geometry.selectedLeft >= -.1 && geometry.selectedRight <= geometry.viewportWidth + .1);
    assert(geometry.widths.every(width => width <= Math.min(208, geometry.viewportWidth) + .1));
    assert(geometry.labels.filter(label => label.scrollWidth > label.width + 1).every(label => label.fade === 'true' && label.mask.includes('linear-gradient')));
    assert(geometry.labels.filter(label => label.scrollWidth <= label.width + 1).every(label => label.fade === 'false' && label.mask === 'none'));
    records.push({ scenario: name, geometry });
    await page.screenshot({ path: path.join(directory, name + '.png') });
  }
  await page.waitForFunction(() => document.querySelector('.tab-title').dataset.overflow !== undefined);
  await record('preview-paper');
  await page.locator('#panel').screenshot({ path: path.join(directory, 'preview-panel.png') });
  await page.getByRole('button', { name: '玄墨', exact: true }).click();
  await record('preview-ink');
  await page.getByRole('button', { name: '宣纸', exact: true }).click();
  await page.getByRole('button', { name: '窄面板', exact: true }).click();
  await page.getByRole('button', { name: '14 个', exact: true }).click();
  await record('preview-narrow');
  await page.getByRole('button', { name: '所有标签', exact: true }).click();
  assert.equal(await page.getByRole('menuitemradio').count(), 14);
  const menuGeometry = await page.locator('#all-tabs-menu').evaluate(el => { const mr = el.getBoundingClientRect(), pr = el.closest('.panel').getBoundingClientRect(); return { left: mr.left - pr.left, right: pr.right - mr.right }; });
  assert(menuGeometry.left >= 0 && menuGeometry.right >= 0);
  await page.screenshot({ path: path.join(directory, 'preview-menu.png') });
  await page.getByRole('menuitemradio').last().click({ position: { x: 50, y: 12 } });
  assert.equal(await page.locator('[role="tab"][aria-selected="true"]').getAttribute('data-id'), 'extra-10');
  await record('preview-last-tab');
  await page.locator('[role="tab"][aria-selected="true"]').focus();
  await page.keyboard.press('Home');
  assert.equal(await page.locator('[role="tab"][tabindex="0"]').count(), 1);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.id), 'sample-1');
  assert.equal(await page.locator('[role="tab"][aria-selected="true"]').getAttribute('data-id'), 'extra-10');
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('[role="tab"][aria-selected="true"]').getAttribute('data-id'), 'sample-1');
  await page.getByRole('button', { name: '所有标签', exact: true }).click();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#all-tabs-menu').getAttribute('hidden'), '');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'all-tabs');
  await page.getByRole('button', { name: '所有标签', exact: true }).click();
  await page.locator('.menu-close').last().click();
  assert.equal(await page.locator('[role="tab"]').count(), 13);
  await page.getByRole('button', { name: '正常', exact: true }).click();
  await page.getByRole('button', { name: '3 个', exact: true }).click();
  await page.getByRole('tab', { name: '故事创作', exact: true }).click();
  await page.getByRole('button', { name: '关闭 故事创作', exact: true }).click();
  assert.equal(await page.locator('[role="tab"][aria-selected="true"]').getAttribute('data-id'), 'sample-1');
  await page.getByRole('button', { name: '重置标签', exact: true }).click();
  await page.setViewportSize({ width: 560, height: 980 });
  await record('preview-small-viewer');
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(directory, 'preview-observations.json'), JSON.stringify({ purpose: 'Small rounded rectangle design HTML checks only; no product or native acceptance', revision: 'rect-drag-v3', browser: await browser.version(), node: process.version, scenarios: records, menuGeometry, interactions: ['menu lists 14 items', 'last tab selection reveals target', 'Home focuses without activation; Enter activates; exactly one tab stop', 'Escape returns to menu trigger', 'menu closes an offscreen tab', 'closing selected middle tab selects previous item, matching production store'], pageErrors: errors }, null, 2) + '\n');
  console.log(JSON.stringify({ purpose: 'rect-drag-design-preview', scenarios: records.length, interactions: 6, pageErrors: errors.length }));
} finally { await browser.close(); }
