import test from 'node:test';
import assert from 'node:assert/strict';
import { checkPreparedDataset } from '../apps/eval-runner/src/prepared-dataset.js';
import { WEIGHTS,RUBRIC_VERSION } from '../apps/eval-runner/src/content.js';
import { REPLY_BUDGET,REPLY_POLICY_VERSION } from '../packages/agent-core/reply-policy.js';
import { LANGUAGE_POLICY_VERSION } from '../packages/agent-core/language-support.js';

// Small authored synthetic fixture; no uploaded learner dialogue is committed.
function fixture(){return {format:'ask-kai-prepared-eval',version:1,status:'prepared_not_executed',
 scope:{entry:'free',modality:'text',provider_executed:false,judge_executed:false},
 rules:{weights:{...WEIGHTS},rubric_version:RUBRIC_VERSION,language_policy_version:LANGUAGE_POLICY_VERSION,reply_policy_version:REPLY_POLICY_VERSION,budget:{...REPLY_BUDGET},safety_na_allowed:false},
 source:{sha256:'a'.repeat(64),case_count:1,turn_count:1,original_reference_preserved:true},
 cases:[{id:'ask-kai-v2-001',entry:'free',title:'synthetic close',initial_state:{prior_context:[],prior_context_status:'not_provided',profile:{support_language:'auto',chinese_comprehension:'unknown',known_expressions:[]},profile_evidence:[],unknown_fields:['profile'],audio_available:false,image_available:false,mission_contract:null},
 soft_goal:{text:'chat briefly',kind:'inferred_from_opening',source_turn:1,available_from_turn:1,binding:false,may_change:true},opening_context:{source_turn:1,available_from_turn:1},
 turns:[{turn:1,input:{role:'student',text:'Bye.'},history_rule:{prior_student_turns:[],include_reference_kai:false,include_future_turns:false,include_actual_prior_kai:true},reference_for_judge_only:'再见。Goodbye.',original:{'案例编号':'ask-kai-v2-001','轮次':'1','用户发言':'Bye.','参考Kai回复':'再见。Goodbye.'},expected:{behavior:'结束与小结',must:['respect close'],must_avoid:['invented learning'],critical_failures:['false mastery'],language_semantics:'Chinese first',english_support:'required',rubric_dimensions:Object.keys(WEIGHTS),predeclared_na:{},proactive:{signal:'未指定主动检查',requirement:'respect intent',event:'none',idle_event:false},summary:{oral:'short_close',visual:'existing_web_summary',evidence:'actual_observed_only'}},language_preview:{policy:{english_support:'required'},semantic_review_required:true,provider_context_ack_verified:false},reference_surface_audit:{target:'authored_reference_only',actual_model_score:null}}]}],
 preparation_check:{case_count:1,turn_count:1,proactive_utterance_count:0,actual_scores_present:false,provider_run_count:0,judge_run_count:0},review_issues:[]};}
test('prepared evaluation data is checked without inventing executed results',()=>{
 assert.deepEqual(checkPreparedDataset(fixture()),{status:'preparation_checks_passed',case_count:1,turn_count:1,proactive_utterance_count:0,rubric_version:RUBRIC_VERSION,provider_runs:0,judge_runs:0});
});
test('reference or future history, future initial goal and unsupported known expressions are rejected',()=>{
 for(const [mutate,code] of [
  [d=>d.cases[0].turns[0].history_rule.include_reference_kai=true,'PREPARED_HISTORY_LEAK'],
  [d=>d.cases[0].turns[0].history_rule.prior_student_turns=[1],'PREPARED_HISTORY_LEAK'],
  [d=>d.cases[0].soft_goal.source_turn=2,'INVALID_PREPARED_GOAL'],
  [d=>d.cases[0].initial_state.profile.known_expressions=['茶'],'MISSING_PREPARED_PROFILE_EVIDENCE'],
  [d=>d.cases[0].turns[0].original['参考Kai回复']='changed','PREPARED_SOURCE_CHANGED'],
  [d=>d.cases[0].turns[0].expected.proactive.idle_event=true,'PREPARED_IDLE_INVENTED'],
  [d=>d.cases[0].turns[0].reference_surface_audit.actual_model_score=100,'PREPARED_FAKE_RESULTS'],
  [d=>d.cases[0].turns[0].language_preview.policy.known_expressions=['茶'],'PREPARED_LANGUAGE_CONTEXT_LEAK'],
  [d=>d.cases[0].turns[0].expected.predeclared_na.progress='social','INVALID_PREPARED_RUBRIC'],
  [d=>d.rules.weights.intent=14,'PREPARED_RULES_DRIFT'],
  [d=>d.source.turn_count=2,'PREPARED_COUNT_MISMATCH'],
 ]){const d=fixture();mutate(d);assert.throws(()=>checkPreparedDataset(d),{message:code});}
});
