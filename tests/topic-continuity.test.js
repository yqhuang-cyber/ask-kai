import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConversationInitializer } from '../packages/agent-core/conversation-initializer.js';
import { TeachingSession } from '../packages/agent-core/teaching.js';
import { conservativeTurn } from '../packages/agent-core/planning-state.js';
import { DraftPlanner,TOPIC_TURN_SCHEMA } from '../packages/agent-core/planner-draft.js';
import { FullContractPlanner } from '../packages/agent-core/planner-full-contract.js';
import { topicDecisionShape } from '../packages/agent-core/topic-continuity.js';
import { SyntheticTopicGenerator } from '../packages/topic-packs/generator.js';
import { compilePack } from '../packages/topic-packs/contract.js';
import { learnerFixture } from '../apps/hskai-mock/src/planning-fixtures.js';
import { MOCK_IDENTITY } from '../apps/hskai-mock/src/server.js';

async function fixture({planner,topic_id='sports',title='运动'}={}) {
  const identity={...MOCK_IDENTITY,authorization_until:Date.now()+600000,scopes:['session:create','context:read','curriculum:read']};
  const context=learnerFixture(identity),topic={id:topic_id,title,brief:`${title}与生活`},generator=new SyntheticTopicGenerator();
  const resource=compilePack({topic,draft:await generator.generate(topic),version:'synthetic-v1',provenance:generator.provenance(topic),review:await generator.review()});
  const prepared=await new ConversationInitializer({port:{read:async()=>context,getResource:async()=>resource}}).prepare({mode:'topic',topic_id},identity);
  const session=new TeachingSession({sessionId:'synthetic-session',mode:'topic',planning:{...prepared,plan:{...prepared.plan,session_id:'synthetic-session'}},planner});let n=0;
  const event=text=>({version:1,event_id:`synthetic-input-${++n}`,session_id:session.sessionId,turn_id:`turn-${n}`,seq:n,at_ms:n,type:'user.final',payload:{text}});
  const turn=async text=>{const e=event(text);session.accept(e);return session.planTurn(e);};
  return {session,context,resource,event,turn};
}
const proposal=(input,relation,extra={})=>({...conservativeTurn(input),topic_decision:{...topicDecisionShape(input.topic_scope,input.turn.source_event_id),relation,...extra}});

