import { validateEvent } from '../contracts/events.js';
import { PERSONA_VERSION,SPORTS_LESSON } from './lessons.js';
import { speechPaceInstructions } from './speech.js';
import { REPLY_POLICY_VERSION,REPLY_BUDGET } from './reply-policy.js';
import { NaturalTeaching,TEACHING_POLICY_VERSION } from './natural-teaching.js';
import { LearningSummary,SUMMARY_LIMITS } from './learning-summary.js';
import { LanguageSupport } from './language-support.js';
import { compileContextSnapshot } from './context-snapshot.js';
export class TeachingSession {
  constructor({sessionId,mode='sports',memory=[],mission=null,speechPace}) {
    if(!['sports','free','mission'].includes(mode))throw new Error('INVALID_MODE');
    if(mode==='mission' && !mission)throw new Error('TRUSTED_MISSION_REQUIRED');
    this.speechInstructions=speechPaceInstructions(speechPace);
    Object.assign(this,{sessionId,mode,memory:structuredClone(memory),mission:mission?structuredClone(mission):null});this.stage='warmup';this.version=1;this.seen=new Set();this.evidence=[];this.completedReplyTurns=new Set();
    this.teaching=new NaturalTeaching({mode,mission});
    this.learning=new LearningSummary({sessionId,mode,mission});
    this.language=new LanguageSupport({memory});
  }
  instructions() {
    return this.contextSnapshot().instructions;
  }
  contextSnapshot() {
    const memory=this.language.validMemory().map(m=>({field:m.field,value:m.value,source:m.source,updated_at:m.updated_at}));
    return compileContextSnapshot({sessionId:this.sessionId,version:this.version,mode:this.mode,mission:this.mission,stage:this.stage,speechInstructions:this.speechInstructions,
      languageInstructions:this.language.instructions(),language:this.language.snapshot(),decision:this.teaching.decision,teachingContext:this.teaching.context(),memory});
  }
  accept(event) {
    if(this.closed || !validateEvent(event) || event.session_id!==this.sessionId || event.type!=='user.final' || this.seen.has(event.turn_id))return false;
    if(this.seen.size>=1000)throw new Error('TEACHING_TURN_LIMIT');
    this.seen.add(event.turn_id);
    this.version++;
    const decision=this.teaching.select(event,this.version);
    this.language.observe(event.payload.text,{turn_id:event.turn_id,source_event_id:event.event_id,context_version:this.version});
    if(this.completedReplyTurns.has(event.turn_id))this.language.completeReply(event.turn_id);
    if(this.stage==='warmup')this.stage='conversation';
    if(decision.action==='CLOSE')this.stage='closing';
    else if(this.stage==='closing')this.stage='conversation';
    const attempt=this.learning.recordFinal(event,decision);
    if(attempt) {
      this.evidence.push(attempt);
      if(decision.action!=='CLOSE'&&!decision.teaching_paused)this.stage='practice';
    }
    return true;
  }
  completeReply(event) {
    if(this.closed||!validateEvent(event)||event.session_id!==this.sessionId||!['response.done','response.cancelled'].includes(event.type)||this.completedReplyTurns.has(event.turn_id))return false;
    if(this.completedReplyTurns.size>=1000)throw new Error('TEACHING_TURN_LIMIT');
    this.completedReplyTurns.add(event.turn_id);
    if(!this.language.completeReply(event.turn_id))return false;
    this.version++;return true;
  }
  forward(packet) {return this.learning.forward(packet);}
  updateMemory(memory){this.memory=structuredClone(memory);this.language.updateMemory(memory);this.version++;}
  languageSnapshot(){return this.language.snapshot();}
  finalize(options={}) {this.closed=true;return this.learning.finalize({...options,evidence:this.evidence});}
  view() {
    const sports=this.mode==='sports';
    const language=this.languageSnapshot();
    return {mode:this.mode,stage:this.stage,context_version:this.version,persona_version:PERSONA_VERSION,reply_policy_version:REPLY_POLICY_VERSION,reply_budget:{...REPLY_BUDGET},language_policy:{version:language.policy_version,english_support:language.english_support,reason:language.reason,known_expression_count:language.known_expressions.length},teaching_policy_version:TEACHING_POLICY_VERSION,decision:this.teaching.decision?{...this.teaching.decision}:null,lesson_source:sports?SPORTS_LESSON.source:this.mode==='mission'?'authorized-hskai-mission':null,lesson_version:sports?SPORTS_LESSON.version:null,goal:sports?SPORTS_LESSON.goal.label:this.mode==='mission'?this.mission.targets[0]:'用中文聊感兴趣的话题。',start_tip:sports?SPORTS_LESSON.start_tip:'可以从一句简单的中文开始。',cards:sports?structuredClone(SPORTS_LESSON.cards):[],attempts:structuredClone(this.evidence.slice(-SUMMARY_LIMITS.view_attempts)),attempt_count:this.evidence.length,attempts_truncated:this.evidence.length>SUMMARY_LIMITS.view_attempts,notice:'最终识别仅形成学习尝试；尚未评估掌握或发音。'};
  }
}
