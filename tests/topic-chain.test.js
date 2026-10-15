import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TopicStore } from '../apps/topic-manager/src/store.js';
import { TopicManager } from '../apps/topic-manager/src/manager.js';
import { createTopicServer } from '../apps/topic-manager/src/server.js';
import { SyntheticTopicGenerator } from '../packages/topic-packs/generator.js';
import { PublishedTopicClient,withPublishedTopics } from '../packages/topic-packs/port.js';
import { startMockBackend } from '../apps/hskai-mock/src/backend.js';
import { ConversationInitializer } from '../packages/agent-core/conversation-initializer.js';
import { Preparations } from '../apps/realtime-gateway/src/preparations.js';
import { TeachingSession } from '../packages/agent-core/teaching.js';
import { topicFallback,validateTopicConversation } from '../packages/agent-core/topic-initialization.js';
import { setup,until } from './helpers/realtime.js';
import { projectSummary } from '../apps/realtime-gateway/public/summary-cards.js';
async function fixture(t) {
  const dir=await mkdtemp(join(tmpdir(),'kai-chain-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const store=await new TopicStore(dir).open(),generator=new SyntheticTopicGenerator();let calls=0;const original=generator.generate.bind(generator);generator.generate=async(...args)=>{calls++;return original(...args);};
  const manager=new TopicManager({store,generator}),adminToken='admin-'.repeat(8),readToken='reader-'.repeat(8),server=createTopicServer({manager,adminToken,readToken});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(r=>{server.close(r);server.closeAllConnections();}));const origin=`http://127.0.0.1:${server.address().port}`;
  const topics=new PublishedTopicClient({endpoint:origin,token:readToken});
  for(const [id,title] of [['sports','运动'],['music','音乐']]){await store.define({id,title,brief:`${title}与生活`});const job=await manager.enqueue(id,id);await manager.work;await store.publish(id,store.data.jobs[job.id].version);}
  const backend=await startMockBackend({topicResources:topics});t.after(()=>backend.close());const port=withPublishedTopics(backend.planningPort,topics),identity=async uid=>backend.bridge.verify(await backend.pocPort.issue(uid),'session:create');
  return {store,manager,topics,origin,adminToken,readToken,backend,port,identity,calls:()=>calls};
}
test('read/admin permissions and publication are separate; runtime list never generates',async t=>{
  const f=await fixture(t);assert.equal((await fetch(f.origin+'/api/published')).status,401);assert.equal((await fetch(f.origin+'/api/admin',{headers:{Authorization:'Bearer '+f.readToken}})).status,401);
  assert.equal((await fetch(f.origin+'/api/admin/generate',{method:'POST',headers:{Authorization:'Bearer '+f.adminToken,'Content-Type':'application/json'},body:'{}'})).status,403);
  assert.equal((await f.topics.list()).length,2);const pack=await f.topics.read('sports');const cached=await fetch(f.origin+'/api/published/sports',{headers:{Authorization:'Bearer '+f.readToken,'If-None-Match':`"${pack.hash}"`}});assert.equal(cached.status,304);
  await f.store.revoke('sports',pack.version);await assert.rejects(f.topics.read('sports'));await assert.rejects(f.topics.read('unknown'));assert.equal(f.calls(),2);
});
test('latest four learner snapshots choose sourced needs in the same fixed pack; grade/order/identity do not rank',async t=>{
  const f=await fixture(t),initializer=new ConversationInitializer({port:f.port});
  for(const [uid,expected] of [['poc-learner','frequency-expression'],['mock-maya-hsk3','narrative-organization'],['mock-leo-hsk5','supporting-opinions'],['mock-nina-hsk7','qualified-claims']]){
    const i=await f.identity(uid),result=await initializer.prepare({mode:'topic',topic_id:'sports'},i);assert.equal(result.plan.primary_goal_id,expected);assert.equal(result.plan.schema_version,'conversation-plan-v2');assert.equal(result.plan.planner_kind,'rule');
    const context=structuredClone(result.context),resource=structuredClone(result.resource);context.learning_profile.course_level='HSK9';context.student_profile.preferred_name='another';resource.goals.reverse();const changed=topicFallback({mode:'topic',topic_id:'sports'},context,resource);assert.equal(changed.primary_goal_id,expected);
  }assert.equal(f.calls(),2);
});
test('missing needs and mastered-only resources allow explained null; fabricated refs and routine basic reteaching fail',async t=>{
  const f=await fixture(t),i=await f.identity('poc-learner'),context=structuredClone(await f.port.read(i)),resource=await f.topics.read('sports'),entry={mode:'topic',topic_id:'sports'};
  const noFacts=structuredClone(context);noFacts.learning_profile.kp_states=[];noFacts.learning_profile.review_candidates=[];noFacts.coverage.learning_profile='unavailable';const p=topicFallback(entry,noFacts,resource);assert.equal(p.primary_goal_id,null);assert.equal(p.teaching_decision.no_goal_reason,'insufficient_evidence');validateTopicConversation(p,{entry,context:noFacts,resource});
  const selected=topicFallback(entry,context,resource),bad=structuredClone(selected);bad.teaching_decision.needs[0].refs=['invented'];assert.throws(()=>validateTopicConversation(bad,{entry,context,resource}),/INVALID_NEED_REFERENCE/);
  const empty=structuredClone(context);empty.learning_profile.review_candidates=[];empty.learning_profile.kp_states=empty.learning_profile.kp_states.map(s=>({...s,evidence_state:'demonstrated_transfer'}));assert.equal(topicFallback(entry,empty,resource).primary_goal_id,null);
});
test('preparations pin a published version through a new publish; revocation blocks consume',async t=>{
  const f=await fixture(t),i=await f.identity('poc-learner'),preparations=new Preparations({initializer:new ConversationInitializer({port:f.port})}),entry={mode:'topic',topic_id:'sports'},p=preparations.create(i,entry);await preparations.get(i,p.preparation_id).done;const old=preparations.get(i,p.preparation_id).resource.version;
  const j=await f.manager.enqueue('sports','new-pack');await f.manager.work;await f.store.publish('sports',f.store.data.jobs[j.id].version);assert.equal((await preparations.consume(i,p.preparation_id,entry)).resource.version,old);
  const next=preparations.create(i,entry);await preparations.get(i,next.preparation_id).done;await f.store.revoke('sports',f.store.read('sports').version);await assert.rejects(preparations.consume(i,next.preparation_id,entry));preparations.close();
});
test('second topic shares gateway/page/voice plan, generic goal controls and truthful unassessed summary',async t=>{
  const f=await fixture(t),gateway=await setup(t,{...f.backend,planningPort:f.port,planningMode:'next_turn_advisory'});
  const call=async(path,data)=>{const launch=await fetch(gateway.origin+'/api/poc/launch',{method:'POST',headers:{Origin:gateway.origin,'Content-Type':'application/json'},body:JSON.stringify({uid:'mock-leo-hsk5'})});return fetch(gateway.origin+path,{method:data?'POST':'GET',headers:{Origin:gateway.origin,Cookie:launch.headers.get('set-cookie').split(';')[0],'Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});};
  assert.equal((await(await call('/api/topics')).json()).topics.length,2);
  const response=await call('/api/sessions',{mode:'topic',topic_id:'music'});assert.equal(response.status,201);const ticket=await response.json(),{ws,provider,packets}=await gateway.open(ticket);assert.match(provider.input.instructions,/音乐/);assert.ok(!provider.input.instructions.includes('帮助 HSK1 初学者'));
  provider.emit('session.ready');provider.emit('user.final',{text:'我想练习选择关键信息并组织复杂经历。'},{turn_id:'select'});await until(()=>packets.some(p=>p.type==='teaching.state'&&p.goal==='选择关键信息并组织复杂经历'));
  provider.emit('user.final',{text:'不想练习了，只聊音乐。'},{turn_id:'decline'});await until(()=>packets.some(p=>p.type==='teaching.state'&&p.decision?.turn_id==='decline'));assert.deepEqual(packets.filter(p=>p.type==='teaching.state').at(-1).cards,[]);
  ws.send(JSON.stringify({type:'session.end',save_learning:true}));await once(ws,'close');const packet=packets.find(p=>p.type==='teaching.summary'),view=projectSummary(packet,{sessionId:ticket.session_id,mode:'topic'});assert.ok(view);assert.equal(packets.find(p=>p.type==='learning.record.receipt')?.status,'accepted');assert.equal(packet.summary.assessment.mastery_assessed,false);assert.equal(packet.summary.dynamic_observations.length,0);assert.equal(f.calls(),2);
});
test('observed topic revocation retires the goal before new model planning',async t=>{
  const f=await fixture(t),i=await f.identity('poc-learner'),result=await new ConversationInitializer({port:f.port}).prepare({mode:'topic',topic_id:'sports'},i);let calls=0;
  const session=new TeachingSession({sessionId:'session',mode:'sports',planning:{...result,plan:{...result.plan,session_id:'session'}},planner:{planTurn(){calls++;}},resourceVerifier:(r,o)=>f.port.checkResource(i,r,o)});
  await f.store.revoke('sports',result.resource.version);const event={version:1,event_id:'input',session_id:'session',seq:1,at_ms:1,type:'user.final',turn_id:'turn',payload:{text:'我每周跑三次。'}};session.accept(event);await session.planTurn(event);assert.equal(session.planning.plan.primary_goal,null);assert.equal(calls,0);assert.equal(session.planning.accepted.planner_kind,'rule');
});
