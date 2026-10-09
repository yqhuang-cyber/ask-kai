import { randomBytes,randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createMockHskai,MOCK_IDENTITY } from './server.js';
import { HskaiBridge,signAssertion } from '../../../packages/hskai-bridge/identity.js';
import { HskaiMemoryPort } from '../../../packages/hskai-bridge/memory.js';
import { HskaiPrivacyPort } from '../../../packages/hskai-bridge/privacy.js';
import { HskaiSafeguardingPort } from '../../../packages/hskai-bridge/safeguarding.js';
import { bridgeEndpoint } from '../../../packages/hskai-bridge/endpoint.js';

export class MockLaunchPort {
  constructor({endpoint,secret,fetcher=fetch}){Object.assign(this,{endpoint:bridgeEndpoint(endpoint,{allowLocal:true}),secret,fetcher});}
  async issue() {
    const now=Math.floor(Date.now()/1000);
    const token=signAssertion({v:1,iss:'ask-kai',aud:'hskai-launch',...MOCK_IDENTITY,jti:randomUUID(),iat:now,exp:now+30,operation:'issue'},this.secret);
    const response=await this.fetcher(this.endpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(2000),headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:'{}'});
    if(!response.ok || !response.body)throw new Error('MOCK_HSKAI_UNAVAILABLE');
    const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>12288)throw new Error('INVALID_MOCK_LAUNCH');chunks.push(chunk);}
    const result=JSON.parse(Buffer.concat(chunks).toString());
    if(result.source!=='mock_hskai' || typeof result.assertion!=='string')throw new Error('INVALID_MOCK_LAUNCH');
    return result.assertion;
  }
}

export async function startMockBackend({fetcher=fetch}={}) {
  const secret=randomBytes(48).toString('base64url'),server=createMockHskai({secret});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}/internal/ask-kai/`;
  const options={secret,fetcher,allowLocal:true};
  return {bridge:new HskaiBridge({secret,markets:['SG']}),memoryPort:new HskaiMemoryPort({...options,endpoint:base+'memory'}),privacyPort:new HskaiPrivacyPort({...options,endpoint:base+'privacy'}),safeguardingPort:new HskaiSafeguardingPort({...options,endpoint:base+'safeguarding'}),pocPort:new MockLaunchPort({...options,endpoint:base+'launch'}),
    close:()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();})};
}
