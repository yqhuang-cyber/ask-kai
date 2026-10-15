import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadAdaptationInputs,loadAdaptationOracles,bindDesignCase } from '../apps/eval-runner/src/initial-adaptation.js';
import { topicFallback,validateTopicConversation } from '../packages/agent-core/topic-initialization.js';
test('all original 28 cases materialize with frozen hashes; oracle and identity labels stay out of model input',async()=>{
  const {cases,manifest}=await loadAdaptationInputs(),oracles=await loadAdaptationOracles(manifest);assert.equal(cases.length,28);assert.equal(oracles.length,28);
  for(const item of cases){assert.ok(item.materialized_hash);assert.ok(!JSON.stringify(item.logical_input).includes('illustrative_skill_focus'));assert.ok(!Object.hasOwn(item.logical_input,'binding_variant'));const bound=bindDesignCase(item);assert.ok(bound.resource.goals.every(g=>item.catalog.goals.some(c=>c.id===g.id)));}
});
test('frozen topic cases exercise decision contracts, with semantic outcomes left for separate review',async()=>{
  // Keep original inputs/oracles intact. Current mandatory-goal policy rejects
  // these two original no-teaching/unavailable cases before preparing a session.
  const failed={'IP-C14':'TOPIC_PRACTICE_DECLINED','IP-C15':'TOPIC_NO_ELIGIBLE_GOAL'};
  const {cases}=await loadAdaptationInputs();for(const item of cases){const bound=bindDesignCase(item);if(bound.entry.mode!=='topic')continue;if(failed[item.case_id]){assert.throws(()=>topicFallback(bound.entry,bound.context,bound.resource),new RegExp(failed[item.case_id]));continue;}const p=topicFallback(bound.entry,bound.context,bound.resource);validateTopicConversation(p,bound);assert.ok(p.primary_goal_id);assert.equal(p.teaching_decision.hypothesis_only,true);}
});
