import { readFile,mkdir,writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { validatePack } from '../packages/topic-packs/contract.js';
import { withPublishedTopics } from '../packages/topic-packs/port.js';
import { startMockBackend } from '../apps/hskai-mock/src/backend.js';
import { configuredPlanner } from '../packages/agent-core/planner-port.js';
import { ConversationInitializer } from '../packages/agent-core/conversation-initializer.js';
import { TeachingSession } from '../packages/agent-core/teaching.js';
const planner=configuredPlanner();if(!planner)throw new Error('REGISTERED_TEXT_MODEL_REQUIRED');
const store=JSON.parse(await readFile((process.env.TOPIC_MANAGER_STORE??'.local/topic-manager')+'/store.json','utf8'));
const topics={async read(id,{version}={}){const selected=version??store.active[id],v=store.versions[selected];if(v?.status!=='published'||v.pack.id!==id)throw new Error('TOPIC_UNAVAILABLE');return validatePack(v.pack);}};
const report={scope:'current_published_topic_planning',source:'synthetic_mock_learners',real_model_called:true,provider_connected:false,browser_audio_tested:false,semantic_quality_accepted:false,initialization:[],turns:[]};
const backend=await startMockBackend({topicResources:topics});
try {
  const port=withPublishedTopics(backend.planningPort,topics),initializer=new ConversationInitializer({port,planner});
  for(const topic_id of ['sports','music'])if(store.active[topic_id])for(const uid of ['poc-learner','mock-maya-hsk3','mock-leo-hsk5','mock-nina-hsk7']){
    const identity=backend.bridge.verify(await backend.pocPort.issue(uid),'session:create'),start=performance.now(),result=await initializer.prepare({mode:'topic',topic_id},identity),elapsed_ms=Math.round(performance.now()-start);
    report.initialization.push({topic_id,learner_fixture:uid,pack_hash:result.resource.hash,planner:result.plan.planner_kind,degraded_reason:result.plan.degraded_reason,goal_id:result.plan.primary_goal_id,elapsed_ms});
    const sessionId=randomUUID(),session=new TeachingSession({sessionId,mode:topic_id==='sports'?'sports':'topic',planning:{...result,plan:{...result.plan,session_id:sessionId}},planner,resourceVerifier:(r,o)=>port.checkResource(identity,r,o)}),event={version:1,event_id:randomUUID(),session_id:sessionId,seq:1,at_ms:0,type:'user.final',turn_id:randomUUID(),payload:{text:topic_id==='sports'?'我每周运动三次，有时很难坚持。':'我经常听音乐，最近听了一场有趣的演出。'}};
    const turnStart=performance.now();session.accept(event);const turn=await session.planTurn(event),turnElapsed=Math.round(performance.now()-turnStart);report.turns.push({topic_id,learner_fixture:uid,planner:turn?.planner_kind??null,degraded_reason:turn?.degraded_reason??null,elapsed_ms:turnElapsed,within_budget:turnElapsed<=2000});session.planning.close();
    console.log(JSON.stringify({stage:'planning',completed:report.initialization.length,topic_id,initial_planner:result.plan.planner_kind,turn_planner:turn?.planner_kind,turn_elapsed_ms:turnElapsed}));
  }
  report.counts={initial_total:report.initialization.length,initial_llm:report.initialization.filter(r=>r.planner==='llm').length,turn_total:report.turns.length,turn_llm:report.turns.filter(r=>r.planner==='llm').length,turn_within_budget:report.turns.filter(r=>r.within_budget).length};
  await mkdir('.local/topic-eval',{recursive:true});await writeFile('.local/topic-eval/live-planning-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({stage:'complete',...report.counts}));
}finally{await backend.close();}
