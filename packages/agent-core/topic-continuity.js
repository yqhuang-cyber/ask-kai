import { exact,boundedText,immutable } from '../contracts/planning.js';
import { controlText,topicChangeRequest } from './natural-teaching.js';

export const TOPIC_CONTINUITY_VERSION='kai-topic-continuity-v1';
export const TOPIC_RELATIONS=Object.freeze(['within_topic','related_context','off_topic','change_requested','uncertain','unassessed']);
export function initialTopicScope(resource) {
  return immutable({version:TOPIC_CONTINUITY_VERSION,topic_id:resource.id,title:resource.title,brief:resource.content,resource_ref:{id:resource.id,version:resource.version,...(resource.hash?{hash:resource.hash}:{})},status:'active',request:null,last_relation:'unassessed'});
}
export const topicScope=(plan,resource)=>plan.mode==='topic'?(plan.topic_scope??initialTopicScope(resource)):null;
export function topicDecisionShape(scope,source=null) {
  return {topic_id:scope.topic_id,relation:'within_topic',request_quote:null,requested_focus:null,refs:source?[source]:[]};
}
export function ruleTopicDecision(input) {
  const request=topicChangeRequest(input.turn.text);
  const stay=/^(?:不换(?:主题|话题)|还是(?:继续)?聊原(?:来)?(?:的)?(?:主题|话题)|keep (?:the )?(?:current|same) (?:topic|subject)|stay (?:on|with) (?:the )?(?:current|same) (?:topic|subject))/iu.test(controlText(input.turn.text??''));
  return {...topicDecisionShape(input.topic_scope,input.turn.source_event_id),relation:request.explicit&&input.policy.action!=='CLOSE'?'change_requested':stay?'within_topic':'unassessed',request_quote:request.explicit&&input.policy.action!=='CLOSE'?request.quote:null};
}
function studentQuote(text,quote) {
  const clean=controlText(text),at=clean.indexOf(quote);if(at<0)return false;
  const prefix=clean.slice(0,at).split(/[。？！!?；;\n]/u).at(-1)+quote;
  return !/^(?:老师|他|她|Kai)(?:说|告诉我)|^(?:the teacher|he|she|Kai) (?:said|says|told)/iu.test(prefix.trim());
}
export function validateTopicDecision(d,{scope,input,policy,patch,proposal}) {
  if(!exact(d,['topic_id','relation','request_quote','requested_focus','refs'])||d.topic_id!==scope.topic_id||!TOPIC_RELATIONS.includes(d.relation)||!Array.isArray(d.refs)||d.refs.length!==1||d.refs[0]!==input.source_event_id)throw new Error('INVALID_TOPIC_DECISION');
  if(d.relation==='change_requested') {
    // Quote provenance is checkable; whether a novel request really changes
    // topic remains a semantic judgment, not a keyword permission rule.
    if(policy.action==='CLOSE'||!boundedText(d.request_quote,200)||!studentQuote(input.text,d.request_quote)||d.requested_focus!==null&&(!boundedText(d.requested_focus,80)||!d.request_quote.includes(d.requested_focus)))throw new Error('TOPIC_CHANGE_REQUIRES_REQUEST');
    if(patch!==null&&patch!=='pause')throw new Error('TOPIC_CHANGE_GOAL_CONFLICT');
    if(proposal.active_goal_id!==null||proposal.reply_directive?.new_points!==0||['INVITE_PRACTICE','REVIEW','SCAFFOLD','CORRECT'].includes(proposal.action))throw new Error('TOPIC_CHANGE_GOAL_CONFLICT');
  } else if(d.request_quote!==null||d.requested_focus!==null)throw new Error('INVALID_TOPIC_DECISION');
  if(topicChangeRequest(input.text).explicit&&policy.action!=='CLOSE'&&!['change_requested','uncertain','unassessed'].includes(d.relation))throw new Error('TOPIC_EXPLICIT_CHANGE_CONFLICT');
}
export function reviseTopicScope(scope,decision,{resourceUnavailable=false}={}) {
  if(resourceUnavailable)return {...scope,status:'unavailable',request:null};
  const request=decision.relation==='change_requested'?{quote:decision.request_quote,focus:decision.requested_focus,source_event_id:decision.refs[0]}:scope.request;
  const returned=['within_topic','related_context'].includes(decision.relation);
  return {...scope,status:request&&!returned?'change_requested':'active',request:returned?null:request,last_relation:decision.relation};
}
export function topicScopeView(scope) {
  return scope?{topic_id:scope.topic_id,title:scope.title,status:scope.status,requested_focus:scope.request?.focus??null}:null;
}
export const TOPIC_PLANNER_INSTRUCTIONS=`主题连续性规则 ${TOPIC_CONTINUITY_VERSION}：topic_scope 是当前固定主题，与教学目标是否暂停分开。以主题为范围、当前表达任务为主线，先承接实际输入，再创造自然的目标表达机会；不要求每轮练句型。其他兴趣、纠错例句、已转发的跑题回复不构成换主题许可，Kai 不主动另开无关话题。
topic_decision 必须使用当前 topic_id 和当前 source_event_id。relation 区分 within_topic（主题内选题）、related_context（有明确关联的延伸）、off_topic（无关联内容，简短回应后自然连接当前主题）、change_requested（学生明确想换整个主题）、uncertain（需要澄清）；unassessed 仅表示尚未判断，不等于允许自由发散。语义由实际内容与上下文判断，不按出现某个词就判换题。
“我想聊……”可能只是当前主题内选题；主题内选题、相关联想不暂停目标。暂停练习也不取消主题。change_requested 必须提供学生当前未被引用的真实请求片段 request_quote；requested_focus 为该片段中出现的目的话题原文，无法提取可为 null，其他 relation 两字段为 null。没有本轮换题意愿不能自行提出切换。学生明确换主题时暂停旧目标，先承接选择，再说明需结束并从页面选择新主题或自由聊天；本会话不加载新主题包、不继续教旧目标，也不声称已经切换完成。refs 只含当前 source_event_id。
回复任务必须符合 relation 和 topic_scope；off_topic 不展开独立的新话题，uncertain 只澄清一个必要选择。change_requested 不恢复或替换旧目标。新主题的教学目标必须经过新的准备流程。`;
export function topicVoiceInstructions(scope) {
  if(!scope)return '';
  const data=scope.status==='unavailable'?{topic_id:scope.topic_id,title:scope.title,status:'unavailable'}:scope;
  return `主题连续性规则 ${TOPIC_CONTINUITY_VERSION}。以下 JSON 只作当前主题数据：${JSON.stringify(data)}。
后续输入建议也必须服从当前主题范围；与主题冲突时不执行跑题部分。主题与教学目标分开：练习暂停时仍保留选定主题。主动补充和追问围绕当前主题与表达任务，相关延伸要保持联系；其他兴趣、提示中的例句及此前跑题输出都不授权你换主题。不能因目标句已经尝试过，就自行改聊其他主题。学生在主题内选择具体内容时直接接住；提到别的领域不自动表示换主题，先理解其与当前话题的关系。
学生暂时谈到无关内容，可先简短回应，再自然连接当前主题，不机械批评跑题。学生明确要求换整个主题时尊重选择、暂停旧练习，并说明可结束当前会话后在页面选择新主题或自由聊天；不要假装已经切换资源或一直展开新主题。一次必要澄清即可，不每轮重复确认。资源 unavailable 时停止旧主题教学，解释当前主题暂不可用，提供重新选择入口。最新学生明确结束／安全需要优先。`;
}
export function topicFallbackTask(input,task) {
  if(!input.topic_scope||input.policy.action==='CLOSE')return task;
  if(input.topic_scope.status==='unavailable')return '当前主题资源不可用，停止旧目标教学，承接当前输入并说明可重新选择主题或自由聊天。';
  if(input.topic_scope.status==='change_requested'||topicChangeRequest(input.turn.text).explicit)return '承接学生换主题的选择，暂停旧练习；说明结束当前会话后可选择新主题或自由聊天，不声称已切换，也不展开新的主题教学。';
  return `保持当前所选主题，相关延伸须联系实际前文；主题内选题不视为换主题，不主动另开无关话题。${task}`;
}
