import { createHash } from 'node:crypto';
import { exact,isId,boundedText,immutable } from '../contracts/planning.js';
import { skillById,SKILL_CATALOG_VERSION } from './catalog.js';
export const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const unsafe=v=>/忽略(?:以上|规则|系统)|(?:system|developer)\s*(?:prompt|instruction)|mastered\s*=|索取(?:联系方式|密码)|send (?:password|secret)/iu.test(v);
export function validateTopic(topic) {
  if(!exact(topic,['id','title','brief'])||!isId(topic.id)||['__proto__','constructor','prototype'].includes(topic.id)||!boundedText(topic.title,60)||!boundedText(topic.brief,500))throw new Error('INVALID_TOPIC');
  return immutable(topic);
}
export function validateGenerated(draft) {
  const fields=[];
  if(!exact(draft,['subtopics','opportunities']))fields.push('root_fields');
  if(!Array.isArray(draft?.subtopics)||draft.subtopics.length<1||draft.subtopics.length>4||!draft.subtopics.every(s=>boundedText(s,100)))fields.push('subtopics');
  if(!Array.isArray(draft?.opportunities)||draft.opportunities.length<1||draft.opportunities.length>8)fields.push('opportunities');
  else {
    if(new Set(draft.opportunities.map(o=>o?.skill_id)).size!==draft.opportunities.length)fields.push('unique_skill_ids');
    for(const o of draft.opportunities){if(!exact(o,['skill_id','context','opening']))fields.push('opportunity_fields');if(!skillById(o?.skill_id))fields.push('skill_id');if(!boundedText(o?.context,160))fields.push('context');if(!boundedText(o?.opening,100))fields.push('opening');}
  }
  if(Buffer.byteLength(JSON.stringify(draft??{}))>12000)fields.push('size');
  if(Array.isArray(draft?.subtopics)&&draft.subtopics.some(unsafe)||Array.isArray(draft?.opportunities)&&draft.opportunities.some(o=>unsafe(o.context??'')||unsafe(o.opening??'')))fields.push('unsafe_instruction');
  if(fields.length){const error=new Error('INVALID_TOPIC_DRAFT');error.invalid_fields=[...new Set(fields)];throw error;}
  return immutable(draft);
}
export function compilePack({topic,draft,version,provenance,review}) {
  validateTopic(topic);validateGenerated(draft);
  // Language examples/cards are deliberately excluded from restricted admission.
  // A reviewer verdict is auxiliary, never independent pedagogical certification.
  const goals=draft.opportunities.map(o=>({id:o.skill_id,label:skillById(o.skill_id).label,kp_ids:[o.skill_id],start_tip:o.context,card_ids:[],success_rule_ref:'unassessed'}));
  const value={schema_version:'topic-pack-v1',id:topic.id,version,kind:'topic',title:topic.title,source:provenance.provider==='synthetic'?'synthetic':'llm_generated',content:topic.brief,subtopics:draft.subtopics,goals,key_points:[...new Set(goals.flatMap(g=>[...g.kp_ids,...skillById(g.id).prerequisites]))].map(id=>({...skillById(id),examples:[]})),cards:[],openings:Object.fromEntries(draft.opportunities.map(o=>[o.skill_id,o.opening])),catalog_version:SKILL_CATALOG_VERSION,admission:'validated_restricted',admitted_fields:['context','opening'],provenance,review};
  return validatePack({...value,hash:digest(value)});
}
export function validatePack(pack) {
  if(!exact(pack,['schema_version','id','version','kind','title','source','content','subtopics','goals','key_points','cards','openings','catalog_version','admission','admitted_fields','provenance','review','hash'])||pack.schema_version!=='topic-pack-v1'||!isId(pack.id)||!isId(pack.version)||pack.kind!=='topic'||!['synthetic','llm_generated'].includes(pack.source)||!boundedText(pack.title,60)||!boundedText(pack.content,500)||pack.catalog_version!==SKILL_CATALOG_VERSION||pack.admission!=='validated_restricted'||JSON.stringify(pack.admitted_fields)!=='["context","opening"]'||!Array.isArray(pack.cards)||pack.cards.length!==0||Buffer.byteLength(JSON.stringify(pack))>24576)throw new Error('INVALID_TOPIC_PACK');
  const {hash,...value}=pack;if(hash!==digest(value))throw new Error('TOPIC_PACK_HASH_MISMATCH');
  validateGenerated({subtopics:pack.subtopics,opportunities:pack.goals.map(g=>({skill_id:g.id,context:g.start_tip,opening:pack.openings?.[g.id]}))});
  if(!pack.openings||Object.keys(pack.openings).length!==pack.goals.length||!pack.goals.every(g=>Object.hasOwn(pack.openings,g.id))||pack.source==='synthetic'!== (pack.provenance?.provider==='synthetic'))throw new Error('INVALID_TOPIC_PROVENANCE');
  const wanted=new Set(pack.goals.flatMap(g=>[...g.kp_ids,...(skillById(g.id)?.prerequisites??[])]));
  if(!Array.isArray(pack.key_points)||pack.key_points.length!==wanted.size||!pack.key_points.every(k=>wanted.has(k.id)&&JSON.stringify(k)===JSON.stringify({...skillById(k.id),examples:[]}))||!pack.goals.every(g=>JSON.stringify(g)===JSON.stringify({id:g.id,label:skillById(g.id).label,kp_ids:[g.id],start_tip:g.start_tip,card_ids:[],success_rule_ref:'unassessed'})))throw new Error('INVALID_TOPIC_CAPABILITY');
  if(!exact(pack.provenance,['provider','model','prompt','input_hash'])||!['provider','model','prompt'].every(k=>boundedText(pack.provenance[k],100))||!/^[a-f0-9]{64}$/.test(pack.provenance.input_hash)||!exact(pack.review,['status','independent'])||!['auxiliary_pass','not_reviewed'].includes(pack.review.status)||pack.review.independent!==false)throw new Error('INVALID_TOPIC_PROVENANCE');
  return immutable(pack);
}
