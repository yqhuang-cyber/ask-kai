import { randomUUID } from 'node:crypto';
import { immutable,validateCurriculum } from '../contracts/planning.js';
import { boundedProposal } from './planner-port.js';
import { contextRefs,validateTurn,planHash } from './plan-validator.js';
import { goalChoice,eligibleGoal,assessGoal,GOAL_POLICY_VERSION } from './goal-lifecycle.js';
export function conservativeTurn(input) {
  const p=input.policy,close=p.action==='CLOSE',clarify=p.action==='CLARIFY_INTENT',attempted=input.goal_review?.assessment?.attempt_count>0;
  const easier=!close&&!p.teaching_paused&&input.goal_review?.difficulty_count>=2?input.resource?.goals.find(g=>eligibleGoal(g,{learning_profile:input.learning_profile,learning_history:input.learning_history??[]},input.resource)&&input.plan.primary_goal?.kp_ids.some(id=>input.resource.key_points.find(k=>k.id===id).prerequisites.some(kp=>g.kp_ids.includes(kp)))):null;
  const localHelp=!close&&!clarify&&p.reason==='student_requested_help';
  return {interpretation:{intent:close?'student_end':'current_input',clarity:clarify?'ambiguous':'unknown',refs:[input.turn.source_event_id]},prior_outcome:{execution_ref:input.prior_execution?.execution_id??null,status:input.prior_execution?.status??'none',unknown:['学生理解与完整播放未知']},goal_assessment:null,action:close?'CLOSE':clarify?'CLARIFY':easier?'RESPOND':attempted&&!p.teaching_paused?'FOLLOW_UP':'RESPOND',active_goal_id:null,local_help_target:localHelp?'回应本轮表达求助':null,reply_directive:{task:close?'简短告别，不追加提问、复盘或练习':clarify?'只问一个必要的短澄清问题，不猜意思':easier?'降低练习难度，给低压选择；不强制跟读或声称学生不会':'先回应学生当前内容，不新增目标或强制练习；不确定时低压承接',support_level:clarify||easier?'choice':'none',new_points:0,budget_ref:'kai-reply-v4'},expected_observation:{kind:close?'student_choice':'conversation_continuity',required_student_answer:null},proposed_plan_patch:p.teaching_paused?'pause':easier?{op:'replace',goal_id:easier.id,refs:[input.turn.source_event_id]}:null,evidence_refs:[input.turn.source_event_id],rationale_code:close?'student_end_rule':easier?'repeated_explicit_difficulty':'conservative_planner_fallback'};
}
export class PlanningState {
  constructor({plan,context,resource,planner,observations,resourceResolver,mode=plan.execution_mode,clock=()=>Date.now(),budgetMs=5000,onRecord=()=>{}}) {
    if(!Number.isSafeInteger(budgetMs)||budgetMs<1||budgetMs>10000)throw new Error('INVALID_TURN_PLANNING_BUDGET');
    Object.assign(this,{plan,context,resource,planner,observations,resourceResolver,mode,clock,budgetMs,onRecord});this.transitions=[];this.goalOutcomes=new Map();this.controlInputs=new Map();this.difficulties=[];this.localHelp=null;if(plan.primary_goal)this.goalOutcomes.set(plan.primary_goal.id,{goal:plan.primary_goal,status:plan.goal_status});this.revision=1;this.authorizationEpoch=1;this.closed=false;this.inputs=new Map();this.records=[];this.history=[];this.executions=new Map();this.current=null;this.accepted=null;this.controller=null;
  }
  emit(name,fields={}){this.onRecord(name,{planning_revision:this.revision,path:this.mode,...fields});}
  invalidate(reason='new_input') {this.revision++;this.controller?.abort();this.accepted=null;this.localHelp=null;this.emit('planning.cancelled',{reason});}
  review() {
    const rows=[...this.observations?.observations.values()??[]];
    return immutable({policy_version:GOAL_POLICY_VERSION,difficulty_count:this.difficulties.length,assessment:this.plan.primary_goal?assessGoal(this.plan.primary_goal,rows):null,transitions:this.transitions.slice(-6)});
  }
  commitGoal(status,{goal=this.plan.primary_goal,reason='policy',source=null}={}) {
    if(this.mode==='shadow'||this.closed)return;
    if(!['active','paused','retired'].includes(status)||status!=='retired'&&!goal)return;
    if(goal?.id===this.plan.primary_goal?.id&&status===this.plan.goal_status)return;
    const old=this.plan.primary_goal;
    if(old&&old.id!==goal?.id)this.goalOutcomes.set(old.id,{goal:old,status:'retired'});
    if(goal)this.goalOutcomes.set(goal.id,{goal,status});
    const {hash,...base}=this.plan;
    const next={...base,revision:base.revision+1,primary_goal:goal,primary_goal_id:goal?.id??null,key_points:goal?.kp_ids??[],candidate_goal_ids:[],goal_status:status,resource_refs:this.resource?[{id:this.resource.id,version:this.resource.version}]:[],selection_basis:[{reason,refs:source?[source]:[this.context.snapshot_id]}]};
    this.plan=immutable({...next,hash:planHash(next)});
    this.transitions.push({from:old?.id??null,to:goal?.id??null,status,reason,source_event_id:source,plan_revision:next.revision});this.transitions=this.transitions.slice(-100);
    this.emit('conversation_plan.revised',{plan_revision:next.revision,goal_status:status,reason});
  }
  controls(event,policy) {
    if(this.mode==='shadow'||this.closed||event.session_id!==this.plan.session_id||this.controlInputs.get(event.turn_id)===event.event_id)return;
    this.controlInputs.set(event.turn_id,event.event_id);this.localHelp=null;this.accepted=null;if(this.current?.source_event_id!==event.event_id)this.controller?.abort();
    const choice=goalChoice(event.payload.text);
    if(policy.action==='CLOSE'||['student_declined','student_changed_topic'].includes(policy.reason)) {
      this.difficulties=[];if(this.plan.primary_goal)this.commitGoal('paused',{reason:policy.reason,source:event.event_id});
    }
    if(policy.action==='CLOSE')return;
    if(choice.kind==='retire') {this.commitGoal('retired',{goal:null,reason:'student_cancelled_goal',source:event.event_id});this.difficulties=[];return;}
    if(choice.kind==='select') {
      const goal=this.resource?.goals.find(g=>g.id===choice.goal_id);
      if(eligibleGoal(goal,this.context,this.resource,{explicit:true})) {this.commitGoal('active',{goal,reason:'student_selected_goal',source:event.event_id});this.difficulties=[];}
      else if(this.plan.primary_goal)this.commitGoal('paused',{reason:'requested_goal_unverified',source:event.event_id});
      return;
    }
    if(this.plan.primary_goal&&this.plan.goal_status==='paused'&&!policy.teaching_paused&&['student_requested_practice','student_requested_help'].includes(policy.reason)&&eligibleGoal(this.plan.primary_goal,this.context,this.resource,{explicit:true}))this.commitGoal('active',{reason:'student_resumed_goal',source:event.event_id});
    if(choice.kind==='difficulty'&&this.plan.primary_goal&&this.plan.goal_status==='active') {
      this.difficulties.push({turn_id:event.turn_id,source_event_id:event.event_id});this.difficulties=this.difficulties.slice(-2);
    } else this.difficulties=[];
  }
  reduceSupport(event) {
    if(this.mode==='shadow'||this.plan.goal_status!=='active'||!this.observations?.observations.has(event.turn_id)||this.plan.strategy.support_level!=='model')return;
    const {hash,...base}=this.plan,next={...base,revision:base.revision+1,strategy:{...base.strategy,support_level:'partial'}};
    this.plan=immutable({...next,hash:planHash(next)});this.emit('conversation_plan.revised',{plan_revision:next.revision,reason:'reduce_support_after_attempt'});
  }
  async acceptInput(event,policy,language) {
    if(this.closed||event.session_id!==this.plan.session_id||event.type!=='user.final')return null;
    const previous=this.inputs.get(event.turn_id);
    if(previous?.text===event.payload.text)return null;
    if(this.inputs.size>=1000)throw new Error('PLANNING_TURN_LIMIT');
    this.invalidate(previous?'input_corrected':'new_input');
    const input=immutable({turn_id:event.turn_id,source_event_id:event.event_id,text:event.payload.text,input_revision:(previous?.input_revision??0)+1,expires_at:this.clock()+this.budgetMs,revision:this.revision,authorization_epoch:this.authorizationEpoch});
    this.inputs.set(event.turn_id,input);this.current=input;this.controls(event,policy);const controller=new AbortController();this.controller=controller;
    const choice=goalChoice(input.text);
    if(this.mode!=='shadow'&&choice.kind==='select'&&!this.resource&&this.resourceResolver) {
      let timer;
      try {
        const resource=await Promise.race([this.resourceResolver({signal:controller.signal}),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('RESOURCE_READ_TIMEOUT'));},Math.max(1,input.expires_at-this.clock()));}),new Promise((_,reject)=>controller.signal.addEventListener('abort',()=>reject(new Error('RESOURCE_READ_CANCELLED')),{once:true}))]);
        if(this.closed||controller.signal.aborted||this.current!==input||this.revision!==input.revision)return null;
        this.resource=validateCurriculum(resource);this.controlInputs.delete(event.turn_id);this.controls(event,policy);
      } catch {this.emit('planning.resource.unavailable',{turn_id:input.turn_id});if(controller.signal.aborted)return null;}
      finally{clearTimeout(timer);}
    }
    policy={...policy,teaching_paused:this.plan.goal_status==='paused'||this.plan.goal_status==='retired'||policy.teaching_paused&&this.plan.goal_status!=='active'};
    this.history=this.history.filter(h=>h.turn_id!==event.turn_id);
    const prior=[...this.executions.values()].at(-1)??null;
    const snapshot=immutable({plan:this.plan,turn:input,policy,language,actual_context:this.history.slice(-12),prior_execution:prior?{execution_id:prior.execution_id,status:prior.status,consumption:prior.consumption,generation_basis:prior.generation_basis}:null,student_profile:this.context.student_profile,learning_profile:this.context.learning_profile,learning_history:this.context.learning_history,coverage:this.context.coverage,resource:this.resource,goal_review:this.review()});
    this.history.push({turn_id:input.turn_id,source_event_id:event.event_id,role:'student',text:input.text});this.history=this.history.slice(-12);
    const allowedRefs=contextRefs(this.context,this.resource);allowedRefs.add(event.event_id);for(const o of this.observations?.observations.values()??[]){allowedRefs.add(o.observation_id);allowedRefs.add(o.source_event_id);}for(const h of snapshot.actual_context){allowedRefs.add(h.source_event_id);if(h.execution_id)allowedRefs.add(h.execution_id);}if(prior)allowedRefs.add(prior.execution_id);
    this.emit('planning.started',{turn_id:input.turn_id,input_revision:input.input_revision});
    const base={input_ref:event.event_id,turn_id:input.turn_id,input_revision:input.input_revision,based_on_plan_revision:this.plan.revision,base_planning_revision:input.revision,authorization_epoch:this.authorizationEpoch};
    let result;
    try {
      if(policy.action==='CLOSE')result={proposal:validateTurn(conservativeTurn(snapshot),{plan:this.plan,input,policy,allowedRefs,context:this.context,resource:this.resource,priorExecution:snapshot.prior_execution,review:snapshot.goal_review,now:this.clock()}),planner_kind:'rule',degraded_reason:null};
      else result=await boundedProposal({planner:this.planner,method:'planTurn',input:snapshot,signal:controller.signal,budgetMs:Math.max(1,input.expires_at-this.clock()-50),validate:p=>validateTurn(p,{plan:this.plan,input,policy,allowedRefs,context:this.context,resource:this.resource,priorExecution:snapshot.prior_execution,review:snapshot.goal_review,now:this.clock()}),fallback:()=>conservativeTurn(snapshot)});
    } catch {this.records.push({...base,status:'cancelled'});this.emit('planning.cancelled',{turn_id:input.turn_id});return null;}
    if(this.closed||controller.signal.aborted||this.current!==input||this.revision!==input.revision||this.clock()>input.expires_at){this.records.push({...base,status:'stale'});this.emit('planning.rejected',{turn_id:input.turn_id,reason:'stale'});return null;}
    const proposal={schema_version:'turn-plan-v1',proposal_id:randomUUID(),session_id:this.plan.session_id,...base,...result.proposal,planner_kind:result.planner_kind,degraded_reason:result.degraded_reason,accepted_at:this.clock(),expires_at:input.expires_at};
    const accepted=immutable({...proposal,hash:planHash(proposal)});
    this.records.push({proposal_id:accepted.proposal_id,...base,status:this.mode==='shadow'?'shadow':'accepted',planner_kind:accepted.planner_kind,degraded_reason:accepted.degraded_reason,attempts:result.attempts??[],hash:accepted.hash});
    if(this.mode!=='shadow') {
      const patch=accepted.proposed_plan_patch;
      if(policy.teaching_paused||patch==='pause')this.commitGoal('paused',{reason:'accepted_pause',source:event.event_id});
      else if(patch==='resume')this.commitGoal('active',{reason:'accepted_resume',source:event.event_id});
      else if(patch?.op==='replace')this.commitGoal('active',{goal:this.resource.goals.find(g=>g.id===patch.goal_id),reason:'accepted_goal_replacement',source:event.event_id});
      else if(patch?.op==='retire')this.commitGoal('retired',{goal:null,reason:'accepted_goal_retirement',source:event.event_id});
      this.localHelp=accepted.local_help_target?{text:accepted.local_help_target,turn_id:input.turn_id,source_event_id:event.event_id}:null;
      this.accepted=accepted;
    }
    this.emit('planning.accepted',{turn_id:input.turn_id,planner_kind:accepted.planner_kind,degraded:!!accepted.degraded_reason,rejection_code:(result.attempts??[]).filter(a=>a.state==='rejected').at(-1)?.code});return this.mode==='shadow'?null:accepted;
  }
  updateContext(context) {
    if(this.closed)return;this.invalidate('preferences_changed');this.context=context;
    const {hash,...base}=this.plan,interest=context.student_profile.interests[0]?.label;
    const next={...base,revision:base.revision+1,input_refs:{...base.input_refs,context:context.snapshot_id,revision:context.revision,coverage:context.coverage},selection_basis:[{reason:'authorized_context_refresh',refs:[context.snapshot_id]}],content_focus:this.plan.mode==='free'?base.content_focus:interest??'跟随学生当前选择',strategy:{...base.strategy,language_support:context.learning_profile.language_support,correction:context.student_profile.conversation_preferences.correction}};
    this.plan=immutable({...next,hash:planHash(next)});this.emit('conversation_plan.revised',{plan_revision:this.plan.revision});
    if(this.plan.primary_goal&&!eligibleGoal(this.plan.primary_goal,context,this.resource,{explicit:true}))this.commitGoal('paused',{reason:'prerequisite_context_changed'});
  }
  isCurrent(plan){return !this.closed&&this.accepted===plan&&this.current?.turn_id===plan.turn_id&&this.current?.input_revision===plan.input_revision&&this.revision===plan.base_planning_revision&&this.authorizationEpoch===plan.authorization_epoch;}
  observe(packet) {
    if(this.closed)return;
    const e=packet.event;if(!e||e.session_id!==this.plan.session_id||!e.response_id)return;
    let x=this.executions.get(e.response_id);
    if(e.type==='response.started'&&!x) {
      if(this.executions.size>=1000)return;
      x={execution_id:e.response_id,turn_id:e.turn_id,plan_id:this.plan.plan_id,plan_revision:this.plan.revision,turn_plan_ref:null,path:this.mode,generation_basis:'unknown',generation_requested_at:null,first_observed_output_at:this.clock(),status:'unknown',consumption:'unknown',text:'',audio_bytes:0};this.executions.set(e.response_id,x);
    }
    if(!x||x.turn_id!==e.turn_id||['cancelled','completed'].includes(x.status))return;
    if(e.type==='response.text.delta'){x.text=(x.text+e.payload.text).slice(0,2000);x.status='forwarded';}
    if(e.type==='response.audio.chunk'){x.audio_bytes+=e.payload.byte_length;x.status='forwarded';}
    if(e.type==='response.cancelled'){x.status='cancelled';x.text='';}
    if(e.type==='response.done'){x.status='completed';if(x.text)this.history.push({role:'teacher',turn_id:x.turn_id,source_event_id:e.event_id,execution_id:x.execution_id,text:x.text,presentation:'unknown'});this.history=this.history.slice(-12);}
  }
  consumption(responseId,report) {
    const x=this.executions.get(responseId);if(!x||this.closed||!['unknown','partial','client_reported_complete'].includes(report.state)||!Number.isFinite(report.audio_ms)||report.audio_ms<0)return false;
    x.consumption=report.state;x.client_reported_consumed_ms=report.audio_ms;return true;
  }
  close(){if(this.closed)return;this.closed=true;this.authorizationEpoch++;this.invalidate('session_closed');}
}
