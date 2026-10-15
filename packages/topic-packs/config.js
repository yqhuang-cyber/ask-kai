import { MiniMaxJsonTransport } from '../provider-minimax/planner.js';
import { TopicGenerator } from './generator.js';
// Role configuration is independent of Agent Core contracts. Adding a provider
// requires a registered adapter/profile, not a guessed model name or endpoint.
export function configuredTopicGenerator(env=process.env,{transports={}}={}) {
  const make=role=>{
    const provider=env[`ASK_KAI_TOPIC_${role}_PROVIDER`]??env.ASK_KAI_PLANNER_PROVIDER??'minimax';
    if(provider==='minimax'){if(!env.MINIMAX_API_KEY)return null;return new MiniMaxJsonTransport({apiKey:env.MINIMAX_API_KEY,baseURL:env.MINIMAX_BASE_URL,model:env[`MINIMAX_TOPIC_${role}_MODEL`]??env.MINIMAX_PLANNER_MODEL??'MiniMax-M3'});}
    if(!Object.hasOwn(transports,provider))throw new Error('TOPIC_PROVIDER_NOT_REGISTERED');
    const transport=transports[provider]({env,role});if(typeof transport?.completeJSON!=='function'||typeof transport.provider!=='string'||typeof transport.model!=='string')throw new Error('INVALID_TOPIC_TRANSPORT');return transport;
  };
  const transport=make('GENERATOR');if(!transport)return null;return new TopicGenerator({transport,reviewTransport:make('REVIEW')??transport});
}
