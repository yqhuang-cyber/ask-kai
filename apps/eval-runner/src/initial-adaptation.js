import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const hash=v=>createHash('sha256').update(v).digest('hex');
export const canonical=value=>JSON.stringify(value,function(k,v){return v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(key=>[key,v[key]])):v;});
const dataset=new URL('../../../docs/eval-datasets/initial-planner-adaptation-v1/',import.meta.url);
// The model-visible loader never reads the oracle. Only the evaluator does.
export async function loadAdaptationInputs() {
  const [inputBytes,catalogBytes,manifestBytes]=await Promise.all(['inputs.json','catalog.json','manifest.json'].map(f=>readFile(new URL(f,dataset))));
  const inputs=JSON.parse(inputBytes),catalog=JSON.parse(catalogBytes),manifest=JSON.parse(manifestBytes);
  for(const [name,bytes] of [['inputs.json',inputBytes],['catalog.json',catalogBytes]])if(hash(bytes)!==manifest.files[name].sha256||bytes.length!==manifest.files[name].bytes)throw new Error('ADAPTATION_DATASET_CHANGED');
  const cases=inputs.cases.map(c=>{const input=structuredClone(inputs.fixtures[c.base_fixture]);for(const patch of c.patches){const parts=patch.path.slice(1).split('/').map(s=>s.replaceAll('~1','/').replaceAll('~0','~')),key=parts.pop();let parent=input;for(const part of parts)parent=parent[part];if(!['add','replace'].includes(patch.op)||patch.op==='replace'&&!Object.hasOwn(parent,key))throw new Error('INVALID_ADAPTATION_PATCH');parent[key]=structuredClone(patch.value);}
    const resource=structuredClone(catalog);if(c.catalog_variant==='reverse-goal-order'){resource.goals.reverse();resource.topic.goal_ids.reverse();}const materialized={input,catalog:resource},sha256=hash(canonical(materialized));if(sha256!==manifest.materialized_case_sha256[c.id])throw new Error('ADAPTATION_CASE_CHANGED');
    // binding_variant and all case labels stay outside the model request.
    const {binding_variant,...logical}=input;return {case_id:c.id,materialized_hash:sha256,logical_input:logical,catalog:resource,binding:binding_variant??null};});
  return {cases,manifest};
}
export async function loadAdaptationOracles(manifest) {const bytes=await readFile(new URL('oracles.json',dataset));if(hash(bytes)!==manifest.files['oracles.json'].sha256)throw new Error('ADAPTATION_ORACLE_CHANGED');return JSON.parse(bytes).cases;}
export function bindDesignCase(item) {
  const logical=item.logical_input,context={...structuredClone(logical.learner_context),snapshot_id:'eval-snapshot',revision:1},scope=logical.resource_scope.catalog_goal_ids;
  const goals=item.catalog.goals.filter(g=>scope.includes(g.id)).map(g=>({id:g.id,label:g.behavior,kp_ids:[g.skill_id],start_tip:g.behavior,card_ids:[],success_rule_ref:'unassessed'}));
  // Design prerequisites remain frozen, not replaced with the runtime catalog.
  // Each clause is a set of alternative prerequisites in this design fixture.
  const all=new Set(item.catalog.goals.flatMap(g=>[g.skill_id,...g.required_prerequisite_any_of_clauses.flat()]));
  const key_points=[...all].map(id=>{const g=item.catalog.goals.find(g=>g.skill_id===id);return {id,label:g?.behavior??id,evidence_rule:'unassessed',prerequisites:g?.required_prerequisite_any_of_clauses.flat()??[],examples:[]};});
  const resource={schema_version:'topic-pack-v1',id:logical.entry.topic_id??logical.entry.mission_id??'sports',version:'frozen-design-resource-v1',kind:logical.entry.mode,title:'运动',content:'冻结设计资料适配器；不符合发布契约，不用于运行存储',goals,key_points,cards:[],subtopics:['运动与生活'],openings:Object.fromEntries(goals.map(g=>[g.id,'你想从哪件运动经历聊起？']))};
  return {entry:{...logical.entry,...(logical.current_request?.text?{opening_request:logical.current_request.text}:{})},context,resource};
}
