import { readFile,mkdir,writeFile,readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { learnerFixture,SPORTS_RESOURCE,missionResource } from '../apps/hskai-mock/src/planning-fixtures.js';
import { MOCK_IDENTITY,MOCK_MISSION } from '../apps/hskai-mock/src/server.js';
import { ConversationInitializer,normalizeEntry } from '../packages/agent-core/conversation-initializer.js';
import { Preparations } from '../apps/realtime-gateway/src/preparations.js';
import { TeachingSession } from '../packages/agent-core/teaching.js';
import { configuredPlanner,PLANNER_PROMPT_VERSION } from '../packages/agent-core/planner-port.js';
import { PLANNING_VERSION } from '../packages/contracts/planning.js';
import { GOAL_POLICY_VERSION } from '../packages/agent-core/goal-lifecycle.js';
import { checkPlanningBehavior } from '../apps/eval-runner/src/planning-semantics.js';
const sha=v=>createHash('sha256').update(v).digest('hex');
async function sources(dir) {
  const out={};for(const x of await readdir(dir,{withFileTypes:true})){const p=dir+'/'+x.name;if(x.isDirectory())Object.assign(out,await sources(p));else if(x.name.endsWith('.js'))out[p]=sha(await readFile(p));}return out;
}
export async function runGoalEval({live=false,selected=null,onCase=()=>{}}={}) {
  const bytes=await readFile('docs/eval-datasets/dynamic-goals-v1/cases.json'),dataset=JSON.parse(bytes);
  const planner=live?configuredPlanner():null;if(live&&!planner)throw new Error('MINIMAX_PLANNER_CONFIG_REQUIRED');
  if(selected&&!dataset.cases.some(c=>c.id===selected))throw new Error('UNKNOWN_GOAL_EVAL_CASE');
  const transport=[];if(planner)planner.observe=r=>transport.push(r);
  const results=[],privateReview=[];
  for(const c of dataset.cases.filter(c=>!selected||c.id===selected)) {
    const identity={...MOCK_IDENTITY,mission:MOCK_MISSION,scopes:['session:create'],authorization_until:Date.now()+600000};
    const port={read:async()=>learnerFixture(identity,{variant:c.fixture}),getResource:async(i,e)=>e.mode==='free'?null:e.mode==='mission'?missionResource(i.mission):SPORTS_RESOURCE};
    const entry=normalizeEntry({mode:c.mode,...(c.mode==='mission'?{mission_id:MOCK_MISSION.id}:{})},identity),initializer=new ConversationInitializer({port,planner});
    const start=performance.now();let bound;
    try{bound=new Preparations({initializer}).bind(await initializer.prepare(entry,identity),'eval-'+c.id);}
    catch{const row={id:c.id,status:'initialization_failed',initial_accepted:false,turns:[],elapsed_ms:Math.round(performance.now()-start)};results.push(row);onCase(row);continue;}
    const s=new TeachingSession({sessionId:bound.plan.session_id,mode:c.mode,mission:identity.mission,planning:bound,planner,resourceResolver:async()=>SPORTS_RESOURCE});
    const initial={goal:bound.plan.primary_goal?.id??null,planner:bound.plan.planner_kind,degraded_reason:bound.plan.degraded_reason,attempts:bound.plan.planner_attempts,passed:c.initial_goals.includes(bound.plan.primary_goal?.id??null)};
    const turns=[];
    for(const [index,row] of c.turns.entries()) {
      const e={version:1,event_id:'input-'+c.id+'-'+index,session_id:s.sessionId,seq:index+1,at_ms:index,type:'user.final',turn_id:'turn-'+index,payload:{text:row.text}};
      const began=performance.now();s.accept(e);const p=await s.planTurn(e);
      const actual={goal:s.planning.plan.primary_goal?.id??null,status:s.planning.plan.goal_status,action:p?.action??null,new_points:p?.reply_directive.new_points??null,local_help:!!p?.local_help_target};
      turns.push({index,...actual,planner:p?.planner_kind??null,degraded_reason:p?.degraded_reason??null,attempts:s.planning.records.at(-1)?.attempts??[],elapsed_ms:Math.round(performance.now()-began),...checkPlanningBehavior(actual,row.expect)});
      // Only synthetic authored input and accepted business plan, private for
      // semantic review; never provider wire traces or model reasoning.
      privateReview.push({case_id:c.id,index,input:row.text,plan:p,goal_review:s.planning.review()});
    }
    const result={id:c.id,status:'completed',initial_accepted:true,initial,turns,elapsed_ms:Math.round(performance.now()-start)};
    results.push(result);onCase(result);s.finalize({businessSource:'mock_hskai'});
  }
  if(live){await mkdir('.local/goal-eval',{recursive:true});await writeFile('.local/goal-eval/review.json',JSON.stringify(privateReview,null,2),{mode:0o600});}
  const turns=results.flatMap(c=>c.turns),llm=turns.filter(t=>t.planner==='llm');
  return {schema_version:'goal-eval-v1',dataset_sha256:sha(bytes),source_hashes:{...await sources('packages'),...await sources('apps'),...await sources('scripts')},candidate:{prompt:PLANNER_PROMPT_VERSION,contract:PLANNING_VERSION,goal_policy:GOAL_POLICY_VERSION,model:'MiniMax-M3',path:'next_turn_advisory'},synthetic_inputs:true,model_calls_enabled:live,real_voice_connected:false,browser_audio_tested:false,contains_transcripts:false,transport,denominators:{cases:results.length,initial_llm:results.filter(c=>c.initial?.planner==='llm').length,initial_rule:results.filter(c=>c.initial?.planner==='rule').length,initial_failed:results.filter(c=>!c.initial_accepted).length,turns:turns.length,llm_turns:llm.length,rule_turns:turns.filter(t=>t.planner==='rule').length,unaccepted_turns:turns.filter(t=>!t.planner).length,llm_behavior_pass:llm.filter(t=>t.passed).length,host_behavior_pass:turns.filter(t=>t.passed).length},cases:results,semantic_quality_accepted:false,independent_judge_calls:0,human_calibrated:false,current_turn_control_verified:false};
}
const args=process.argv.slice(2);
if(import.meta.url===new URL(process.argv[1],'file:').href) {
  try{if(args.some(a=>a!=='--live'&&!a.startsWith('--case=')))throw new Error('INVALID_GOAL_EVAL_ARGUMENT');console.log(JSON.stringify(await runGoalEval({live:args.includes('--live'),selected:args.find(a=>a.startsWith('--case='))?.slice(7),onCase:c=>console.error(c.id+': '+c.status)}),null,2));}
  catch(error){console.error(['MINIMAX_PLANNER_CONFIG_REQUIRED','UNKNOWN_GOAL_EVAL_CASE','INVALID_GOAL_EVAL_ARGUMENT'].includes(error.message)?error.message:'GOAL_EVAL_FAILED');process.exitCode=1;}
}
