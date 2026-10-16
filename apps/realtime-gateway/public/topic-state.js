// Render the server's current selection; a requested destination is not a
// newly prepared Topic Pack and must never replace the selected topic label.
export function renderTopicState(root,scope) {
  root.hidden=!scope;
  const title=root.querySelector('[data-topic-title]'),status=root.querySelector('[data-topic-state]'),change=root.querySelector('[data-topic-change]');
  title.textContent=scope?`当前主题：${scope.title}`:'';
  status.textContent=!scope?'':scope.status==='change_requested'?`你已提出${scope.requested_focus?`改聊「${scope.requested_focus}」`:'更换主题'}，旧练习已暂停；尚未切换主题。结束后可选择新主题或自由聊天。`:scope.status==='unavailable'?'当前主题资源暂不可用，已停止旧目标教学。结束后可重新选择。':'围绕当前主题交流；练习可以调整或暂停。';
  change.hidden=!scope||!['change_requested','unavailable'].includes(scope.status);
}
