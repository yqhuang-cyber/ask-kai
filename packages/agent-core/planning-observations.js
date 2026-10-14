import { randomUUID } from 'node:crypto';
import { sportsExpression } from './natural-teaching.js';
import { validateLearningRecord } from '../contracts/planning.js';
export class PlanningObservations {
  constructor({sessionId,resource,plan}){Object.assign(this,{sessionId,resource,plan});this.observations=new Map();}
  accept(event,{goal_status='active'}={}) {
    if(event.type!=='user.final'||event.session_id!==this.sessionId)return;
    // A corrected final replaces the old candidate, never adds another attempt.
    this.observations.delete(event.turn_id);
    if(goal_status!=='active')return;
    const goal=this.plan.primary_goal;if(!goal)return;
    const kp=this.resource?.key_points.find(k=>goal.kp_ids.includes(k.id));
    const attempted=kp?.evidence_rule==='likes-attempt-v1'?sportsExpression(event.payload.text):kp?.evidence_rule==='time-attempt-v1'&&/^我(?:上午|下午|晚上)(?:踢足球|打篮球|跑步|游泳)[。！!\s]*$/u.test(event.payload.text)?event.payload.text:null;
    if(!attempted)return;
    this.observations.set(event.turn_id,{observation_id:randomUUID(),turn_id:event.turn_id,source_event_id:event.event_id,kp_id:kp.id,state:'attempted',support:'unknown',execution_ref:null});
  }
  record(plan,outcome='ended'){return validateLearningRecord({schema_version:'learning-record-v1',session_id:this.sessionId,plan_id:plan.plan_id,plan_revision:plan.revision,resource_ref:plan.resource_refs[0]??null,observations:[...this.observations.values()].slice(-100),outcome,source:'ask_kai_observation'});}
}
