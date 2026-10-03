const modes = [...document.querySelectorAll('[data-mode]')];
const goal = document.querySelector('#goal');
const promptTitle = document.querySelector('#prompt-title');
const promptHint = document.querySelector('#prompt-hint');
const connect = document.querySelector('#connect');
const status = document.querySelector('#connection-status');
const message = document.querySelector('#session-message');
let mode = 'sports';
for (const button of modes) {
  button.addEventListener('click', () => {
    mode = button.dataset.mode;
    for (const item of modes) item.setAttribute('aria-pressed', String(item === button));
    goal.textContent = mode === 'sports' ? '用「我喜欢……」说说喜欢的运动。' : '从感兴趣的话题开始，用中文表达自己。';
    promptTitle.textContent = mode === 'sports' ? '你喜欢什么运动？' : '今天想聊什么？';
    promptHint.textContent = mode === 'sports' ? '可以从「我喜欢足球」开始。' : '可以从「你好，我叫……」开始。';
  });
}
connect.addEventListener('click', async () => {
  connect.disabled = true;
  for (const button of modes) button.disabled = true;
  status.textContent = '检查连接';
  message.textContent = '正在检查实时语音服务……';
  try {
    const response = await fetch('/api/sessions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }), signal: AbortSignal.timeout(8000)
    });
    const result = await response.json();
    message.textContent = response.status === 501 && result.error === 'REALTIME_NOT_IMPLEMENTED'
      ? '实时语音尚未开通。豆包协议和服务端连接验证完成后，这里将启用麦克风对话。'
      : '当前 Web 预览尚未支持实时对话，请稍后重试。';
  } catch {
    message.textContent = '暂时无法连接服务，请检查本地服务是否运行后重试。';
  } finally {
    status.textContent = '未连接';
    connect.textContent = '重新检查连接 ↗';
    connect.disabled = false;
    for (const button of modes) button.disabled = false;
  }
});