test('topic-local choices and related content keep the goal through rule fallback, without a word blacklist',async()=>{
  const f=await fixture(),id=f.session.planning.plan.primary_goal_id;
  for(const text of ['我想聊跑步。','跑步的时候我喜欢听音乐。','Can we talk about running?']){
    const p=await f.turn(text);assert.ok(p);assert.equal(f.session.planning.plan.goal_status,'active');assert.equal(f.session.planning.plan.primary_goal_id,id);assert.equal(f.session.view().topic_scope.status,'active');assert.equal(p.planner_kind,'rule');assert.match(p.reply_directive.task,/保持当前所选主题/);assert.match(f.session.instructions(),/主题连续性规则/);
  }f.session.planning.close();
});
test('pausing or retiring a goal keeps the selected theme in voice context and page state',async()=>{
  const f=await fixture();await f.turn('不想练习了。');assert.equal(f.session.planning.plan.goal_status,'paused');assert.equal(f.session.view().topic_scope.title,'运动');assert.equal(f.session.view().topic_scope.status,'active');assert.ok(f.session.instructions().includes('运动与生活'));assert.ok(!f.session.instructions().includes('"goal_details":'));
  await f.turn('取消这个目标');assert.equal(f.session.planning.plan.primary_goal,null);assert.equal(f.session.view().topic_scope.title,'运动');f.session.planning.close();
});
test('profile refresh cannot overwrite either selected theme or its content focus',async()=>{
  for(const topic of [{topic_id:'sports',title:'运动'},{topic_id:'music',title:'音乐'}]){
    const f=await fixture(topic),focus=f.session.planning.plan.content_focus,task=f.session.view().goal_details.expression_task;
    const changed=structuredClone(f.context);changed.revision++;changed.student_profile.interests=[{...changed.student_profile.interests[0],topic_id:'unrelated',label:'其他兴趣'}];
    f.session.updateLearnerContext(changed);assert.equal(f.session.planning.context.student_profile.interests[0].label,'其他兴趣');assert.equal(f.session.planning.plan.content_focus,focus);assert.equal(f.session.view().topic_scope.topic_id,topic.topic_id);assert.equal(f.session.view().goal_details.expression_task,task);f.session.planning.close();
  }
});
test('model relation uses the actual topic and current input; unrelated content does not release the theme',async()=>{
  let seen;
  const f=await fixture({planner:{planTurn:async input=>{seen=input;return proposal(input,'related_context');}}});
  const p=await f.turn('跑步时听音乐可以让我坚持更久。');assert.equal(p.planner_kind,'llm');assert.equal(p.schema_version,'turn-plan-v2');assert.equal(seen.topic_scope.topic_id,'sports');assert.equal(f.session.view().topic_scope.status,'active');
  f.session.planning.planner={planTurn:async input=>proposal(input,'off_topic')};await f.turn('我喜欢音乐。');assert.equal(f.session.view().topic_scope.topic_id,'sports');assert.equal(f.session.view().topic_scope.status,'active');assert.equal(f.session.planning.plan.goal_status,'active');f.session.planning.close();
});
test('wrong topic IDs, fabricated requests and teacher quotes are rejected and never become switches',async()=>{
  for(const [text,change] of [
    ['我每周跑三次。',input=>proposal(input,'within_topic',{topic_id:'music'})],
    ['我每周跑三次。',input=>proposal(input,'change_requested',{request_quote:'我想聊音乐',requested_focus:'音乐'})],
    ['老师说“我想聊音乐”。',input=>proposal(input,'change_requested',{request_quote:'我想聊音乐',requested_focus:'音乐'})],
    ['老师说我想聊音乐。',input=>proposal(input,'change_requested',{request_quote:'我想聊音乐',requested_focus:'音乐'})]
  ]){
    const f=await fixture({planner:{planTurn:async input=>change(input)}});const p=await f.turn(text);assert.equal(p.planner_kind,'rule');assert.equal(p.degraded_reason,'planner_validation_failed');assert.equal(f.session.view().topic_scope.status,'active');assert.equal(f.session.planning.plan.goal_status,'active');f.session.planning.close();
  }
});
test('reported or negated switch controls do not pause practice in the immediate path',async()=>{
  const f=await fixture();for(const text of ['妈妈说她想换个话题。',"I don't want to change the topic."]){await f.turn(text);assert.equal(f.session.view().topic_scope.status,'active');assert.equal(f.session.planning.plan.goal_status,'active');}f.session.planning.close();
});
test('semantic change requests need sourced quotes, pause old teaching and remain pending new preparation',async()=>{
  const f=await fixture({planner:{planTurn:async input=>proposal(input,'change_requested',{request_quote:input.turn.text,requested_focus:'music'})}});
  const p=await f.turn('Could we discuss music instead?');assert.equal(p.planner_kind,'llm');assert.equal(f.session.planning.plan.goal_status,'paused');assert.deepEqual(f.session.view().topic_scope,{topic_id:'sports',title:'运动',status:'change_requested',requested_focus:'music'});assert.equal(f.session.planning.resource.id,'sports');assert.ok(f.session.instructions().includes('不要假装已经切换资源'));f.session.planning.close();
});
test('an explicit switch works offline; staying clears the request without reviving paused practice',async()=>{
  const f=await fixture();await f.turn('换个话题，我想聊音乐。');assert.equal(f.session.view().topic_scope.status,'change_requested');assert.equal(f.session.planning.plan.goal_status,'paused');assert.match(f.session.planning.accepted.reply_directive.task,/不声称已切换/);
  await f.turn('不换话题，还是聊运动。');assert.equal(f.session.view().topic_scope.status,'active');assert.equal(f.session.planning.plan.goal_status,'paused');f.session.planning.close();
});
test('explicitly selecting an authorized goal clears a pending topic request and resumes only that practice',async()=>{
  const f=await fixture();await f.turn('换个话题。');assert.equal(f.session.view().topic_scope.status,'change_requested');
  await f.turn('我想练习喜好表达。');assert.equal(f.session.view().topic_scope.status,'active');assert.equal(f.session.planning.plan.goal_status,'active');assert.equal(f.session.planning.plan.primary_goal.kp_ids[0],'likes-expression');f.session.planning.close();
});
test('a late model request cannot overwrite a newer input or topic decision',async()=>{
  let release;const f=await fixture({planner:{planTurn:input=>input.turn.text==='我想聊音乐。'?new Promise(resolve=>{release=()=>resolve(proposal(input,'change_requested',{request_quote:'我想聊音乐。',requested_focus:'音乐'}));}):proposal(input,'within_topic')}});
  const old=f.event('我想聊音乐。');f.session.accept(old);const pending=f.session.planTurn(old);assert.ok(release);
  await f.turn('我想聊跑步。');release();assert.equal(await pending,null);assert.equal(f.session.view().topic_scope.status,'active');assert.equal(f.session.planning.plan.goal_status,'active');f.session.planning.close();
});
test('both text adapters carry the topic contract in their existing turn call',async()=>{
  for(const kind of ['full','draft']){
    let sent;const f=await fixture();let snapshot;
    f.session.planning.planner={planTurn:async input=>{snapshot=input;return proposal(input,'within_topic');}};await f.turn('我每周跑三次。');
    const full=proposal(snapshot,'related_context');
    const transport={provider:'synthetic',model:'fixture',completeJSON:async args=>{sent=args;if(kind==='full')return full;const {reply_directive,prior_outcome,expected_observation,...draft}=full;return {...draft,reply_task:reply_directive.task,support_level:reply_directive.support_level,new_points:reply_directive.new_points,expected_observation_kind:expected_observation.kind};}};
    const planner=kind==='full'?new FullContractPlanner({transport}):new DraftPlanner({transport});const result=await planner.planTurn(snapshot);assert.equal(result.topic_decision.relation,'related_context');assert.ok(sent.messages[0].content.includes('主题连续性规则'));if(kind==='draft')assert.equal(sent.schema,TOPIC_TURN_SCHEMA);assert.equal(sent.kind,'turn');f.session.planning.close();
  }
});
