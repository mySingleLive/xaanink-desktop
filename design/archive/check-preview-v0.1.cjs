/* Design-only verification. This is not the application test suite or desktop acceptance. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const url = process.env.DESIGN_PREVIEW_URL || 'http://127.0.0.1:4187/design/desktop-preview.html';
const evidence = path.join(__dirname, 'evidence');
const pages = ['workspace','first','create','chat-create','general','models','appearance','shortcuts','migration','recovery'];
const errors = [], network = [], results = [];
let browser;
fs.mkdirSync(evidence,{recursive:true});
(async () => {
  browser = await chromium.launch({headless:true,channel:'chrome'});
  const page = await browser.newPage({viewport:{width:1440,height:960}});
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  page.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:4187/')&&!r.url().startsWith('data:'))network.push(r.url());});
  async function load(mode='workspace',platform='mac',theme='paper'){
    await page.goto(`${url}?page=${mode}&platform=${platform}&theme=${theme}`);
    await page.evaluate(()=>document.fonts.ready);
  }
  async function geometry(mode,width){
    const data=await page.evaluate(()=>{
      const desktop=document.getElementById('desktop').getBoundingClientRect();
      const buttons=[...document.querySelectorAll('#surface:not([hidden]) .dialog-foot button')].filter(x=>x.getClientRects().length);
      const overflow=[...document.querySelectorAll('.settings-body,.dialog-body,.wizard-cards,.directory-section')].filter(x=>x.getClientRects().length&&x.scrollWidth>x.clientWidth+1).map(x=>x.className);
      return {horizontal:document.documentElement.scrollWidth>innerWidth+1,overflow,footOutside:buttons.some(x=>{const r=x.getBoundingClientRect();return r.right>desktop.right+1||r.left<desktop.left-1||r.bottom>desktop.bottom+1;})};
    });
    assert.equal(data.horizontal,false,`${mode}/${width}: document horizontal overflow`);
    assert.deepEqual(data.overflow,[],`${mode}/${width}: internal horizontal overflow`);
    assert.equal(data.footOutside,false,`${mode}/${width}: footer button clipped`);
  }
  for(const platform of ['mac','win'])for(const theme of ['paper','ink'])for(const mode of pages){
    await load(mode,platform,theme);await geometry(mode,1440);
    assert.equal(await page.locator(platform==='mac'?'.mac-controls':'.win-controls').isVisible(),true);
    results.push({check:'page-state',mode,platform,theme,width:1440,status:'pass'});
    if((platform==='mac'&&theme==='paper')||(platform==='win'&&theme==='ink'))await page.screenshot({path:path.join(evidence,`${mode}-${platform}-${theme}.png`)});
  }
  for(const width of [1024,800,640]){
    await page.setViewportSize({width,height:900});
    for(const mode of ['workspace','first','create','general','models','appearance','shortcuts','migration','recovery']){
      await load(mode);await geometry(mode,width);results.push({check:'responsive',mode,width,status:'pass'});
    }
  }
  await page.setViewportSize({width:1440,height:960});
  await load('create');
  assert.equal(await page.locator('[data-action="create-draft"]').isDisabled(),true);
  await page.locator('[data-action="choose-project"]').click();
  await page.locator('#demo-path').fill('~/作品/中文 空格/纸上风声');
  await page.locator('[data-action="confirm-path"]').click();
  assert.equal(await page.locator('[data-action="create-draft"]').isEnabled(),true);
  await page.locator('[data-action="create-draft"]').click();
  assert.match(await page.locator('#composer-caption').innerText(),/待创建作品.*中文 空格/);
  assert.equal(await page.locator('#surface').isHidden(),true);
  results.push({check:'explicit-directory-and-unsent-draft',status:'pass'});
  await load('general');
  await page.locator('#author').fill('本地写作者');
  await page.locator('[data-settings="models"]').click();
  assert.match(await page.locator('#subdialog').innerText(),/设置尚未保存/);
  await page.locator('[data-action="continue-edit"]').click();
  assert.equal(await page.locator('#author').inputValue(),'本地写作者');
  await page.locator('[data-action="save-settings"]').click();
  assert.equal(await page.locator('#author-label').innerText(),'本地写作者');
  results.push({check:'dirty-settings-preserved-and-confirmed',status:'pass'});
  await load('appearance');
  await page.locator('[data-theme-choice="ink"]').click();
  assert.equal(await page.locator('html').getAttribute('class'),'ink');
  await page.locator('[data-action="cancel-settings"]').click();
  assert.equal(await page.locator('html').getAttribute('class'),'paper');
  results.push({check:'appearance-preview-cancel-restores',status:'pass'});
  await load('models');
  await page.locator('[data-action="test-model"]').click();
  assert.match(await page.locator('#subdialog').innerText(),/供应商费用/);
  await page.locator('[data-action="confirm-test"]').click();
  await page.getByRole('button',{name:'停止测试',exact:true}).click();
  assert.equal(await page.locator('#subdialog').isHidden(),true);
  results.push({check:'model-test-explicit-confirmation-and-cancel',status:'pass'});
  await load('create');
  await page.locator('#preview-state').selectOption('directory-error');
  assert.equal(await page.locator('[data-action="create-manual"]').isDisabled(),true);
  assert.match(await page.locator('#surface').innerText(),/已有其他文件/);
  await load('shortcuts');
  await page.locator('#preview-state').selectOption('shortcut-error');
  assert.equal(await page.locator('[data-action="save-settings"]').isDisabled(),true);
  results.push({check:'directory-and-shortcut-errors-block-submit',status:'pass'});
  await load('migration');
  await page.locator('[data-action="choose-migration"]').click();
  await page.locator('#demo-path').fill('~/Documents/玄印写作数据/');
  await page.locator('[data-action="confirm-path"]').click();
  await page.locator('[data-action="start-migration"]').click();
  await page.getByRole('button',{name:'取消迁移',exact:true}).click();
  assert.equal(await page.locator('#surface').isHidden(),true);
  results.push({check:'migration-before-commit-cancel',status:'pass'});
  assert.deepEqual(errors,[],'Browser runtime or CSP errors');assert.deepEqual(network,[],'Unexpected non-local resource request');
  const report={scope:'UI design prototype only; not Electron/OS/disk/model acceptance',date:'2026-10-06',browser:'installed Google Chrome via Playwright',results,runtimeErrors:errors,unexpectedExternalRequests:network};
  fs.writeFileSync(path.join(evidence,'preview-checks.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({passed:results.length,runtimeErrors:errors,externalRequests:network}));
  await browser.close();
})().catch(async e=>{console.error(e.stack);process.exitCode=1;await browser?.close();});
