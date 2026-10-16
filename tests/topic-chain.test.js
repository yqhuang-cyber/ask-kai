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
import { ConversationInitializer,planProjection } from '../packages/agent-core/conversation-initializer.js';
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
test('every prepared topic has a goal: unknown evidence explores, stable skills apply in a new context',async t=>{
  const f=await fixture(t),i=await f.identity('poc-learner'),context=structuredClone(await f.port.read(i)),resource=await f.topics.read('sports'),entry={mode:'topic',topic_id:'sports'};
  const noFacts=structuredClone(context);noFacts.learning_profile.kp_states=[];noFacts.learning_profile.review_candidates=[];noFacts.coverage.learning_profile='unavailable';const p=topicFallback(entry,noFacts,resource);assert.ok(p.primary_goal_id);assert.equal(p.teaching_decision.needs[0].reason,'explore_current_expression');validateTopicConversation(p,{entry,context:noFacts,resource});
  assert.ok(resource.goals.find(g=>g.id===p.primary_goal_id).kp_ids.every(id=>resource.key_points.find(k=>k.id===id).prerequisites.length===0));
  const selected=topicFallback(entry,context,resource),bad=structuredClone(selected);bad.teaching_decision.needs[0].refs=['invented'];assert.throws(()=>validateTopicConversation(bad,{entry,context,resource}),/INVALID_NEED_REFERENCE/);
  const empty=structuredClone(context);empty.learning_profile.review_candidates=[];empty.learning_profile.kp_states=empty.learning_profile.kp_states.map(s=>({...s,evidence_state:'demonstrated_transfer'}));const application=topicFallback(entry,empty,resource);assert.ok(application.primary_goal_id);assert.equal(application.teaching_decision.needs[0].reason,'apply_in_new_context');assert.match(application.teaching_decision.task,/新情境/);validateTopicConversation(application,{entry,context:empty,resource});
  const nullGoal={...selected,primary_goal_id:null,key_points:[]};assert.throws(()=>validateTopicConversation(nullGoal,{entry,context,resource}),/TOPIC_GOAL_REQUIRED/);
});
test('null model proposals are repaired or fall back; prepared details and voice use the accepted task',async t=>{
  const f=await fixture(t),i=await f.identity('poc-learner'),entry={mode:'topic',topic_id:'music'};let calls=0;
  const planner={planTopicConversation:async input=>{calls++;const p=topicFallback(input.entry,{...(await f.port.read(i))},input.resource);return {...p,primary_goal_id:null,key_points:[]};}};
  const result=await new ConversationInitializer({port:f.port,planner}).prepare(entry,i);assert.equal(calls,2);assert.equal(result.plan.planner_kind,'rule');assert.equal(result.plan.degraded_reason,'planner_validation_failed');
  const details=planProjection(result.plan,result.resource).goal_details;assert.ok(details.key_points.length);assert.ok(details.expression_task);assert.equal(details.goal_id,result.plan.primary_goal_id);assert.equal(details.expression_task,result.plan.goal_instance.task);assert.deepEqual(details.key_points.map(k=>k.id),result.plan.key_points);
  const task='介绍一场你听过的演出，说明多久听一次这类音乐。';
  const repairs=[],proposedPath=new ConversationInitializer({port:f.port,planner:{planTopicConversation:async(input,options)=>{repairs.push(options.repair);const p=topicFallback(input.entry,result.context,input.resource);return options.repair?{...p,teaching_decision:{...p.teaching_decision,task}}:{...p,primary_goal_id:null,key_points:[]};}}});
  const accepted=await proposedPath.prepare(entry,i);assert.deepEqual(repairs,[false,true]);assert.equal(accepted.plan.planner_kind,'llm');assert.equal(accepted.plan.degraded_reason,null);assert.equal(planProjection(accepted.plan,accepted.resource).goal_details.expression_task,task);
  const session=new TeachingSession({sessionId:'session',mode:'topic',planning:{...accepted,plan:{...accepted.plan,session_id:'session'}}});assert.ok(session.instructions().includes(task));assert.ok(session.instructions().includes(details.key_points[0].label));
  session.planning.commitGoal('paused');assert.equal(session.view().goal_details.expression_task,task);assert.equal(session.view().goal_details.status,'paused');
  session.planning.commitGoal('active');assert.equal(session.view().goal_details.expression_task,task);
  const replacement=result.resource.goals.find(g=>g.id==='simple-reasons');session.planning.commitGoal('active',{goal:replacement});assert.equal(session.view().goal_details.expression_task,replacement.start_tip);assert.deepEqual(session.view().goal_details.key_points.map(k=>k.id),replacement.kp_ids);session.planning.close();
});
test('unavailable or declined topic goals fail preparation honestly; free still needs no pack or initial goal',async t=>{
  const f=await fixture(t),i=await f.identity('poc-learner'),entry={mode:'topic',topic_id:'sports'},initializer=new ConversationInitializer({port:f.port}),preparations=new Preparations({initializer});t.after(()=>preparations.close());
  const requested={...entry,opening_request:'只想聊天，不想练习。'},p=preparations.create(i,requested);await preparations.get(i,p.preparation_id).done;const failed=preparations.view(i,p.preparation_id);assert.equal(failed.status,'failed');assert.equal(failed.error,'TOPIC_PRACTICE_DECLINED');assert.equal(failed.view,undefined);await assert.rejects(preparations.consume(i,p.preparation_id,requested),/PREPARATION_NOT_READY/);
  const context=structuredClone(await f.port.read(i)),resource=await f.topics.read('sports');context.learning_history.push({...context.learning_history[0],declined_goal_ids:resource.goals.map(g=>g.id)});assert.throws(()=>topicFallback(entry,context,resource),/TOPIC_NO_ELIGIBLE_GOAL/);
  let modelCalls=0;const blocked=new ConversationInitializer({port:{read:async()=>context,getResource:async()=>resource},planner:{planTopicConversation(){modelCalls++;}}});await assert.rejects(blocked.prepare(entry,i),/TOPIC_NO_ELIGIBLE_GOAL/);assert.equal(modelCalls,0);
  const free=new ConversationInitializer({port:{read:(...args)=>f.port.read(...args),getResource:()=>{throw new Error('FREE_MUST_NOT_READ_PACK');}}});const result=await free.prepare({mode:'free'},i);assert.equal(result.plan.primary_goal,null);assert.deepEqual(result.plan.key_points,[]);assert.equal(planProjection(result.plan,null).goal_details,null);
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
  assert.equal(session.view().topic_scope.status,'unavailable');assert.ok(!session.instructions().includes('"brief":'));
  const next={...event,event_id:'next-input',turn_id:'next-turn',payload:{text:'换个话题。'}};session.accept(next);assert.equal(session.view().topic_scope.status,'unavailable');await session.planTurn(next);assert.equal(session.view().topic_scope.status,'unavailable');assert.equal(calls,0);
});
test('gateway forwards persistent theme, local choices and pending switch state without a new resource',async t=>{
  const f=await fixture(t),gateway=await setup(t,{...f.backend,planningPort:f.port,planningMode:'next_turn_advisory'});
  const launch=await fetch(gateway.origin+'/api/poc/launch',{method:'POST',headers:{Origin:gateway.origin,'Content-Type':'application/json'},body:'{}'});
  const response=await fetch(gateway.origin+'/api/sessions',{method:'POST',headers:{Origin:gateway.origin,Cookie:launch.headers.get('set-cookie').split(';')[0],'Content-Type':'application/json'},body:JSON.stringify({mode:'topic',topic_id:'sports'})});assert.equal(response.status,201);
  const ticket=await response.json(),{ws,provider,packets}=await gateway.open(ticket);
  provider.updateContext=value=>{provider.contexts.push(value);provider.control('context.updated',{version:value.version});};provider.emit('session.ready');
  provider.emit('user.final',{text:'我想聊跑步。'},{turn_id:'local'});await until(()=>packets.some(p=>p.type==='teaching.state'&&p.decision?.turn_id==='local'&&p.topic_scope?.status==='active'));assert.ok(packets.filter(p=>p.type==='teaching.state').at(-1).goal_details);
  provider.emit('user.final',{text:'换个话题，我想聊音乐。'},{turn_id:'switch'});await until(()=>packets.some(p=>p.type==='teaching.state'&&p.decision?.turn_id==='switch'&&p.topic_scope?.status==='change_requested'));
  const view=packets.filter(p=>p.type==='teaching.state').at(-1);assert.equal(view.topic_scope.topic_id,'sports');assert.equal(view.topic_scope.title,'运动');assert.equal(view.goal_details.status,'paused');assert.equal(view.cards.length,0);assert.equal(f.calls(),2);assert.ok(provider.input.instructions.includes('主题连续性规则'));assert.ok(provider.contexts.some(c=>c.instructions.includes('"status":"change_requested"')));
  ws.send(JSON.stringify({type:'session.end'}));await once(ws,'close');
});
