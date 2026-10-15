import { mkdir,readFile,writeFile,rename,unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateTopic,validatePack } from '../../../packages/topic-packs/contract.js';
import { immutable,isId } from '../../../packages/contracts/planning.js';
// One atomic manifest is the commit boundary. Single writer per service instance.
export class TopicStore {
  constructor(directory,{exclusive=false}={}){this.directory=directory;this.exclusive=exclusive;this.tail=Promise.resolve();}
  async open(){await mkdir(this.directory,{recursive:true,mode:0o700});if(this.exclusive)await this.acquire();try{this.data=JSON.parse(await readFile(join(this.directory,'store.json'),'utf8'));}catch(e){if(e.code!=='ENOENT'){await this.close();throw e;}this.data={schema:1,topics:{},versions:{},active:{},jobs:{}};}
    if(this.data.schema!==1)throw new Error('INVALID_TOPIC_STORE');
    Object.values(this.data.topics).forEach(validateTopic);Object.values(this.data.versions).forEach(v=>validatePack(v.pack));
    for(const job of Object.values(this.data.jobs))if(['queued','generating','validating'].includes(job.status)){job.status='failed';job.error='SERVICE_RESTARTED';}
    await this.flush(this.data);return this;
  }
  async acquire(){const path=join(this.directory,'writer.lock'),token=randomUUID();for(let attempt=0;attempt<2;attempt++)try{await writeFile(path,JSON.stringify({pid:process.pid,token}),{mode:0o600,flag:'wx'});this.lockToken=token;return;}catch(e){if(e.code!=='EEXIST')throw e;let previous;try{previous=JSON.parse(await readFile(path,'utf8'));}catch{throw new Error('TOPIC_STORE_LOCKED');}try{process.kill(previous.pid,0);throw new Error('TOPIC_STORE_LOCKED');}catch(error){if(error.code!=='ESRCH')throw error;await unlink(path);}}throw new Error('TOPIC_STORE_LOCKED');}
  async close(){if(!this.lockToken)return;await this.tail;const path=join(this.directory,'writer.lock');try{const lock=JSON.parse(await readFile(path,'utf8'));if(lock.pid===process.pid&&lock.token===this.lockToken)await unlink(path);}catch(e){if(e.code!=='ENOENT')throw e;}this.lockToken=null;}
  async flush(data){const path=join(this.directory,`pending-${randomUUID()}.json`);await writeFile(path,JSON.stringify(data),{mode:0o600});await rename(path,join(this.directory,'store.json'));}
  change(fn){const operation=this.tail.then(async()=>{const next=structuredClone(this.data),result=fn(next);await this.flush(next);this.data=next;return immutable(result??{});});this.tail=operation.catch(()=>{});return operation;}
  define(topic){validateTopic(topic);return this.change(d=>{d.topics[topic.id]=topic;return topic;});}
  list(){return Object.entries(this.data.active).flatMap(([id,version])=>{const v=this.data.versions[version];return v?.status==='published'?[{id,title:v.pack.title,version,hash:v.pack.hash,source:v.pack.source}]:[];});}
  read(id,version=this.data.active[id]){if(!isId(id)||!isId(version))throw new Error('TOPIC_UNAVAILABLE');const v=this.data.versions[version];if(!v||v.pack.id!==id||v.status!=='published')throw new Error('TOPIC_UNAVAILABLE');return validatePack(v.pack);}
  publish(id,version){return this.change(d=>{const v=d.versions[version];if(!v||v.pack.id!==id||!['validated_restricted','published'].includes(v.status))throw new Error('TOPIC_NOT_ADMITTED');validatePack(v.pack);v.status='published';d.active[id]=version;return {id,version,status:v.status};});}
  revoke(id,version){return this.change(d=>{const v=d.versions[version];if(!v||v.pack.id!==id)throw new Error('TOPIC_UNAVAILABLE');v.status='revoked';if(d.active[id]===version)delete d.active[id];return {id,version,status:'revoked'};});}
  inspect(){return immutable({topics:Object.values(this.data.topics),versions:Object.values(this.data.versions),jobs:Object.values(this.data.jobs)});}
}
