import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compilePack } from '../packages/topic-packs/contract.js';
import { SyntheticTopicGenerator } from '../packages/topic-packs/generator.js';
import { configuredTopicGenerator } from '../packages/topic-packs/config.js';
import { topicFallback,validateTopicConversation,proposeTopic } from '../packages/agent-core/topic-initialization.js';
import { loadAdaptationInputs,bindDesignCase } from '../apps/eval-runner/src/initial-adaptation.js';
test('current no-teaching choice cannot be replaced with a different practice goal by a model',async()=>{
  const {cases}=await loadAdaptationInputs(),base=bindDesignCase(cases.find(c=>c.case_id==='IP-A03'));
  const proposal=topicFallback(base.entry,base.context,base.resource);assert.ok(proposal.primary_goal_id);
  const entry={...base.entry,opening_request:'只想聊天，不想练习。'};assert.throws(()=>validateTopicConversation(proposal,{...base,entry}),/INITIAL_CHOICE_CONFLICT/);const safe=topicFallback(entry,base.context,base.resource);assert.equal(safe.primary_goal_id,null);validateTopicConversation(safe,{...base,entry});
});
test('explicit restore removes only corresponding decline and still requires hard prerequisites',async()=>{
  const {cases}=await loadAdaptationInputs(),bound=bindDesignCase(cases.find(c=>c.case_id==='IP-C16')),p=topicFallback(bound.entry,bound.context,bound.resource);assert.equal(p.primary_goal_id,'qualify-claim');validateTopicConversation(p,bound);
  const missing=structuredClone(bound);missing.context.learning_profile.kp_states=[];assert.equal(topicFallback(missing.entry,missing.context,missing.resource).primary_goal_id,null);
});
test('future registered text transports use the same generator contract; unknown models/providers never guess',async()=>{
  const synthetic=new SyntheticTopicGenerator(),topic={id:'music',title:'音乐',brief:'音乐和生活'},draft=await synthetic.generate(topic);let calls=0;
  const generator=configuredTopicGenerator({ASK_KAI_TOPIC_GENERATOR_PROVIDER:'future',ASK_KAI_TOPIC_REVIEW_PROVIDER:'future'},{transports:{future:()=>({provider:'future',model:'reviewed-profile',completeJSON:async({kind})=>{calls++;return kind==='topic_review'?{acceptable:true}:draft;}})}});
  const result=await generator.generate(topic),review=await generator.review(topic,result),pack=compilePack({topic,draft:result,review,version:'future-v1',provenance:generator.provenance(topic)});assert.equal(pack.source,'llm_generated');assert.equal(pack.review.independent,false);assert.equal(calls,2);
  assert.throws(()=>configuredTopicGenerator({ASK_KAI_TOPIC_GENERATOR_PROVIDER:'unknown'}),/NOT_REGISTERED/);
});
test('topic decision adapter compiles host preference, KP and hypothesis fields from a model-neutral draft',async()=>{
  const {cases}=await loadAdaptationInputs(),bound=bindDesignCase(cases[0]),expected=topicFallback(bound.entry,bound.context,bound.resource),decision=expected.teaching_decision;
  const input={...bound,student_profile:bound.context.student_profile,learning_profile:bound.context.learning_profile,learning_history:bound.context.learning_history,snapshot_ref:bound.context.snapshot_id,required_strategy:{language_support:'auto',correction:'gentle',pace:'slow'}};
  let messages;
  const proposal=await proposeTopic({completeJSON:async args=>{messages=args.messages;return {primary_goal_id:expected.primary_goal_id,content_focus:expected.content_focus,opening_options:[],support_level:'model',needs:decision.needs,plan_kind:decision.plan_kind,no_goal_reason:decision.no_goal_reason,task:decision.task,delivery_profile:decision.delivery_profile,selection_basis:expected.selection_basis};}},input);
  validateTopicConversation(proposal,bound);assert.deepEqual(proposal.key_points,['likes-expression']);assert.equal(proposal.strategy.pace,'slow');assert.ok(!JSON.stringify(messages).includes('illustrative_skill_focus'));
});
