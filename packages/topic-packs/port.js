import { requireIdentity,isId } from '../contracts/planning.js';
import { validatePack } from './contract.js';
export class PublishedTopicClient {
  constructor({endpoint='http://127.0.0.1:4320',token,fetcher=fetch}) {
    const url=new URL(endpoint);if(url.protocol!=='http:'||!['127.0.0.1','[::1]','localhost'].includes(url.hostname)||url.pathname!=='/'||url.search||url.hash||url.username||url.password||!token)throw new Error('INVALID_TOPIC_ENDPOINT');
    Object.assign(this,{endpoint:url.origin,token,fetcher});this.cache=new Map();
  }
  async request(path,{signal}={}){const response=await this.fetcher(this.endpoint+'/api/published'+path,{headers:{Authorization:'Bearer '+this.token},redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(1000)]):AbortSignal.timeout(1000)});if(!response.ok||!response.body)throw new Error('TOPIC_UNAVAILABLE');const chunks=[];let bytes=0;for await(const c of response.body){bytes+=c.length;if(bytes>262144)throw new Error('INVALID_TOPIC_RESPONSE');chunks.push(c);}return JSON.parse(Buffer.concat(chunks).toString());}
  async list(){const result=await this.request('');if(!Array.isArray(result.topics)||!result.topics.every(t=>isId(t.id)&&isId(t.version)&&typeof t.title==='string'&&t.title.length<=60))throw new Error('INVALID_TOPIC_LIST');return result.topics;}
  async read(id,{version,signal}={}){
    if(!isId(id)||version!==undefined&&!isId(version))throw new Error('INVALID_TOPIC_REFERENCE');
    const key=id+'@'+(version??'active'),cached=this.cache.get(key),response=await this.fetcher(this.endpoint+'/api/published/'+id+(version?'?version='+version:''),{headers:{Authorization:'Bearer '+this.token,...(cached?{'If-None-Match':`"${cached.hash}"`}:{})},redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(1000)]):AbortSignal.timeout(1000)});
    if(response.status===304&&cached)return cached;
    if(!response.ok||!response.body){this.cache.delete(key);throw new Error('TOPIC_UNAVAILABLE');}
    const chunks=[];let bytes=0;for await(const c of response.body){bytes+=c.length;if(bytes>262144)throw new Error('INVALID_TOPIC_RESPONSE');chunks.push(c);}const pack=validatePack(JSON.parse(Buffer.concat(chunks).toString()));if(pack.id!==id||version&&pack.version!==version)throw new Error('WRONG_TOPIC_PACK');
    this.cache.delete(key);this.cache.set(key,pack);if(this.cache.size>64)this.cache.delete(this.cache.keys().next().value);return pack;
  }
}
// Learner facts remain behind the authorized HSKai port. Shared packs carry no facts.
export function withPublishedTopics(port,topics) {
  return {
    read:(...args)=>port.read(...args),append:(...args)=>port.append(...args),topics,
    async getResource(identity,entry,{signal,version}={}){if(entry.mode!=='topic')return port.getResource(identity,entry,{signal});requireIdentity(identity,'curriculum:read');return topics.read(entry.topic_id??'sports',{signal,version});},
    async checkResource(identity,resource,{signal}={}){if(resource?.schema_version!=='topic-pack-v1')return;requireIdentity(identity,'curriculum:read');const current=await topics.read(resource.id,{version:resource.version,signal});if(current.hash!==resource.hash)throw new Error('TOPIC_PACK_CHANGED');}
  };
}
