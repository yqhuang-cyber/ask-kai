import { AudioIO } from './audio.js';
import { Presentation } from './presentation.js';
import { ExperienceTrace } from './diagnostics.js';
const diagnosticsEnabled=new URLSearchParams(location.search).get('diagnostics')==='1';
const trace=diagnosticsEnabled?new ExperienceTrace():null;
const diagnosticPanel=document.querySelector('#diagnostics'),caseSelect=document.querySelector('#diagnostic-case'),outcomeSelect=document.querySelector('#diagnostic-outcome');
let diagnosticCase='unselected';
diagnosticPanel.hidden=!diagnosticsEnabled;
function refreshDiagnostics() {if(trace){document.querySelector('#diagnostic-count').textContent=`已记录 ${trace.rows.length} 条元数据事件${trace.discarded?'（已截断）':''}。`;document.querySelector('#diagnostic-export').disabled=!trace.rows.length;}}
const observe=(name,fields)=>{trace?.record(name,fields);refreshDiagnostics();};
if(diagnosticsEnabled) {
  void fetch('/experience-cases.json').then(r=>r.json()).then(data=>{
    for(const item of data.cases){const option=document.createElement('option');option.value=item.id;option.textContent=`${item.id} · ${item.title}`;caseSelect.append(option);}
    caseSelect.addEventListener('change',()=>{const item=data.cases.find(c=>c.id===caseSelect.value);document.querySelector('#diagnostic-guide').textContent=item?`${item.action} ${item.check}`:'每次选择一个场景，开始新会话后测试。';});
  }).catch(()=>{document.querySelector('#diagnostic-guide').textContent='测试场景加载失败，请刷新。';});
  document.querySelector('#diagnostic-export').addEventListener('click',()=>{
    const blob=new Blob([JSON.stringify(trace.snapshot({caseId:diagnosticCase,outcome:outcomeSelect.value}),null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`ask-kai-baseline-${diagnosticCase}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
}
const modes=[...document.querySelectorAll('[data-mode]')];
const goal=document.querySelector('#goal'),promptTitle=document.querySelector('#prompt-title'),promptHint=document.querySelector('#prompt-hint');
const connect=document.querySelector('#connect'),status=document.querySelector('#connection-status'),message=document.querySelector('#session-message');
const mute=document.querySelector('#mute'),end=document.querySelector('#end'),caption=document.querySelector('#caption'),student=document.querySelector('#student-caption');
const paceSelect=document.querySelector('#speech-pace'),paceHint=document.querySelector('#speech-pace-hint');
let paceSupported=false;
let mode='sports',ws,io,generation=0,config,muted=false,mission=null,safetyMessage=null;
const interrupt=document.querySelector('#interrupt');
const presentation=new Presentation({render:text=>{caption.textContent=text;},play:(audio,rate,id)=>io?.play(audio,rate,id),stopAudio:()=>io?.stopPlayback(),onObserve:diagnosticsEnabled?observe:undefined});
function learning(packet) {
  goal.textContent=packet.goal;promptHint.textContent=packet.start_tip;
  const card=packet.cards[0];document.querySelector('.word-card').hidden=!card;
  if(card)for(const [key,id] of Object.entries({word:'word-chinese',pinyin:'word-pinyin',english:'word-english',example:'word-example'}))document.getElementById(id).textContent=card[key];
  document.querySelector('#learning-attempts').textContent=packet.attempts.length ? `本轮记录 ${packet.attempts.length} 次表达尝试。未评估掌握或发音。` : '本轮尚未记录目标表达尝试。';
}
function selectMode(button) {
  mode=button.dataset.mode;
  for(const item of modes)item.setAttribute('aria-pressed',String(item===button));
  goal.textContent=mode==='sports'?'用「我喜欢……」说说喜欢的运动。':mode==='mission'?mission.targets.join('、'):'从感兴趣的话题开始，用中文表达自己。';
  promptTitle.textContent=mode==='sports'?'你喜欢什么运动？':mode==='mission'?mission.title:'今天想聊什么？';
  promptHint.textContent=mode==='sports'?'可以从「我喜欢足球」开始。':'可以从一句简单的中文开始。';
}
for(const button of modes)button.addEventListener('click',()=>selectMode(button));
function controls(active) {connect.disabled=active;caseSelect.disabled=active;paceSelect.disabled=active || !paceSupported;if(!active)paceHint.textContent=paceSupported?'开聊前选择，结束后可切换。':'当前服务暂不支持选择语速。';for(const button of modes)button.disabled=active || (button.dataset.mode==='mission' && !mission);end.disabled=!active;mute.disabled=!active;interrupt.disabled=!active;}
async function loadSpeechPaces() {
  try {
    const response=await fetch('/api/speech-paces');if(!response.ok)throw new Error('PACE_UNAVAILABLE');
    const result=await response.json();paceSupported=result.supported===true;
    if(paceSupported){paceSelect.replaceChildren();for(const item of result.options){const option=document.createElement('option');option.value=item.id;option.textContent=item.label;paceSelect.append(option);}paceSelect.value=result.default;}
    paceSelect.disabled=connect.disabled || !paceSupported;
    paceHint.textContent=paceSupported?'开聊前选择，结束后可切换。':'当前服务暂不支持选择语速。';
  }catch{paceSelect.disabled=true;paceHint.textContent='语速选项暂不可用。';}
}
void loadSpeechPaces();
async function stop(text='对话已结束。') {
  const stopped=++generation;presentation.reset();const previous=ws;ws=null;previous?.close();
  const audio=io;io=null;await audio?.close();
  observe('session.end',{state:'closed'});
  if(stopped!==generation)return;
  controls(false);status.textContent='未连接';message.textContent=text;caption.textContent='';student.textContent='';
  document.querySelector('.preview').textContent='Web 对话 · 豆包未连接';
  muted=false;mute.setAttribute('aria-pressed','false');mute.textContent='静音';
}
connect.addEventListener('click',async()=> {
  trace?.reset();diagnosticCase=caseSelect.value;outcomeSelect.value='not_run';refreshDiagnostics();
  const current=++generation;controls(true);status.textContent='检查连接';message.textContent='正在检查实时服务……';
  const selectedPace=paceSupported?paceSelect.value:undefined;
  safetyMessage=null;
  document.querySelector('#learning-attempts').textContent='本轮尚无对话记录。';
  try {
    io=new AudioIO({onFrame:bytes=> {
      if(ws?.readyState===WebSocket.OPEN){if(ws.bufferedAmount>65536){void stop('网络上传拥塞，请重新开始。');return;}ws.send(bytes);}
    },onFailure:text=>{observe('browser.failed',{code:'other'});void stop(text);},onObserve:diagnosticsEnabled?observe:undefined});
    await io.prepare();
    const response=await fetch('/api/sessions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode,...(selectedPace?{speech_pace:selectedPace}:{}),...(mode==='mission'?{mission_id:mission.id}:{})}),signal:AbortSignal.timeout(8000)});
    const result=await response.json();if(current!==generation)return;
    if(!response.ok){await stop(response.status===501?'实时语音尚未开通。需完成豆包协议和服务端连接验证。':'会话无法创建，请检查授权或服务容量。');return;}
    config=null;status.textContent='连接中';
    ws=new WebSocket(`${location.protocol==='https:'?'wss:':'ws:'}//${location.host}${result.websocket_path}`,[result.protocol,`ticket.${result.ticket}`]);
    ws.onopen=()=>{if(current===generation && diagnosticsEnabled)ws.send(JSON.stringify({type:'diagnostics.enable'}));};
    ws.onmessage=async event=> {
      if(current!==generation)return;
      try {
        const packet=JSON.parse(event.data);
        if(packet.type==='diagnostics.event'){trace?.gateway(packet.row);refreshDiagnostics();return;}
        if(packet.type==='session.config'){config=packet.audio;paceHint.textContent=packet.speech?.supported && ['slow','normal'].includes(packet.speech.pace)?`本次语速：${packet.speech.pace==='slow'?'慢速':'正常'}；结束后可切换。`:'本次使用服务默认语速。';return;}
        if(packet.type==='teaching.state' || packet.type==='teaching.summary'){learning(packet);return;}
        if(packet.type==='session.failed'){observe('browser.failed',{code:packet.code});await stop(safetyMessage ?? '实时连接失败，请重试。');return;}
        if(packet.type==='safety.notice'){safetyMessage=packet.message;message.textContent=safetyMessage;presentation.stop();await io?.close();return;}
        if(packet.type==='safety.handoff'){safetyMessage+=(packet.delivered?' 已提交给人工处理队列。':' 人工处理服务暂不可用，请直接联系可信任的大人。');message.textContent=safetyMessage;return;}
        if(packet.type==='session.closed'){await stop();return;}
        if(packet.type==='output.stop'){presentation.stop(packet.response_id);return;}
        if(packet.type!=='event')return;
        if(safetyMessage)return;
        const value=packet.event;
        if(value.type==='session.ready') {
          if(packet.synthetic || !packet.provider_connected || !config){await stop('服务未完成真实就绪验证。');return;}
          status.textContent='已连接';document.querySelector('.preview').textContent='Web 对话 · 实时服务已就绪';message.textContent='正在开启麦克风……';
          observe('session.ready',{provider_ready:true});
          await io.start(config);if(current===generation && !safetyMessage)message.textContent='麦克风持续开启，你可以自然地说话。';
        } else if(value.type==='response.started'){observe('response.started',{response_id:value.response_id,turn_id:value.turn_id});presentation.begin(value.response_id);}
        else if(value.type==='response.text.delta')presentation.append(value.response_id,value.payload.text);
        else if(value.type==='user.partial' || value.type==='user.final')student.textContent=value.payload.text;
        else if(value.type==='response.audio.chunk' && packet.audio)presentation.audio(value.response_id,packet.audio,packet.sample_rate);
        else if(value.type==='response.done')presentation.done(value.response_id);
      } catch {observe('browser.failed',{code:'other'});await stop(safetyMessage ?? '音频或协议处理失败，请重新开始。');}
    };
    ws.onerror=()=>{if(current===generation)void stop(safetyMessage ?? '无法连接实时服务，请重试。');};
    ws.onclose=()=>{if(current===generation)void stop(safetyMessage ?? '连接已断开，请重新开始。');};
  } catch {if(current===generation)await stop('无法开始对话。请检查麦克风权限及本地服务。');}
});
mute.addEventListener('click',()=>{muted=!muted;io?.mute(muted);mute.setAttribute('aria-pressed',String(muted));mute.textContent=muted?'取消静音':'静音';});
end.addEventListener('click',()=>{
  if(ws?.readyState===WebSocket.OPEN){ws.send(JSON.stringify({type:'session.end'}));const current=generation;message.textContent='正在结束对话……';setTimeout(()=>{if(current===generation)void stop();},1500);}
  else void stop();
});
interrupt.addEventListener('click',()=> {
  const response_id=presentation.current;observe('manual.interrupt',{response_id});presentation.stop();
  if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:'response.cancel',response_id:response_id ?? undefined}));
});
document.querySelector('#show-subtitles').addEventListener('change',event=>{caption.hidden=!event.target.checked;student.hidden=!event.target.checked;});
window.addEventListener('pagehide',()=>{void stop();});
const memoryStatus=document.querySelector('#memory-status');
async function loadMemory() {
  const response=await fetch('/api/memory');if(!response.ok)throw new Error('MEMORY_UNAVAILABLE');
  const result=await response.json(),list=document.querySelector('#memory-list');list.replaceChildren();
  document.querySelector('#memory-save').disabled=!result.writable;document.querySelector('#memory-delete').disabled=!result.can_delete;
  const names={interest:'兴趣',correction_preference:'纠错偏好',support_language:'语言支架'};
  for(const record of result.records){const item=document.createElement('li');item.textContent=`${names[record.field]}：${record.value}（来源：${record.source}；更新：${record.updated_at.slice(0,10)}）`;list.append(item);}
  memoryStatus.textContent=result.records.length?'只使用与你当前练习相关、仍有效的偏好。':'目前没有有效偏好。';
}
async function bootstrap() {
  try {
    const response=await fetch('/api/bootstrap');if(!response.ok){await loadMemory();return;}const result=await response.json();
    mission=result.mission;
    const missionButton=document.querySelector('[data-mode="mission"]');missionButton.disabled=!mission;missionButton.textContent=mission?'Mission 后对话':'Mission 后对话 · 待授权';
    document.querySelector('#memory-save').disabled=!result.memory_writable;document.querySelector('#memory-delete').disabled=!result.memory_writable;
    await loadMemory();
  }catch{memoryStatus.textContent='偏好服务暂不可用。';}
}
document.querySelector('#memory-form').addEventListener('submit',async event=> {
  event.preventDefault();
  try{const response=await fetch('/api/memory',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({field:document.querySelector('#memory-field').value,value:document.querySelector('#memory-value').value})});if(!response.ok)throw new Error('WRITE_FAILED');await loadMemory();memoryStatus.textContent='偏好已更正；后续回合将使用新偏好。';}
  catch{memoryStatus.textContent='更正未成功，请检查授权或偏好值。';}
});
document.querySelector('#memory-delete').addEventListener('click',async()=> {
  try{const response=await fetch('/api/memory',{method:'DELETE',headers:{'Content-Type':'application/json'},body:'{}'});if(!response.ok)throw new Error('DELETE_FAILED');await loadMemory();await stop('偏好已删除，当前对话已结束。');}
  catch{memoryStatus.textContent='删除未成功，请检查授权或服务。';}
});
void bootstrap();
