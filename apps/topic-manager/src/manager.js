import { randomUUID } from 'node:crypto';
import { compilePack } from '../../../packages/topic-packs/contract.js';
import { isId } from '../../../packages/contracts/planning.js';
export class TopicManager {
  constructor({store,generator,budgetMs=60000,capacity=32}){if(!Number.isSafeInteger(budgetMs)||budgetMs<1||budgetMs>60000)throw new Error('INVALID_GENERATION_BUDGET');Object.assign(this,{store,generator,budgetMs,capacity});this.work=Promise.resolve();this.controllers=new Map();this.closed=false;}
  async enqueue(topicId,requestId) {
    if(this.closed)throw new Error('SERVICE_CLOSED');
    if(!isId(requestId)||!Object.hasOwn(this.store.data.topics,topicId))throw new Error('INVALID_GENERATION_REQUEST');
    if(!this.generator)throw new Error('TOPIC_GENERATOR_UNCONFIGURED');
    const job=await this.store.change(d=>{const existing=Object.values(d.jobs).find(j=>j.request_id===requestId);if(existing){if(existing.topic_id!==topicId)throw new Error('IDEMPOTENCY_CONFLICT');return existing;}
      if(Object.values(d.jobs).filter(j=>['queued','generating','validating'].includes(j.status)).length>=this.capacity)throw new Error('GENERATION_CAPACITY');
      const job={id:randomUUID(),request_id:requestId,topic_id:topicId,topic:d.topics[topicId],status:'queued'};d.jobs[job.id]=job;return job;});
    if(job.status==='queued'&&!this.controllers.has(job.id)){const controller=new AbortController();this.controllers.set(job.id,controller);this.work=this.work.then(()=>this.run(job,controller)).catch(()=>{});}
    return job;
  }
  async run(job,controller) {
    let timer,timedOut=false,phase='generating';
    const update=patch=>this.store.change(d=>Object.assign(d.jobs[job.id],patch));
    try {
      controller.signal.throwIfAborted();await update({status:'generating'});
      const work=async()=>{let draft;try{draft=await this.generator.generate(job.topic,{signal:controller.signal});}catch(e){if(!['INVALID_TOPIC_DRAFT','PLANNER_INVALID_JSON','PLANNER_INCOMPLETE_OUTPUT'].includes(e.message)||controller.signal.aborted)throw e;draft=await this.generator.generate(job.topic,{signal:controller.signal,repair:true,repairFields:e.invalid_fields??['json']});}
        controller.signal.throwIfAborted();phase='validating';await update({status:'validating'});const review=await this.generator.review(job.topic,draft,{signal:controller.signal});controller.signal.throwIfAborted();
        return compilePack({topic:job.topic,draft,version:randomUUID(),provenance:this.generator.provenance(job.topic),review});};
      const pack=await Promise.race([work(),new Promise((_,reject)=>{timer=setTimeout(()=>{timedOut=true;controller.abort();reject(new Error('GENERATION_TIMEOUT'));},this.budgetMs);controller.signal.addEventListener('abort',()=>reject(new Error('GENERATION_CANCELLED')),{once:true});})]);
      controller.signal.throwIfAborted();await this.store.change(d=>{d.versions[pack.version]={pack,status:pack.admission};Object.assign(d.jobs[job.id],{status:'succeeded',version:pack.version});});
    }catch(e){const safe=['TOPIC_CONTENT_REJECTED','INVALID_TOPIC_DRAFT','PLANNER_UNAVAILABLE','PLANNER_INVALID_JSON','PLANNER_INCOMPLETE_OUTPUT','PLANNER_RESPONSE_TOO_LARGE'];await update({status:timedOut?'failed':controller.signal.aborted?'cancelled':'failed',phase,error:timedOut?'GENERATION_TIMEOUT':safe.includes(e.message)?e.message:'GENERATION_FAILED',invalid_fields:e.invalid_fields??[]});}
    finally{clearTimeout(timer);controller.abort();this.controllers.delete(job.id);}
  }
  async cancel(id){this.controllers.get(id)?.abort();return this.store.change(d=>{const j=d.jobs[id];if(!j)throw new Error('JOB_NOT_FOUND');if(['queued','generating','validating'].includes(j.status))j.status='cancelled';return j;});}
  close(){this.closed=true;for(const controller of this.controllers.values())controller.abort();}
}
