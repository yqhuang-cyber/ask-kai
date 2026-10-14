import { randomUUID } from 'node:crypto';
import { immutable,exact,isId,requireIdentity,PLANNING_VERSION } from '../contracts/planning.js';
import { boundedProposal,PLANNER_PROMPT_VERSION } from './planner-port.js';
import { validateConversation,planHash } from './plan-validator.js';
export function normalizeEntry(input,identity) {
  if(!exact(input,['mode','topic_id','mission_id','speech_pace'])||!['sports','topic','mission','free'].includes(input.mode)||input.speech_pace!==undefined&&!['slow','normal'].includes(input.speech_pace))throw new Error('INVALID_PLANNING_ENTRY');
  const mode=input.mode==='sports'?'topic':input.mode;
  if(mode==='mission'&&(!isId(input.mission_id)||input.mission_id!==identity.mission?.id))throw new Error('TRUSTED_MISSION_REQUIRED');
  if(mode==='topic'&&input.topic_id!==undefined&&input.topic_id!=='sports'||mode!=='topic'&&input.topic_id!==undefined||mode!=='mission'&&input.mission_id!==undefined)throw new Error('INVALID_PLANNING_RESOURCE');
  return {mode,...(mode==='topic'?{topic_id:'sports'}:{}),...(mode==='mission'?{mission_id:input.mission_id}:{}),...(input.speech_pace?{speech_pace:input.speech_pace}:{})};
}
export function conservativeConversation(entry,context,resource) {
  const learning=context.learning_profile,profile=context.student_profile,declined=context.learning_history.flatMap(r=>r.declined_goal_ids);
  const independent=id=>learning.kp_states.some(s=>s.kp_id===id&&['demonstrated_independent','demonstrated_transfer'].includes(s.evidence_state));
  const eligible=resource?.goals.filter(g=>!declined.includes(g.id)&&g.kp_ids.every(id=>resource.key_points.find(k=>k.id===id).prerequisites.every(independent)))??[];
  const goal=entry.mode==='free'?null:eligible.find(g=>g.kp_ids.some(id=>learning.review_candidates.includes(id)))??eligible.find(g=>!g.kp_ids.every(independent))??eligible[0]??null;
  const state=learning.kp_states.find(k=>goal?.kp_ids.includes(k.kp_id));
  const interest=profile.interests.find(i=>i.topic_id===entry.topic_id||entry.mode==='mission');
  return {conversation_purpose:entry.mode==='free'?'跟随学生选择进行自然交流':`围绕${resource.title}进行简短交流`,content_focus:entry.mode==='free'?'由学生选择话题':interest?.label??resource.title,opening_options:[],primary_goal_id:goal?.id??null,candidate_goal_ids:[],key_points:goal?.kp_ids??[],strategy:{language_support:learning.language_support,support_level:state?.support_needed??'unknown',correction:profile.conversation_preferences.correction,pace:entry.speech_pace??profile.conversation_preferences.pace},selection_basis:[{reason:entry.mode==='free'?'free_student_choice':goal?'conservative_evidence_selection':'declined_or_unverified_goals',refs:[context.snapshot_id,...(goal?[goal.id]:[]),...(state?[state.record_id]:[]),...(interest&&entry.mode!=='free'?[interest.record_id]:[])]}]};
}
export function planProjection(plan,resource) {
  const goal=plan.primary_goal;
  return {mode:plan.mode==='topic'?'sports':plan.mode,goal:goal?.label??'由你选择话题，自然交流。',prompt_title:plan.content_focus,start_tip:goal?.start_tip??'',cards:goal?resource.cards.filter(c=>goal.card_ids.includes(c.id)).map(({id,...c})=>c):[],attempts:[],attempt_count:0,notice:'示例学习资料来自本地 mock；目标不是学习成果。',planning:{mode:plan.execution_mode,planner_kind:plan.planner_kind,degraded:!!plan.degraded_reason}};
}
export class ConversationInitializer {
  constructor({port,planner,mode='next_turn_advisory',clock=()=>Date.now(),budgetMs=10000}){if(!Number.isSafeInteger(budgetMs)||budgetMs<1||budgetMs>20000)throw new Error('INVALID_INITIAL_PLANNING_BUDGET');Object.assign(this,{port,planner,mode,clock,budgetMs});}
  async prepare(entry,identity,{signal}={}) {
    requireIdentity(identity,'session:create',this.clock());
    const deadline=AbortSignal.timeout(this.budgetMs),combined=signal?AbortSignal.any([signal,deadline]):deadline;
    let aborted;
    const [context,resource]=await Promise.race([Promise.all([this.port.read(identity),this.port.getResource(identity,entry)]),new Promise((_,reject)=>{aborted=()=>reject(new Error('PREPARATION_CANCELLED'));combined.addEventListener('abort',aborted,{once:true});if(combined.aborted)aborted();})]).finally(()=>combined.removeEventListener('abort',aborted));
    combined.throwIfAborted();requireIdentity(identity,'session:create',this.clock());
    const input=immutable({entry,student_profile:context.student_profile,learning_profile:context.learning_profile,learning_history:context.learning_history,coverage:context.coverage,history_page:context.history_page,snapshot_ref:context.snapshot_id,resource});
    const result=await boundedProposal({planner:this.planner,method:'planConversation',input,signal:combined,budgetMs:this.budgetMs,validate:p=>validateConversation(p,{entry,context,resource}),fallback:()=>conservativeConversation(entry,context,resource)});
    combined.throwIfAborted();requireIdentity(identity,'session:create',this.clock());
    const p=result.proposal,plan={schema_version:'conversation-plan-v1',plan_id:randomUUID(),revision:1,session_id:null,mode:entry.mode,resource_refs:resource?[{id:resource.id,version:resource.version}]:[],input_refs:{context:context.snapshot_id,revision:context.revision,coverage:context.coverage,policy:PLANNING_VERSION,prompt:PLANNER_PROMPT_VERSION},...p,primary_goal:resource?.goals.find(g=>g.id===p.primary_goal_id)??null,goal_status:p.primary_goal_id?'active':'unverified',planner_kind:result.planner_kind,degraded_reason:result.degraded_reason,execution_mode:this.mode};
    return {plan:immutable({...plan,hash:planHash(plan)}),context,resource};
  }
}
