import { mkdir,writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { TopicStore } from '../apps/topic-manager/src/store.js';
import { TopicManager } from '../apps/topic-manager/src/manager.js';
import { TopicGenerator,SyntheticTopicGenerator } from '../packages/topic-packs/generator.js';
import { configuredPlanner,boundedProposal } from '../packages/agent-core/planner-port.js';
import { ConversationInitializer } from '../packages/agent-core/conversation-initializer.js';
import { topicFallback,validateTopicConversation,assessNeeds,topicModelInput } from '../packages/agent-core/topic-initialization.js';
import { TeachingSession } from '../packages/agent-core/teaching.js';
import { startMockBackend } from '../apps/hskai-mock/src/backend.js';
import { withPublishedTopics } from '../packages/topic-packs/port.js';
import { loadAdaptationInputs,loadAdaptationOracles,bindDesignCase,canonical } from '../apps/eval-runner/src/initial-adaptation.js';
import { digest } from '../packages/topic-packs/contract.js';
const live=process.argv.includes('--live'),publish=process.argv.includes('--publish');
if(process.argv.slice(2).some(a=>!['--live','--publish'].includes(a))||publish&&!live)throw new Error('INVALID_TOPIC_EVAL_ARGS');
let backend,manager,store;
const report={version:'topic-chain-eval-v1',synthetic_learner_data:true,real_model_calls:live,real_voice_tested:false,browser_audio_tested:false,semantic_quality_accepted:false,human_calibrated:false,generation:[],initialization:[],turns:[],design_cases:[],holdouts:[]};
const progress=(stage,counts)=>console.log(JSON.stringify({stage,...counts}));
try {
  const planner=live?configuredPlanner():null;if(live&&!planner?.transport)throw new Error('REGISTERED_TEXT_MODEL_REQUIRED');
  store=await new TopicStore(publish?process.env.TOPIC_MANAGER_STORE??'.local/topic-manager':'.local/topic-eval/'+randomUUID(),{exclusive:publish}).open();
  manager=new TopicManager({store,generator:live?new TopicGenerator({transport:planner.transport}):new SyntheticTopicGenerator(),budgetMs:live?60000:15000});
  // These briefs and holdouts are fixed before this run, not edited to fit output.
  for(const topic of [{id:'sports',title:'运动',brief:'日常运动、坚持习惯、运动经历、团队配合、比赛规则与公平。不同生活背景均可参与，不强制某个立场。'},{id:'music',title:'音乐',brief:'听音乐与生活习惯、演出经历、个人选择、作品感受与不同观点。不要预设音乐理论知识，不强制某种偏好。'}]){
    await store.define(topic);const start=performance.now(),job=await manager.enqueue(topic.id,randomUUID());await manager.work;const outcome=store.data.jobs[job.id];
    report.generation.push({topic_id:topic.id,status:outcome.status,error:outcome.error??null,elapsed_ms:Math.round(performance.now()-start),version:outcome.version??null});
    if(outcome.status==='succeeded')await store.publish(topic.id,outcome.version);progress('generation',report.generation.at(-1));
  }
  const topics={list:async()=>store.list(),read:async(id,{version}={})=>store.read(id,version)};backend=await startMockBackend({topicResources:topics});const port=withPublishedTopics(backend.planningPort,topics),initializer=new ConversationInitializer({port,planner});
  for(const topic of store.list().filter(t=>['sports','music'].includes(t.id)))for(const uid of ['poc-learner','mock-maya-hsk3','mock-leo-hsk5','mock-nina-hsk7']){
    const identity=backend.bridge.verify(await backend.pocPort.issue(uid),'session:create'),started=performance.now();
    const result=await initializer.prepare({mode:'topic',topic_id:topic.id},identity);report.initialization.push({topic_id:topic.id,learner_fixture:uid,pack_hash:result.resource.hash,plan_hash:result.plan.hash,planner:result.plan.planner_kind,degraded_reason:result.plan.degraded_reason,goal_id:result.plan.primary_goal_id,elapsed_ms:Math.round(performance.now()-started),attempts:result.plan.planner_attempts});
    const sessionId=randomUUID(),session=new TeachingSession({sessionId,mode:topic.id==='sports'?'sports':'topic',planning:{...result,plan:{...result.plan,session_id:sessionId}},planner,resourceVerifier:(r,o)=>port.checkResource(identity,r,o)}),event={version:1,event_id:randomUUID(),session_id:sessionId,turn_id:randomUUID(),seq:1,at_ms:0,type:'user.final',payload:{text:topic.id==='sports'?'我每周运动三次，但有时候很难坚持。':'我每周听几次音乐，想聊一次印象深的演出。'}};
    const turnStart=performance.now();session.accept(event);const turn=await session.planTurn(event);report.turns.push({topic_id:topic.id,learner_fixture:uid,planner:turn?.planner_kind??null,degraded_reason:turn?.degraded_reason??null,elapsed_ms:Math.round(performance.now()-turnStart),accepted:!!turn,within_budget:performance.now()-turnStart<=2000});session.planning.close();progress('learner',{completed:report.initialization.length,topic_id:topic.id,planner:result.plan.planner_kind,turn_planner:turn?.planner_kind});
  }
  const {cases,manifest}=await loadAdaptationInputs();await loadAdaptationOracles(manifest); // Isolated review material, never part of input below.
  for(const item of cases){const bound=bindDesignCase(item);if(bound.entry.mode!=='topic'){report.design_cases.push({case_id:item.case_id,status:'outside_topic_scope',materialized_hash:item.materialized_hash});continue;}
    const {entry,context,resource}=bound,input={entry,...topicModelInput(context,resource),coverage:context.coverage,history_page:context.history_page,snapshot_ref:context.snapshot_id,required_strategy:{language_support:context.learning_profile.language_support,correction:context.student_profile.conversation_preferences.correction,pace:context.student_profile.conversation_preferences.pace},resource,planning_needs:assessNeeds(context,resource)};
    const result=await boundedProposal({planner,method:'planTopicConversation',input,budgetMs:15000,validate:p=>validateTopicConversation(p,bound),fallback:()=>topicFallback(entry,context,resource)});
    report.design_cases.push({case_id:item.case_id,materialized_hash:item.materialized_hash,request_hash:digest(canonical(input)),status:'contract_accepted',planner:result.planner_kind,degraded_reason:result.degraded_reason,goal_id:result.proposal.primary_goal_id,semantic_status:'review_required',attempts:result.attempts});
    if(report.design_cases.length%7===0)progress('frozen_design_cases',{completed:report.design_cases.length,total:cases.length});
  }
  // New themes test generator generalization without changing the catalog/prompt.
  for(const topic of [{id:'cooking-holdout',title:'做饭',brief:'日常做饭的安排、一次经历、选择依据和不同家庭习惯。不要给饮食健康诊断。'},{id:'gardening-holdout',title:'园艺',brief:'照料植物的日常习惯、尝试经历、方法选择与因环境不同而调整的看法。不要假定专业知识。'}]){
    await store.define(topic);const job=await manager.enqueue(topic.id,randomUUID());await manager.work;const result=store.data.jobs[job.id];report.holdouts.push({topic_id:topic.id,generation_status:result.status,semantic_status:'review_required'});
  }
  report.counts={generated:report.generation.filter(g=>g.status==='succeeded').length,initial_total:report.initialization.length,initial_llm:report.initialization.filter(r=>r.planner==='llm').length,turn_total:report.turns.length,turn_llm:report.turns.filter(r=>r.planner==='llm').length,turn_within_budget:report.turns.filter(r=>r.within_budget).length,design_total:report.design_cases.length,design_topic_contracts:report.design_cases.filter(r=>r.status==='contract_accepted').length,design_topic_llm:report.design_cases.filter(r=>r.planner==='llm').length};
  await mkdir('.local/topic-eval',{recursive:true});await writeFile('.local/topic-eval/'+(live?'real':'synthetic')+'-report.json',JSON.stringify(report,null,2));progress('complete',report.counts);
  if(report.generation.some(g=>g.status!=='succeeded'))process.exitCode=1;
}catch(e){console.log(JSON.stringify({stage:'failed',code:/^[A-Z_]+$/.test(e.message)?e.message:'TOPIC_EVAL_FAILED'}));process.exitCode=1;}
finally{manager?.close();await backend?.close();await store?.close();}
