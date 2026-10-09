// Versioned, session-owned, ephemeral view; never display IDs or transcripts.
const modes={sports:'运动主题',mission:'Mission 后对话',free:'自由聊天'};
const focuses=new Set(['practice_observed','target_text_observed','conversation_only','insufficient','unavailable']);
const id=v=>typeof v==='string' && /^[A-Za-z0-9_-]{1,128}$/.test(v);
const count=(v,max=1000)=>Number.isSafeInteger(v) && v>=0 && v<=max;
const line=(v,max=160)=>typeof v==='string' && v.length>0 && v.length<=max;
const empty={focus:'unavailable',headline:{zh:'本轮总结暂不可用。',en:'This session summary is unavailable.'},items:[],review:null,goal:null,partial:false,synthetic:false,mock:false};
export function projectSummary(packet,{sessionId,mode}) {
  const s=packet?.summary;
  if(packet?.type!=='teaching.summary' || packet.session_id!==sessionId || !id(sessionId) || !Object.hasOwn(modes,mode) || s?.session_id!==sessionId || s.mode!==mode || s.schema_version!==1 || s.policy_version!=='kai-summary-v1' || !focuses.has(s.focus))return null;
  if(!['ended','failed'].includes(s.outcome) || typeof s.partial!=='boolean' || !['mock_hskai','external_hskai','unconfigured'].includes(s.business_source) || !['not_connected','synthetic','real_provider'].includes(s.voice?.kind) || s.voice.real_experience_accepted!==false)return null;
  if(!count(s.counts?.attempts) || !count(s.counts.student_final_turns) || !count(s.counts.forwarded_completed_replies,10000) || !line(s.headline?.zh) || !line(s.headline.en))return null;
  if(!Array.isArray(s.goals) || s.goals.length>1 || !Array.isArray(s.learning_items) || s.learning_items.length>4 || !Array.isArray(s.review_suggestions) || s.review_suggestions.length>1 || s.assessment?.mastery_assessed!==false || s.assessment.pronunciation_assessed!==false || s.assessment.independent_use_assessed!==false)return null;
  if(s.focus==='unavailable')return {...structuredClone(empty),mode,reason:s.end_reason};
  const goal=s.goals[0];if(s.goals.length && (!goal || !id(goal.id) || !line(goal.label,100) || typeof goal.attempt_rule_supported!=='boolean'))return null;
  const seen=new Set(),items=[];let total=0;
  for(const item of s.learning_items) {
    if(!goal || !item || !id(item.id) || seen.has(item.id) || item.goal_id!==goal.id || !line(item.text,100) || !line(item.pinyin,100) || !line(item.english,120) || !['attempted','target_text_observed'].includes(item.kind) || !count(item.attempt_count) || !count(item.target_text_count,10000))return null;
    seen.add(item.id);total+=item.attempt_count;
    if(!Array.isArray(item.attempt_refs) || item.attempt_refs.length>5 || item.attempt_refs.length>item.attempt_count || !Array.isArray(item.target_text_refs) || item.target_text_refs.length>5 || item.target_text_refs.length>item.target_text_count || (item.attempt_count>0 && !item.attempt_refs.length) || (item.target_text_count>0 && !item.target_text_refs.length))return null;
    if(item.attempt_refs.some(r=>!r || r.kind!=='attempted' || r.session_id!==sessionId || !id(r.source_event_id) || !id(r.turn_id) || r.expression_id!==item.id || r.goal_id!==goal.id || r.pronunciation_assessed!==false))return null;
    if(item.target_text_refs.some(r=>!r || r.kind!=='target_text_forwarded' || r.session_id!==sessionId || !id(r.response_id) || !id(r.turn_id) || !id(r.completion_event_id) || r.scope!=='gateway_forwarded_text' || r.playback_confirmed!==false || !Array.isArray(r.source_event_ids) || !r.source_event_ids.length || r.source_event_ids.length>20 || r.source_event_ids.some(v=>!id(v))))return null;
    if(item.kind!==(item.attempt_count?'attempted':'target_text_observed') || (!item.attempt_count && !item.target_text_count))return null;
    items.push({id:item.id,text:item.text,pinyin:item.pinyin,english:item.english,attempts:item.attempt_count});
  }
  if(total!==s.counts.attempts || total>s.counts.student_final_turns || (s.focus==='practice_observed' && !total) || (s.focus==='target_text_observed' && (total || !items.length)) || (s.focus==='conversation_only' && (items.length || !s.counts.student_final_turns)))return null;
  const suggestion=s.review_suggestions[0];let review=null;
  if(s.review_suggestions.length && !suggestion)return null;
  if(suggestion) {
    if(suggestion.goal_id!==goal?.id || suggestion.optional!==true || !['attempt_not_assessed','target_text_without_attempt'].includes(suggestion.reason))return null;
    const item=items.find(i=>i.id===suggestion.expression_id);if(!item)return null;review={...item};
  }
  return {mode,focus:s.focus,headline:{zh:s.headline.zh,en:s.headline.en},items:s.focus==='insufficient'?[]:items,review:s.focus==='insufficient'?null:review,
    goal:goal?{label:goal.label,supported:goal.attempt_rule_supported}:null,partial:s.partial || s.outcome==='failed',synthetic:s.voice.kind==='synthetic',mock:s.business_source==='mock_hskai'};
}
export class SummaryState {
  constructor(){this.reset();}
  reset(){this.sessionId=null;this.mode=null;this.data=null;this.ended=false;this.suppressed=false;}
  begin(sessionId,mode){this.reset();if(!id(sessionId) || !Object.hasOwn(modes,mode))return false;this.sessionId=sessionId;this.mode=mode;return true;}
  accept(packet){if(!this.sessionId || this.ended || this.suppressed || this.data)return false;const data=projectSummary(packet,{sessionId:this.sessionId,mode:this.mode});if(!data)return false;this.data=data;return true;}
  suppress(reason){this.suppressed=true;this.data={...structuredClone(empty),mode:this.mode,reason};}
  finish(){if(!this.sessionId)return null;this.ended=true;return structuredClone(this.data??{...empty,mode:this.mode,reason:'missing'});}
}
function element(tag,text,className){const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;return el;}
function bilingual(parent,zh,en){parent.append(element('p',zh,'summary-zh'));const english=element('p',en,'summary-en');english.lang='en';parent.append(english);}
export class SummaryCards {
  constructor({root,link,onRestart}){Object.assign(this,{root,link,onRestart});this.state=new SummaryState();this.reset();}
  reset(){this.state.reset();this.root.replaceChildren();this.root.hidden=true;this.link.hidden=true;}
  begin(sessionId,mode){this.reset();return this.state.begin(sessionId,mode);}
  accept(packet){return this.state.accept(packet);}
  suppress(reason){this.state.suppress(reason);this.root.replaceChildren();this.root.hidden=true;this.link.hidden=true;}
  finish(){const data=this.state.finish();if(data)this.render(data);}
  render(data){
    this.root.replaceChildren();this.root.hidden=false;this.link.hidden=false;this.root.dataset.focus=data.focus;
    const header=element('div',undefined,'summary-header');header.append(element('h2','本轮小结','summary-title'));header.firstChild.id='summary-title';header.append(element('span',modes[data.mode]??'本轮对话','summary-mode'));this.root.append(header);
    const status=element('div',undefined,'summary-status');status.setAttribute('role','status');bilingual(status,data.headline.zh,data.headline.en);this.root.append(status);
    if(data.synthetic)bilingual(this.root,'工程测试数据，不代表真实语音体验。','Engineering test data; this is not real voice acceptance.');
    if(data.mock)this.root.append(element('p','独立 POC · 身份与课程为本地示例。','summary-source'));
    if(data.partial)bilingual(this.root,'对话提前结束，仅展示已收到的部分记录。','The conversation ended early; only received records are shown.');
    if(data.focus==='unavailable')bilingual(this.root,'没有可展示的总结，请重新开始一轮。','No summary is available. You can start another conversation.');
    else {
      if(data.goal)this.root.append(element('p',`本轮对话目标：${data.goal.label}`,'summary-goal'));
      if(data.goal && !data.goal.supported)bilingual(this.root,'当前目标暂未自动评估，未据此判断学习结果。','This target has not been assessed; no learning result is inferred.');
      const grid=element('div',undefined,'summary-grid');
      for(const item of data.items){
        const card=element('article',undefined,'summary-card');card.append(element('p',item.attempts?`表达尝试 · ${item.attempts} 次`:'回复中的表达 · 尚无尝试记录','summary-label'));
        card.append(element('h3',item.text));card.append(element('p',item.pinyin,'pinyin'));const translation=element('p',item.english,'summary-en');translation.lang='en';card.append(translation);grid.append(card);
      }
      this.root.append(grid);
      if(data.review){const review=element('div',undefined,'summary-review');review.append(element('h3','可再练一句 · 自愿练习'));bilingual(review,data.review.text,data.review.english);bilingual(review,'下次想练习时，可以再试试这句话。','You can try this sentence again whenever you want.');this.root.append(review);}
      bilingual(this.root,'仅根据本轮记录整理；尚未评估掌握、独立使用或发音。','Based on this session only; mastery, independent use and pronunciation were not assessed.');
    }
    const restart=element('button','再聊一轮','summary-restart');restart.type='button';restart.addEventListener('click',()=>this.onRestart?.());this.root.append(restart);
  }
}
