const frame = document.getElementById('preview');
const wrap = document.getElementById('frame-wrap');
let mode = 'full';
const stepNames = { theme: '选择主题', profile: '用户信息', text: '文本模型', 'image-choice': '询问文生图', image: '文生图配置', done: '引导完成', entry: '无文本模型入口', workspace: '暂时退出 / 工作台' };
const explanations = {
  theme: ['新的独立主题对话框', '三种主题即时应用。点击继续后才进入用户资料；写入失败时停留并可重试。'],
  profile: ['复用用户信息编辑', '保留头像、笔名、邮件。引导里的提交按钮改为“确定”；笔名必填，头像与邮件可选。'],
  text: ['一次确认，两个默认用途', '复用单模型配置。确认后同时设为默认文本与审核模型，保存成功才进入下一步。'],
  'image-choice': ['先询问，再配置', '明确接受或跳过。跳过直接完成，以后可以在设置中添加，不影响文本模型。'],
  image: ['配置也可以跳过', '复用文生图模型编辑。确定后成为默认文生图模型；返回回到询问，跳过丢弃未保存草稿。'],
  done: ['按已提交状态显示摘要', '完成标记保存后才显示这一页。文生图跳过时准确显示“暂未配置”；不声称连接测试成功。'],
  entry: ['没有文本模型时的短入口', '开始后直接进入文本模型，随后可选配置图片。暂不配置只关闭当次提示。'],
  workspace: ['已确认内容保留', '完整引导下次从未完成步骤继续。未确认的表单、头像与 Key 草稿丢弃；这里可演示恢复。']
};
function send(action, value) { frame.contentWindow.postMessage({ type: 'onboarding-review', action, value }, '*'); }
document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => { mode = button.dataset.mode; send('mode', mode); }));
document.querySelectorAll('[data-look]').forEach(button => button.addEventListener('click', () => send('look', button.dataset.look)));
document.querySelectorAll('[data-size]').forEach(button => button.addEventListener('click', () => {
  wrap.classList.toggle('narrow', button.dataset.size === 'narrow'); wrap.classList.toggle('short', button.dataset.size === 'short');
  document.querySelectorAll('[data-size]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
}));
document.getElementById('jump').addEventListener('change', event => send('jump', event.target.value));
document.getElementById('scenario').addEventListener('change', event => send('scenario', event.target.value));
document.getElementById('reset').addEventListener('click', () => { document.getElementById('scenario').value = 'normal'; send('reset'); });
document.getElementById('entry').addEventListener('click', () => send('entry'));
window.addEventListener('message', event => {
  if (event.source !== frame.contentWindow || event.data?.type !== 'onboarding-preview-state') return;
  const state = event.data; mode = state.mode;
  document.querySelectorAll('[data-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === mode)));
  document.querySelectorAll('[data-look]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.look === state.look)));
  const steps = ['theme', 'profile', 'text', 'image-choice', 'done'];
  const current = steps.indexOf(state.step === 'image' ? 'image-choice' : state.step);
  document.querySelectorAll('#flow-list li').forEach((li, index) => { li.hidden = mode === 'models' && index < 2; li.classList.toggle('active', index === current); li.classList.toggle('done', current > index); li.querySelector('span').textContent = current > index ? '✓' : String(mode === 'models' ? index - 1 : index + 1); });
  document.querySelector('.side-title').textContent = mode === 'full' ? '完整流程' : '仅模型流程';
  const jump = document.getElementById('jump');
  for (const option of jump.options) { option.disabled = mode === 'models' && ['theme', 'profile'].includes(option.value); option.hidden = option.disabled; const index = steps.indexOf(option.value === 'image' ? 'image-choice' : option.value); option.textContent = `${String(mode === 'models' && !option.hidden ? index - 1 : index + 1).padStart(2, '0')} · ${stepNames[option.value]}`; }
  if (steps.includes(state.step) || state.step === 'image') jump.value = state.step;
  document.getElementById('preview-caption').textContent = `${mode === 'full' ? '首次启动' : '仅模型'} / ${stepNames[state.step] || ''}`;
  const explanation = explanations[state.step] || explanations.theme;
  document.getElementById('explain-title').textContent = explanation[0]; document.getElementById('explain').textContent = explanation[1];
  document.getElementById('review-status').textContent = state.note || '此处为设计交互预览，不代表安装版实现或供应商测试结果。';
});
