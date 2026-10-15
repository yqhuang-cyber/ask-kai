import { randomUUID } from 'node:crypto';
import { TopicStore } from '../apps/topic-manager/src/store.js';
import { TopicManager } from '../apps/topic-manager/src/manager.js';
import { configuredTopicGenerator } from '../packages/topic-packs/config.js';
import { SyntheticTopicGenerator } from '../packages/topic-packs/generator.js';
import { isId } from '../packages/contracts/planning.js';
const args=process.argv.slice(2),id=args.find(a=>a.startsWith('--topic='))?.slice(8),publish=args.includes('--publish'),synthetic=args.includes('--synthetic');
if(!isId(id)||args.some(a=>!['--publish','--synthetic',`--topic=${id}`].includes(a)))throw new Error('INVALID_TOPIC_GENERATION_ARGS');
const store=await new TopicStore(process.env.TOPIC_MANAGER_STORE??'.local/topic-manager',{exclusive:true}).open();let manager;
try {
  manager=new TopicManager({store,generator:synthetic?new SyntheticTopicGenerator():configuredTopicGenerator()});
  const started=performance.now(),job=await manager.enqueue(id,randomUUID());await manager.work;const result=store.data.jobs[job.id];
  if(result.status==='succeeded'&&publish)await store.publish(id,result.version);
  console.log(JSON.stringify({topic_id:id,status:result.status,phase:result.phase??null,error:result.error??null,invalid_fields:result.invalid_fields??[],published:result.status==='succeeded'&&publish,version:result.version??null,elapsed_ms:Math.round(performance.now()-started),source:result.version?store.data.versions[result.version].pack.source:null}));
  if(result.status!=='succeeded')process.exitCode=1;
}catch(e){console.log(JSON.stringify({topic_id:id,status:'failed',error:/^[A-Z_]+$/.test(e.message)?e.message:'TOPIC_GENERATION_FAILED'}));process.exitCode=1;}
finally{manager?.close();await store.close();}
