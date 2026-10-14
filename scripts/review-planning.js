import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PlanningSemanticReviewer } from '../apps/eval-runner/src/planning-semantic-review.js';
import { MiniMaxJsonTransport } from '../packages/provider-minimax/planner.js';
// Explicitly reviews only the most recent synthetic goal-eval accepted plans.
// Verify authorship against the frozen dataset before transmitting any row.
export function authoredReviewInputs(rows,dataset) {
  if(!Array.isArray(rows)||rows.length>100||rows.some(r=>dataset.cases.find(c=>c.id===r.case_id)?.turns[r.index]?.text!==r.input||r.plan&&r.plan.session_id!=='eval-'+r.case_id))throw new Error('SYNTHETIC_REVIEW_SOURCE_REQUIRED');
  return rows.filter(r=>r.plan?.planner_kind==='llm').map(r=>({id:r.case_id,index:r.index,input:{student_input:{text:r.input},plan_proposal:r.plan,goal_review:r.goal_review}}));
}
if(import.meta.url===new URL(process.argv[1],'file:').href) {
  try {
    if(process.argv.length!==2)throw new Error('INVALID_REVIEW_ARGUMENT');
    const datasetBytes=await readFile('docs/eval-datasets/dynamic-goals-v1/cases.json'),reviewBytes=await readFile('.local/goal-eval/review.json');
    const inputs=authoredReviewInputs(JSON.parse(reviewBytes),JSON.parse(datasetBytes)),transport=[];
    const reviewer=new PlanningSemanticReviewer({transport:new MiniMaxJsonTransport({apiKey:process.env.MINIMAX_API_KEY,baseURL:process.env.MINIMAX_BASE_URL,model:process.env.MINIMAX_PLANNER_MODEL??'MiniMax-M3',observe:r=>transport.push(r)})});
    const cases=[];for(const row of inputs){const result=await reviewer.review(row.input);cases.push({id:row.id,index:row.index,planner:'llm',...result});console.error(row.id+': '+result.status);}
    console.log(JSON.stringify({version:'accepted-planner-semantic-review-v1',source:'authored_synthetic_goal_eval',dataset_sha256:createHash('sha256').update(datasetBytes).digest('hex'),private_review_sha256:createHash('sha256').update(reviewBytes).digest('hex'),limited_context:true,missing_context:['original conversation plan','actual teacher history','learner feedback','learning profile'],denominators:{accepted_llm_proposals:inputs.length,reviewed:cases.filter(c=>c.status==='reviewed').length,all_criteria_pass:cases.filter(c=>c.all_criteria_pass).length},cases,transport,review_mode:'auxiliary_model_review',human_calibrated:false,semantic_quality_accepted:false,real_voice_connected:false,contains_transcripts:false},null,2));
  }catch{console.error('PLANNING_REVIEW_FAILED');process.exitCode=1;}
}
