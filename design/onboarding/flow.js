// Design preview only. Values stay in this document's memory; no IPC, storage, or network.
const dialog = document.getElementById('onboarding');
const entry = document.getElementById('workspace-entry');
const icons = {
  close: '<path d="m6 6 12 12M18 6 6 18"/>', back: '<path d="m14 6-6 6 6 6"/>', arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  check: '<path d="m5 12 4 4L19 6"/>', refresh: '<path d="M20 11a8 8 0 0 0-14-5L3 9m0-6v6h6m-5 4a8 8 0 0 0 14 5l3-3m0 6v-6h-6"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>', shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/><path d="m8 12 3 3 5-6"/>',
  person: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.info}</svg>`;
const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
let mode = 'full', step = 'theme', look = 'paper', resumeStep = 'theme', busy = false, scenario = 'normal', failNext = false, epoch = 0;
let note = '', useExisting = false, avatarDraft = false;
let saved;
function clearPreview() { saved = { theme: 'paper', profile: { name: '作者', email: '', avatar: false }, text: null, image: null, completed: false }; }
clearPreview();
const titles = {
  theme: ['选择主题', '欢迎使用玄印写作。选择适合你的主题。'],
  profile: ['填写用户信息', '为你的创作署名。头像和邮件可以稍后补充。'],
  text: ['配置文本模型', '添加自己的文本模型，用于 AI 写作与审核。'],
  'image-choice': ['要配置文生图模型吗？', '文字已经准备好了。你也可以为作品准备一个绘图助手。'],
  image: ['配置文生图模型', '选择自己的文生图模型，之后可以用于创作图片。'],
  done: ['欢迎使用', '玄印写作，陪你把灵感写成作品。'],
  entry: ['尚未配置文本模型', '添加自己的文本模型后，就可以使用 AI 写作与审核。']
};
function announce() {
  window.parent.postMessage({ type: 'onboarding-preview-state', mode, step, look, note }, '*');
}
function applyLook(theme) {
  look = theme === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'ink' : 'paper') : theme;
  document.documentElement.className = look;
  document.getElementById('brand').src = `../assets/logo-horizontal-${look}.svg`;
  document.querySelector('.ghost-greeting img').src = `../assets/seal-mark-${look}.svg`;
  const welcomeMark = dialog.querySelector('.welcome-mark');
  if (welcomeMark) welcomeMark.src = `../assets/seal-mark-${look}.svg`;
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (saved.theme === 'system') { applyLook('system'); announce(); } });
const button = (label, action, variant = '', glyph = '') => `<button type="button" class="btn ${variant}" data-action="${action}">${glyph ? icon(glyph) : ''}${label}</button>`;
function head() {
  const welcome = step === 'done';
  return `<header class="dialog-head${welcome ? ' welcome-head' : ''}"><button type="button" class="close" data-action="exit" aria-label="${welcome ? '关闭欢迎使用' : '暂时退出引导'}" title="${welcome ? '关闭' : '暂时退出，下次可以继续'}">${icon('close')}</button>${welcome ? `<img class="welcome-mark" src="../assets/seal-mark-${look}.svg" alt="" aria-hidden="true">` : ''}<h1 class="dialog-title" id="dialog-title" tabindex="-1">${titles[step][0]}</h1><p class="dialog-description" id="dialog-description">${titles[step][1]}</p></header>`;
}
function footer(left, right) { return `<footer class="dialog-footer">${left}<div class="footer-actions">${right}</div></footer>`; }
const feedback = '<div id="error" class="error" role="alert" aria-live="assertive"></div><p id="status" class="status" role="status" aria-live="polite"></p>';
function themePage() {
  const cards = [['paper', '宣纸', '温润明亮'], ['ink', '玄墨', '沉静深色'], ['system', '跟随系统', '随系统切换']].map(([value, name, caption]) => `
    <label class="theme-option"><input type="radio" name="theme" value="${value}" ${saved.theme === value ? 'checked' : ''} aria-label="${name}"><div class="theme-art ${value === 'ink' ? 'ink-art' : value === 'system' ? 'system-art' : ''}" aria-hidden="true"><div class="mini-side"><b></b><i></i><i></i><i></i></div><div class="mini-chat"><i></i><i></i></div><div class="mini-content"><b></b><i></i><i></i><i></i><i></i><i></i></div></div><span class="theme-meta"><span class="theme-name">${name}</span><span class="theme-check" aria-hidden="true">✓</span></span><span class="theme-caption">${caption}</span></label>`).join('');
  return `${head()}<div class="dialog-body"><div class="theme-grid" role="radiogroup" aria-label="界面主题">${cards}</div><div id="error" class="error" role="alert" aria-live="assertive"></div></div>${footer('', button('继续', 'confirm-theme', 'primary', 'arrow'))}`;
}
function profilePage() {
  avatarDraft = saved.profile.avatar;
  return `${head()}<div class="dialog-body"><div class="profile-form"><button type="button" class="avatar" aria-label="更换头像" data-action="avatar"><span id="avatar-art">${avatarDraft ? icon('person') : escapeHtml(saved.profile.name.slice(0, 1))}</span><small>${icon('image')}更换头像</small></button><div class="fields"><label class="field"><span class="field-title">笔名</span><input type="text" id="pen-name" aria-label="笔名" maxLength="80" autocomplete="off" value="${escapeHtml(saved.profile.name)}" placeholder="填写你的笔名"></label><label class="field"><span class="field-title">邮件<span class="optional">可选</span></span><input type="email" id="email" aria-label="邮件" autocomplete="off" value="${escapeHtml(saved.profile.email)}" placeholder="可以留空"></label></div></div><p class="form-hint">资料仅用于本地身份显示。头像支持 PNG、JPEG、WebP，不超过 10 MB。</p>${feedback}</div>${footer(button('返回', 'back', 'ghost', 'back'), button('继续', 'confirm-profile', 'primary', 'arrow'))}`;
}
const textProviders = [['deepseek', 'DeepSeek'], ['alibaba', '阿里云 / 通义千问'], ['moonshot', 'Moonshot / Kimi'], ['zai', '智谱'], ['xiaomi', '小米'], ['minimax', 'MiniMax'], ['tencent', '腾讯云'], ['bytedance', '字节 / 豆包'], ['openai', 'OpenAI'], ['anthropic', 'Anthropic'], ['google', 'Google'], ['xai', 'xAI'], ['custom', '自定义供应商']];
const imageProviders = textProviders.filter(([id]) => ['openai', 'google', 'alibaba', 'tencent', 'bytedance', 'xai', 'minimax', 'zai', 'custom'].includes(id));
function providerOptions(kind) { return (kind === 'text' ? textProviders : imageProviders).map(([id, label]) => `<option value="${id}">${label}</option>`).join(''); }
function logoFor(provider) { return { alibaba: 'qwen', moonshot: 'kimi' }[provider] || provider; }
function modelPage() {
  const kind = step === 'text' ? 'text' : 'image', record = saved[kind], existing = scenario === 'existing' && useExisting;
  const initialProvider = (kind === 'text' ? textProviders : imageProviders)[0][0];
  const caption = kind === 'text' ? '文本' : '文生图';
  const existingSwitcher = scenario === 'existing' ? `<div class="existing-switch">${button('使用已配置模型', 'use-existing', '', '')}${button('配置新模型', 'use-new', '', '')}</div>` : '';
  const form = existing ? `<label class="field"><span class="field-title">已配置${caption}模型</span><select id="existing-model" aria-label="已配置模型"><option value="">请选择已配置模型</option><option value="existing-${kind}">已配置${caption}模型（设计占位）</option></select><small>只选用已启用的${caption}模型；保留原凭据，不重新添加。</small></label>` : `
    <div class="model-fields">
      <label class="field"><span class="field-title">供应商</span><div class="select-with-logo"><img id="provider-logo" src="../assets/providers/${logoFor(initialProvider)}.svg" alt=""><select id="provider" aria-label="供应商">${providerOptions(kind)}</select></div></label>
      <div id="custom-fields" class="model-fields" hidden><label class="field"><span class="field-title">供应商名称</span><input type="text" id="provider-name" aria-label="供应商名称" maxlength="80" placeholder="供应商名称"></label><label class="field"><span class="field-title">协议</span><select id="protocol" aria-label="协议"><option value="">请选择协议</option><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option></select></label><label class="field"><span class="field-title">展示名称</span><input type="text" id="display-name" aria-label="展示名称" maxlength="120" placeholder="填写展示名称"></label><label class="field"><span class="field-title">Base URL</span><input type="text" id="base-url" aria-label="Base URL" placeholder="https://…"></label><label class="field"><span class="field-title">模型 ID</span><input type="text" id="model-id" aria-label="模型 ID" placeholder="填写模型 ID"></label></div>
      <label class="field"><span class="field-title">API Key</span><input type="password" id="api-key" aria-label="API Key" autocomplete="off" spellcheck="false" placeholder="${record ? '已配置，留空保留原密钥' : '请输入 API Key（请仅使用设计占位）'}"></label>
      <div id="builtin-fields"><label class="field"><span class="field-title">可用模型</span><div class="choice-row"><select id="available-model" aria-label="可用模型"><option value="">请选择可用模型</option><option value="design-${kind}">${caption}模型（设计占位）</option></select><button type="button" class="btn refresh" data-action="refresh" aria-label="刷新模型列表">${icon('refresh')}</button></div><small>内置官网模型列表；调用权限取决于当前 Key，可刷新目录或测试连接确认。</small></label></div>
      <details id="advanced" hidden><summary>高级配置</summary><label class="field"><span class="field-title">上下文上限<span class="optional">可选</span></span><input type="text" id="context" aria-label="上下文上限" placeholder="例如 128K 或 1M"><small>未配置时采用 16K 输入预算，不表示模型实际容量。</small></label></details>
    </div>`;
  const left = mode === 'full' || kind === 'image' ? button('返回', 'back', 'ghost', 'back') : '<span class="quiet-note">添加后即可用于新任务</span>';
  const right = `${kind === 'image' ? button('跳过', 'skip', 'ghost') : ''}${!existing ? button('测试连接', 'test') : ''}${button('继续', 'confirm-model', 'primary', 'arrow')}`;
  return `${head()}<div class="dialog-body">${existingSwitcher}${form}${!existing ? `<p class="test-note">测试当前模型：${kind === 'text' ? '请求简短回复' : '生成 1 张图片'}，可能产生供应商费用。</p>` : ''}${feedback}</div>${footer(left, right)}`;
}
function imageChoicePage() {
  return `${head()}<div class="dialog-body"><div class="choice-feature"><button type="button" class="choice-art-trigger" data-action="accept-image" aria-label="配置文生图模型"><img class="choice-collage" src="assets/xianxia-character-scene-v2.png" alt="仙侠角色与云海山峦、楼阁场景的拼贴展示图" width="1774" height="887"><span class="choice-art-shade" aria-hidden="true"></span><span class="choice-art-caption" aria-hidden="true"><span class="choice-art-label">配置文生图模型</span></span></button><div class="choice-feature-copy"><strong>给文字添一幅画</strong><p>封面、角色与场景图片<br>使用你自己配置的文生图模型。</p></div></div><p class="choice-info">这一步可以跳过。<br>以后可在“设置 → 模型”中添加，不影响文本创作。</p>${feedback}</div>${footer(button('返回', 'back', 'ghost', 'back'), button('跳过', 'skip') + button('配置文生图模型', 'accept-image', 'primary'))}`;
}
function welcomePage() {
  return `${head()}<div class="dialog-body welcome-body"><p class="welcome-greeting">${escapeHtml(saved.profile.name)}，你好。</p><p class="welcome-copy">从一个灵感、一段文字开始，<br>写出属于你的作品。</p></div>${footer('', button('开始创作', 'finish', 'primary', 'arrow'))}`;
}
function entryPage() {
  return `${head()}<div class="dialog-body"><div class="model-effect">${icon('info')}<span>从文本模型开始，随后可选择配置文生图模型。<br>主题与用户信息保留，无需再次填写。</span></div><p class="choice-info">暂不配置也可以继续使用本地写作功能。</p></div>${footer('', button('暂不配置', 'exit') + button('开始配置', 'start-models', 'primary'))}`;
}
function render() {
  entry.hidden = true;
  dialog.className = step === 'theme' ? 'theme-dialog' : step === 'done' ? 'welcome-dialog' : step === 'image-choice' ? 'image-choice-dialog' : step === 'entry' ? 'compact-dialog' : '';
  dialog.innerHTML = ({ theme: themePage, profile: profilePage, text: modelPage, 'image-choice': imageChoicePage, image: modelPage, done: welcomePage, entry: entryPage })[step]();
  bind();
  if (!dialog.open) dialog.showModal();
  dialog.querySelector('#dialog-title').focus();
  announce();
}
function go(next, message = '') { epoch++; busy = false; step = next; note = message; render(); }
function showError(message, field) {
  const el = dialog.querySelector('#error');
  if (el) { el.textContent = message; if (!field) el.scrollIntoView({ block: 'nearest' }); }
  if (field) { field.setAttribute('aria-invalid', 'true'); field.focus(); }
  note = '当前页保留，可以修改或重试；设计交互不连接真实服务。'; announce();
}
function showStatus(message) { const el = dialog.querySelector('#status'); if (el) el.textContent = message; note = message; announce(); }
function lock(value, action) {
  busy = value;
  dialog.querySelectorAll('button,input,select,summary').forEach(el => { if (value) { el.dataset.wasDisabled = String(!!el.disabled); el.disabled = true; } else { el.disabled = el.dataset.wasDisabled === 'true'; delete el.dataset.wasDisabled; } });
  const btn = dialog.querySelector(`[data-action="${action}"]`);
  if (value && btn) { btn.dataset.label = btn.innerHTML; btn.innerHTML = '<span class="spinner" aria-hidden="true"></span>正在保存…'; btn.setAttribute('aria-busy', 'true'); }
  else if (btn?.dataset.label) { btn.innerHTML = btn.dataset.label; delete btn.dataset.label; btn.removeAttribute('aria-busy'); }
}
async function commit(action, onSuccess) {
  if (busy) return;
  const captured = epoch;
  lock(true, action);
  await new Promise(resolve => setTimeout(resolve, 260));
  if (captured !== epoch) return;
  lock(false, action);
  if (failNext) { failNext = false; showError('配置暂未保存，请检查目录权限后重试。已确认的内容保留。'); return; }
  onSuccess();
}
function finish() {
  epoch++; busy = false;
  if (dialog.open) dialog.close();
  dialog.replaceChildren(); avatarDraft = false;
  const completed = saved.completed, fromEntry = step === 'entry';
  if (fromEntry) mode = 'models';
  step = 'workspace';
  entry.hidden = false;
  entry.innerHTML = `<div class="tag">工作台入口 · 设计示意</div><h1>${completed ? '准备开始创作' : fromEntry ? '继续本地写作' : '已暂时退出引导'}</h1><p>${completed ? '引导已完成。配置可在设置中继续调整。' : fromEntry ? '本次不再提示。需要时可以在设置中启动模型引导。' : '已经确认的配置保留。未保存草稿已丢弃，可以从当前步骤继续。'}</p><div class="actions">${!completed ? button(mode === 'full' ? '继续新手引导' : '开始模型引导', 'resume', 'primary') : button('重看欢迎页', 'show-done')}${button('重看完整引导', 'restart')}</div>`;
  entry.querySelectorAll('[data-action]').forEach(btn => btn.addEventListener('click', () => { if (btn.dataset.action === 'resume') go(fromEntry ? 'text' : resumeStep, '恢复设计预览；未保存草稿不会回填。'); else if (btn.dataset.action === 'show-done') go('done'); else reset('full'); }));
  note = completed ? '预览中的完成状态已记录；重开不重放完整引导。真实持久化将在批准后的实现中验证。' : '已退出本次引导。预览只在本页内存演示恢复，不持久化真实资料或 Key。';
  entry.querySelector('button').focus(); announce();
}
function validateModel() {
  if (scenario === 'existing' && useExisting) {
    const selector = dialog.querySelector('#existing-model');
    if (!selector.value) { showError('请选择一个已配置模型。', selector); return null; }
    const kind = step === 'text' ? 'text' : 'image';
    return { id: `existing-${kind}`, name: `已配置${kind === 'text' ? '文本' : '文生图'}模型（设计占位）`, provider: 'openai' };
  }
  const kind = step === 'text' ? 'text' : 'image', provider = dialog.querySelector('#provider').value;
  if (provider === 'custom') {
    for (const [id, message] of [['provider-name', '请输入供应商名称。'], ['protocol', '请选择协议。'], ['display-name', '请输入展示名称。'], ['base-url', '请输入有效的 Base URL。'], ['model-id', '请输入模型 ID。']]) {
      const field = dialog.querySelector(`#${id}`); let valid = !!field.value.trim();
      if (id === 'base-url') { try { valid = ['https:', 'http:'].includes(new URL(field.value).protocol); } catch { valid = false; } }
      if (!valid) { showError(message, field); return null; }
    }
  }
  const key = dialog.querySelector('#api-key');
  const prior = saved[kind];
  const sameScope = prior?.provider === provider && (provider !== 'custom' || prior.endpoint === dialog.querySelector('#base-url').value.trim() && prior.protocol === dialog.querySelector('#protocol').value);
  if (!key.value.trim() && !sameScope) { showError('请输入 API Key。审核时请仅输入设计占位。', key); return null; }
  const available = dialog.querySelector('#available-model');
  if (provider !== 'custom' && !available.value) { showError('请选择一个可用模型。', available); return null; }
  return { id: saved[kind]?.id || `preview-${kind}`, name: provider === 'custom' ? dialog.querySelector('#display-name').value.trim() : `${kind === 'text' ? '文本' : '文生图'}模型（设计占位）`, provider, ...(provider === 'custom' ? { providerName: dialog.querySelector('#provider-name').value.trim(), endpoint: dialog.querySelector('#base-url').value.trim(), protocol: dialog.querySelector('#protocol').value, modelId: dialog.querySelector('#model-id').value.trim() } : {}) };
}
function bind() {
  dialog.querySelectorAll('[data-action]').forEach(btn => btn.addEventListener('click', () => act(btn.dataset.action)));
  dialog.querySelectorAll('input,select').forEach(field => field.addEventListener('input', () => { field.removeAttribute('aria-invalid'); const error = dialog.querySelector('#error'); if (error) error.textContent = ''; }));
  if (step === 'theme') dialog.querySelectorAll('[name="theme"]').forEach(field => field.addEventListener('change', async () => {
    const previous = saved.theme, captured = epoch;
    await commit('confirm-theme', () => { saved.theme = field.value; applyLook(field.value); showStatus('主题已应用。可以继续填写用户信息。'); });
    if (captured !== epoch || step !== 'theme') return;
    if (saved.theme !== field.value) { const prior = dialog.querySelector(`[name="theme"][value="${previous}"]`); if (prior) prior.checked = true; }
  }));
  if (step === 'profile') dialog.querySelector('#pen-name').addEventListener('input', event => { if (!avatarDraft) dialog.querySelector('#avatar-art').textContent = event.target.value.slice(0, 1); });
  if (['text', 'image'].includes(step)) {
    if (scenario === 'existing') dialog.querySelectorAll('.existing-switch [data-action]').forEach(btn => btn.setAttribute('aria-pressed', String(btn.dataset.action === (useExisting ? 'use-existing' : 'use-new'))));
    const provider = dialog.querySelector('#provider');
    if (provider) {
      const refreshProvider = () => {
        const custom = provider.value === 'custom', kind = step === 'text' ? 'text' : 'image';
        dialog.querySelector('#custom-fields').hidden = !custom; dialog.querySelector('#builtin-fields').hidden = custom; dialog.querySelector('#advanced').hidden = !custom;
        const logo = dialog.querySelector('#provider-logo'); logo.hidden = custom; if (!custom) logo.src = `../assets/providers/${logoFor(provider.value)}.svg`;
        dialog.querySelector('#api-key').value = ''; dialog.querySelector('#api-key').placeholder = saved[kind]?.provider === provider.value ? '已配置，留空保留原密钥' : '请输入 API Key（请仅使用设计占位）';
        dialog.querySelector('#available-model').value = ''; const error = dialog.querySelector('#error'); error.textContent = ''; dialog.querySelector('#status').textContent = '';
      };
      provider.addEventListener('change', refreshProvider);
      const kind = step === 'text' ? 'text' : 'image', record = saved[kind];
      if (record) { provider.value = record.provider; refreshProvider(); if (record.provider !== 'custom') dialog.querySelector('#available-model').value = `design-${kind}`; else { dialog.querySelector('#display-name').value = record.name; dialog.querySelector('#provider-name').value = record.providerName || ''; dialog.querySelector('#protocol').value = record.protocol || ''; dialog.querySelector('#base-url').value = record.endpoint || ''; dialog.querySelector('#model-id').value = record.modelId || ''; } }
      if (scenario === 'catalog-failure') showStatus('目录读取失败。内置官网候选保留；可修改配置或点击刷新重试。');
    }
  }
}
function act(action) {
  if (busy) return;
  if (action === 'exit' || action === 'finish') { finish(); return; }
  if (action === 'confirm-theme') { void commit(action, () => { resumeStep = 'profile'; go('profile'); }); return; }
  if (action === 'confirm-profile') {
    const name = dialog.querySelector('#pen-name'), email = dialog.querySelector('#email');
    if (!name.value.trim() || name.value.trim().length > 80) { showError('请填写 1 至 80 字的笔名。', name); return; }
    if (email.value && !email.validity.valid) { showError('请填写有效的邮件地址，邮件也可以留空。', email); return; }
    const next = { name: name.value.trim(), email: email.value, avatar: avatarDraft };
    void commit(action, () => { saved.profile = next; resumeStep = 'text'; go('text'); }); return;
  }
  if (action === 'confirm-model') {
    const record = validateModel(); if (!record) return;
    const kind = step === 'text' ? 'text' : 'image';
    void commit(action, () => { saved[kind] = record; if (kind === 'text') { resumeStep = 'image-choice'; go('image-choice', '设计示意：文本模型已同时用于两个默认角色。'); } else { saved.completed = true; resumeStep = 'done'; go('done', '设计示意：图片默认用途与完成状态已一起确认。'); } }); return;
  }
  if (action === 'skip') { void commit(action, () => { saved.completed = true; resumeStep = 'done'; go('done', '设计示意：跳过文生图，保留原有图片配置。'); }); return; }
  if (action === 'accept-image') { resumeStep = 'image'; go('image'); return; }
  if (action === 'back') {
    const previous = { profile: 'theme', text: 'profile', 'image-choice': 'text', image: 'image-choice' }[step];
    if (previous && !(mode === 'models' && previous === 'profile')) { resumeStep = previous; go(previous, '返回上一步；未确认的表单草稿丢弃，已确认配置回填。'); } return;
  }
  if (action === 'avatar') { avatarDraft = !avatarDraft; dialog.querySelector('#avatar-art').innerHTML = avatarDraft ? icon('person') : escapeHtml(dialog.querySelector('#pen-name').value.slice(0, 1)); showStatus('仅切换设计头像占位；正式应用将打开本机文件选择。'); return; }
  if (action === 'refresh') { showStatus(scenario === 'catalog-failure' ? '模型目录读取失败，请重试。内置官网候选保留。' : '这是设计占位目录。正式应用将按现有模型配置逻辑读取目录。'); return; }
  if (action === 'test') { if (validateModel()) { showError('连接测试状态示意：当前未连接供应商。测试不保存模型，可返回填写并确认。'); note = '只演示脱敏测试反馈；没有实际网络调用或虚构成功结果。'; announce(); } return; }
  if (action === 'start-models') { mode = 'models'; resumeStep = 'text'; go('text'); return; }
  if (action === 'use-existing' || action === 'use-new') { useExisting = action === 'use-existing'; go(step); return; }
}
dialog.addEventListener('cancel', event => { event.preventDefault(); if (!busy) finish(); });
dialog.addEventListener('keydown', event => {
  if (event.key === 'Tab') {
    const controls = [...dialog.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),summary')].filter(el => el.getClientRects().length > 0 && !el.closest('[hidden]'));
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
  if (event.key === 'Enter' && (event.isComposing || event.target.matches('input,select'))) event.preventDefault();
});
function seedForJump(target) {
  if (['image-choice', 'image', 'done'].includes(target) && !saved.text) saved.text = { id: 'preview-text', name: '文本模型（设计占位）', provider: textProviders[0][0] };
  saved.completed = target === 'done';
}
function reset(nextMode = mode) {
  epoch++; mode = nextMode; clearPreview(); scenario = 'normal'; failNext = false; useExisting = false; applyLook('paper'); resumeStep = mode === 'full' ? 'theme' : 'text'; go(resumeStep, '预览已重置，全部内容只保存在本页内存。');
}
window.addEventListener('message', event => {
  if (event.source !== window.parent || event.data?.type !== 'onboarding-review') return;
  const { action, value } = event.data;
  if (action === 'reset') reset();
  else if (action === 'mode' && ['full', 'models'].includes(value)) reset(value);
  else if (action === 'look' && ['paper', 'ink'].includes(value)) { saved.theme = value; applyLook(value); if (step === 'theme') { const radio = dialog.querySelector(`[name="theme"][value="${value}"]`); if (radio) radio.checked = true; } announce(); }
  else if (action === 'entry') { mode = 'models'; saved.text = null; saved.completed = false; resumeStep = 'text'; go('entry', '每会话只提示一次；暂不配置后仍可从设置主动进入。'); }
  else if (action === 'jump' && Object.hasOwn(titles, value) && value !== 'entry' && !(mode === 'models' && ['theme', 'profile'].includes(value))) { seedForJump(value); resumeStep = value; go(value, '审核工具切换页面；前序状态使用明确设计占位，不是实际配置。'); }
  else if (action === 'scenario' && ['normal', 'save-failure', 'catalog-failure', 'existing'].includes(value)) { const wasExisting = scenario === 'existing'; scenario = value; failNext = value === 'save-failure'; useExisting = value === 'existing'; if (['text', 'image'].includes(step)) { if (wasExisting || value === 'existing') render(); else if (value === 'catalog-failure') showStatus('目录读取失败。内置官网候选保留；可修改配置或点击刷新重试。'); else showStatus(''); } note = value === 'save-failure' ? '下一次主题写入、确认或跳过将演示保存失败，可重试。' : value === 'existing' ? '可预览使用已配置模型或配置新模型。' : '审核状态已切换；模型目录是设计占位。'; announce(); }
});
applyLook('paper'); render();
