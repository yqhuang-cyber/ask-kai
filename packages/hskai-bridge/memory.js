import { randomUUID } from 'node:crypto';
import { signAssertion,validateMemoryRecord } from './identity.js';
const key=identity=>JSON.stringify([identity.owner_id,identity.learner_id]);
/** Test/local development port. Not the production learner truth source. */
export class InMemoryLearnerStore {
  constructor(){this.records=new Map();}
  async read(identity){return structuredClone(this.records.get(key(identity)) ?? []).filter(r=>Date.parse(r.expires_at)>Date.now());}
  async write(identity,record){const records=await this.read(identity);this.records.set(key(identity),[...records.filter(r=>r.field!==record.field),validateMemoryRecord(record)]);}
  async delete(identity,field){if(field)this.records.set(key(identity),(await this.read(identity)).filter(r=>r.field!==field));else this.records.delete(key(identity));}
}
/** New BFF contract, not an assertion that this endpoint exists in deployed HSKai. */
export class HskaiMemoryPort {
  constructor({endpoint,secret,fetcher=fetch}) {
    const url=new URL(endpoint);
    if(url.protocol!=='https:' || url.username || url.password || url.search || url.hash)throw new Error('INVALID_HSKAI_ENDPOINT');
    Object.assign(this,{endpoint:url.href,secret,fetcher});
  }
  async request(identity,operation,data={}) {
    const now=Math.floor(Date.now()/1000);
    const assertion=signAssertion({v:1,iss:'ask-kai',aud:'hskai-memory',iat:now,exp:now+30,jti:randomUUID(),owner_id:identity.owner_id,learner_id:identity.learner_id,operation},this.secret);
    const response=await this.fetcher(this.endpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(5000),headers:{Authorization:`Bearer ${assertion}`,'Content-Type':'application/json'},body:JSON.stringify({operation,...data})});
    if(!response.ok)throw new Error('HSKAI_MEMORY_UNAVAILABLE');
    const chunks=[];let length=0;
    if(!response.body)throw new Error('HSKAI_MEMORY_INVALID');
    for await(const chunk of response.body){length+=chunk.length;if(length>8192)throw new Error('HSKAI_MEMORY_INVALID');chunks.push(chunk);}
    const bytes=Buffer.concat(chunks);
    let result;try{result=JSON.parse(Buffer.from(bytes).toString());}catch{throw new Error('HSKAI_MEMORY_INVALID');}
    return result;
  }
  async read(identity) {
    const result=await this.request(identity,'read');
    if(!Array.isArray(result.records) || result.records.length>3)throw new Error('HSKAI_MEMORY_INVALID');
    const records=result.records.filter(r=>Date.parse(r.expires_at)>Date.now()).map(r=>validateMemoryRecord(r));
    if(new Set(records.map(r=>r.field)).size!==records.length)throw new Error('HSKAI_MEMORY_INVALID');
    return records;
  }
  async write(identity,record){await this.request(identity,'write',{record:validateMemoryRecord(record)});}
  async delete(identity,field){await this.request(identity,'delete',{field:field ?? null});}
}
