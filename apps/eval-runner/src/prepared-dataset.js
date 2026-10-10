import { WEIGHTS,RUBRIC_VERSION } from './content.js';
import { REPLY_BUDGET,REPLY_POLICY_VERSION } from '../../../packages/agent-core/reply-policy.js';
import { LANGUAGE_POLICY_VERSION,LanguageSupport } from '../../../packages/agent-core/language-support.js';

const text=v=>typeof v==='string'&&v.trim().length>0;
const list=v=>Array.isArray(v)&&v.length>0&&v.every(text);
const assert=(condition,code)=>{if(!condition)throw new Error(code);};
const sameObject=(a,b)=>a&&Object.keys(a).length===Object.keys(b).length&&Object.entries(b).every(([k,v])=>a[k]===v);

// Preparation checks only: no model call, transcript replay or content score.
export function checkPreparedDataset(data) {
  assert(data?.format==='ask-kai-prepared-eval'&&data.version===1&&data.status==='prepared_not_executed','INVALID_PREPARED_FORMAT');
  assert(data.scope?.entry==='free'&&data.scope.modality==='text'&&data.scope.provider_executed===false&&data.scope.judge_executed===false,'INVALID_PREPARED_SCOPE');
  assert(data.rules?.rubric_version===RUBRIC_VERSION&&data.rules.language_policy_version===LANGUAGE_POLICY_VERSION&&data.rules.reply_policy_version===REPLY_POLICY_VERSION&&sameObject(data.rules.weights,WEIGHTS)&&sameObject(data.rules.budget,REPLY_BUDGET),'PREPARED_RULES_DRIFT');
  assert(data.rules.safety_na_allowed===false&&data.source?.original_reference_preserved===true&&/^[a-f0-9]{64}$/.test(data.source.sha256),'INVALID_PREPARED_PROVENANCE');
  assert(Array.isArray(data.cases)&&data.cases.length>0&&new Set(data.cases.map(c=>c.id)).size===data.cases.length,'INVALID_PREPARED_CASES');
  let turns=0,proactive=0;
  for(const c of data.cases){
    assert(/^ask-kai-v2-\d{3}$/.test(c.id)&&c.entry==='free'&&text(c.title),'INVALID_PREPARED_CASE');
    const initial=c.initial_state,profile=initial?.profile;
    assert(initial?.audio_available===false&&initial.image_available===false&&initial.mission_contract===null&&initial.prior_context_status==='not_provided'&&Array.isArray(initial.prior_context)&&initial.prior_context.length===0,'INVALID_PREPARED_INITIAL_CONTEXT');
    assert(profile?.support_language==='auto'&&profile.chinese_comprehension==='unknown'&&Array.isArray(profile.known_expressions)&&profile.known_expressions.length<=12&&new Set(profile.known_expressions).size===profile.known_expressions.length&&profile.known_expressions.every(v=>text(v)&&[...v].length<=16),'INVALID_PREPARED_PROFILE');
    assert(list(initial.unknown_fields)&&Array.isArray(initial.profile_evidence)&&(!profile.known_expressions.length||initial.profile_evidence.some(e=>e.field==='known_expressions'&&e.kind==='scenario_assumption'&&e.source_turn===1&&text(e.basis))),'MISSING_PREPARED_PROFILE_EVIDENCE');
    assert(initial.profile_evidence.every(e=>e.source_turn===1),'FUTURE_INITIAL_PROFILE');
    assert(c.soft_goal?.kind==='inferred_from_opening'&&c.soft_goal.source_turn===1&&c.soft_goal.available_from_turn===1&&c.soft_goal.binding===false&&c.soft_goal.may_change===true&&text(c.soft_goal.text)&&c.opening_context?.available_from_turn===1&&c.opening_context.source_turn===1,'INVALID_PREPARED_GOAL');
    assert(Array.isArray(c.turns)&&c.turns.length>0,'MISSING_PREPARED_TURNS');
    const at=Date.parse('2026-10-10T00:00:00Z');
    const memory=profile.known_expressions.length?[{field:'known_expressions',value:profile.known_expressions,source:'authorized_hskai_profile',updated_at:new Date(at).toISOString(),expires_at:new Date(at+86400000).toISOString()}]:[];
    const language=new LanguageSupport({memory,clock:()=>at});
    c.turns.forEach((t,i)=>{
      assert(t.turn===i+1&&t.input?.role==='student'&&text(t.input.text),'NONCONTIGUOUS_PREPARED_TURNS');
      const h=t.history_rule;
      assert(h?.include_reference_kai===false&&h.include_future_turns===false&&h.include_actual_prior_kai===true&&JSON.stringify(h.prior_student_turns)===JSON.stringify(Array.from({length:i},(_,n)=>n+1)),'PREPARED_HISTORY_LEAK');
      assert(text(t.reference_for_judge_only)&&t.original?.['用户发言']===t.input.text&&t.original?.['参考Kai回复']===t.reference_for_judge_only&&t.original?.['案例编号']===c.id&&Number(t.original?.['轮次'])===t.turn,'PREPARED_SOURCE_CHANGED');
      const e=t.expected;
      assert(list(e?.must)&&list(e.must_avoid)&&list(e.critical_failures)&&text(e.behavior)&&text(e.language_semantics),'MISSING_PREPARED_EXPECTATIONS');
      assert(Array.isArray(e.rubric_dimensions)&&new Set(e.rubric_dimensions).size===10&&Object.keys(WEIGHTS).every(d=>e.rubric_dimensions.includes(d))&&e.predeclared_na&&Object.keys(e.predeclared_na).length===0,'INVALID_PREPARED_RUBRIC');
      assert(['required','adaptive','off'].includes(e.english_support)&&t.language_preview?.policy?.english_support===e.english_support&&t.language_preview.semantic_review_required===true&&t.language_preview.provider_context_ack_verified===false,'INVALID_PREPARED_LANGUAGE');
      language.observe(t.input.text,{turn_id:`turn-${t.turn}`,source_event_id:`prepared-${t.turn}`,context_version:t.turn+1});
      const computed=language.snapshot(),preview=t.language_preview.policy;
      assert(computed.english_support===preview.english_support&&JSON.stringify(computed.known_expressions)===JSON.stringify(preview.known_expressions??[])&&computed.preference===(preview.preference??'auto')&&computed.comprehension===(preview.comprehension??'unknown'),'PREPARED_LANGUAGE_CONTEXT_LEAK');
      const p=e.proactive;
      assert(p&&p.idle_event===false&&text(p.signal)&&text(p.requirement)&&['student_utterance','none'].includes(p.event)&&((p.signal==='未指定主动检查')===(p.event==='none')),'PREPARED_IDLE_INVENTED');
      if(p.event==='student_utterance')proactive++;
      assert(t.reference_surface_audit?.target==='authored_reference_only'&&t.reference_surface_audit.actual_model_score===null&&!Object.hasOwn(t,'scores')&&!Object.hasOwn(t,'actual_kai'),'PREPARED_FAKE_RESULTS');
      if(i===c.turns.length-1)assert(e.behavior==='结束与小结'&&e.summary?.oral==='short_close'&&e.summary.visual==='existing_web_summary'&&e.summary.evidence==='actual_observed_only','INVALID_PREPARED_CLOSE');
    });
    turns+=c.turns.length;
  }
  assert(data.source.case_count===data.cases.length&&data.source.turn_count===turns,'PREPARED_COUNT_MISMATCH');
  const report=data.preparation_check;
  assert(report?.case_count===data.cases.length&&report.turn_count===turns&&report.proactive_utterance_count===proactive&&report.actual_scores_present===false&&report.provider_run_count===0&&report.judge_run_count===0,'INVALID_PREPARED_REPORT');
  assert(Array.isArray(data.review_issues)&&data.review_issues.every(r=>data.cases.some(c=>c.id===r.case_id&&Number.isInteger(r.turn)&&r.turn>=0&&r.turn<=c.turns.length)&&text(r.type)&&text(r.observation)&&text(r.resolution)&&text(r.status)),'INVALID_PREPARED_REVIEW');
  return {status:'preparation_checks_passed',case_count:data.cases.length,turn_count:turns,proactive_utterance_count:proactive,rubric_version:RUBRIC_VERSION,provider_runs:0,judge_runs:0};
}
