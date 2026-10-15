import { topicCredentials } from './credentials.js';
import { TopicStore } from './store.js';
import { TopicManager } from './manager.js';
import { createTopicServer } from './server.js';
import { configuredTopicGenerator } from '../../../packages/topic-packs/config.js';
import { SyntheticTopicGenerator } from '../../../packages/topic-packs/generator.js';
const synthetic=process.argv.includes('--synthetic');
try {
  const store=await new TopicStore(process.env.TOPIC_MANAGER_STORE??'.local/topic-manager',{exclusive:true}).open();
  const generator=synthetic?new SyntheticTopicGenerator():configuredTopicGenerator();
  const manager=new TopicManager({store,generator});
  const port=Number(process.env.TOPIC_MANAGER_PORT??4320);if(!Number.isSafeInteger(port)||port<1||port>65535)throw new Error('INVALID_PORT');
  const server=createTopicServer({manager,...await topicCredentials()});
  server.listen(port,'127.0.0.1',()=>console.log(`Topic Manager: http://127.0.0.1:${port} (${synthetic?'synthetic; quality unverified':'configured LLM; auxiliary review only'})`));
  server.on('close',()=>{void store.close();});
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{manager.close();server.close();server.closeAllConnections();});
}catch(e){console.error(/^[A-Z_]+$/.test(e.message)?e.message:'TOPIC_MANAGER_START_FAILED');process.exitCode=1;}
