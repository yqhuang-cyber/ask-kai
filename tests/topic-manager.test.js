import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TopicStore } from '../apps/topic-manager/src/store.js';
import { TopicManager } from '../apps/topic-manager/src/manager.js';
import { SyntheticTopicGenerator } from '../packages/topic-packs/generator.js';
import { validatePack,compilePack } from '../packages/topic-packs/contract.js';
async function setup(t,generator=new SyntheticTopicGenerator(),options={}){const dir=await mkdtemp(join(tmpdir(),'kai-topics-'));t.after(()=>rm(dir,{recursive:true,force:true}));const store=await new TopicStore(dir).open(),manager=new TopicManager({store,generator,...options});t.after(()=>manager.close());await store.define({id:'sports',title:'运动',brief:'运动与生活'});return {dir,store,manager};}
test('generated packs require explicit publish, survive restart, pin old published versions and revoke',async t=>{
  const {dir,store,manager}=await setup(t);const j=await manager.enqueue('sports','request-1');await manager.work;const job=store.data.jobs[j.id];assert.equal(job.status,'succeeded');assert.deepEqual(store.list(),[]);assert.throws(()=>store.read('sports'));await store.publish('sports',job.version);assert.equal(store.read('sports').source,'synthetic');assert.equal((await manager.enqueue('sports','request-1')).id,j.id);
  await manager.enqueue('sports','request-2');await manager.work;const second=Object.values(store.data.jobs).at(-1);await store.publish('sports',second.version);assert.equal(store.read('sports',job.version).version,job.version);
  const restarted=await new TopicStore(dir).open();assert.equal(restarted.read('sports').version,second.version);await restarted.revoke('sports',job.version);assert.throws(()=>restarted.read('sports',job.version));assert.equal(restarted.read('sports').version,second.version);
});
test('generator cannot add skills, rules, examples, learner facts or forge pack hashes',async t=>{
  const generator=new SyntheticTopicGenerator(),topic={id:'sports',title:'运动',brief:'日常运动'},draft=await generator.generate(topic),provenance=generator.provenance(topic),review=await generator.review();
  assert.throws(()=>compilePack({topic,draft:{...draft,learner:'secret'},version:'v1',provenance,review}));
  assert.throws(()=>compilePack({topic,draft:{...draft,opportunities:[{skill_id:'invented',context:'x',opening:'x'}]},version:'v1',provenance,review}));
  const pack=compilePack({topic,draft,version:'v1',provenance,review});assert.throws(()=>validatePack({...pack,title:'伪造'}));assert.ok(pack.key_points.every(k=>k.evidence_rule==='unassessed'));assert.deepEqual(pack.cards,[]);
});
test('cancel and deadline fence generators ignoring abort; queued jobs interrupted on restart',async t=>{
  let resolve;const generator={...new SyntheticTopicGenerator(),generate:()=>new Promise(r=>resolve=r)};const {dir,store,manager}=await setup(t,generator,{budgetMs:15});const job=await manager.enqueue('sports','timeout');await manager.work;assert.equal(store.data.jobs[job.id].status,'failed');assert.equal(store.data.jobs[job.id].error,'GENERATION_TIMEOUT');resolve?.({});await new Promise(r=>setTimeout(r,5));assert.equal(Object.keys(store.data.versions).length,0);
  await store.change(d=>{d.jobs.interrupted={id:'interrupted',status:'generating'};});const restarted=await new TopicStore(dir).open();assert.equal(restarted.data.jobs.interrupted.error,'SERVICE_RESTARTED');
});
test('content rejection fails generation instead of publishing a rule replacement',async t=>{
  const generator=new SyntheticTopicGenerator();generator.review=async()=>{throw new Error('TOPIC_CONTENT_REJECTED');};const {store,manager}=await setup(t,generator);const job=await manager.enqueue('sports','rejected');await manager.work;assert.equal(store.data.jobs[job.id].status,'failed');assert.deepEqual(store.list(),[]);
});
