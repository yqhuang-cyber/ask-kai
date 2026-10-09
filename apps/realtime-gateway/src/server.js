import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { SessionRuntime } from '../../../packages/agent-core/session.js';
import { SCENARIOS, loadScenario, ReplayProvider } from '../../../packages/provider-replay/index.js';
import { attachRealtime } from './realtime.js';
import { validateMemoryRecord } from '../../../packages/hskai-bridge/identity.js';
import { Metrics } from '../../../packages/policy/metrics.js';

const publicDir = new URL('../public/', import.meta.url);
const staticFiles = new Map([
  ['/', ['index.html','text/html']], ['/web.js', ['web.js','text/javascript']], ['/web.css', ['web.css','text/css']],
  ['/audio.js',['audio.js','text/javascript']], ['/capture-worklet.js',['capture-worklet.js','text/javascript']],
  ['/presentation.js',['presentation.js','text/javascript']],
  ['/diagnostics.js',['diagnostics.js','text/javascript']], ['/experience-cases.json',['experience-cases.json','application/json']],
  ['/dev/replay', ['replay.html','text/html']], ['/app.js',['app.js','text/javascript']], ['/style.css',['style.css','text/css']]
]);
function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}
async function streamReplay(req, res, id, paceMs) {
  const fixture = await loadScenario(id);
  const sessionId = randomUUID();
  const runtime = new SessionRuntime(sessionId);
  const provider = new ReplayProvider(fixture, { paceMs });
  const controller = new AbortController();
  res.on('close', () => controller.abort());
  res.writeHead(200, { 'Content-Type':'text/event-stream; charset=utf-8', 'Cache-Control':'no-cache, no-transform', 'X-Accel-Buffering':'no' });
  const send = async (type, data) => {
    if (res.destroyed) return;
    if (!res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`)) {
      try { await once(res, 'drain', { signal: controller.signal }); } catch (error) { if (error.name !== 'AbortError') throw error; }
    }
  };
  try {
    await send('mode', { mode:'synthetic_replay', provider_connected:false, scenario:id });
    for await (const event of provider.open({ sessionId, signal: controller.signal })) {
      const result = runtime.ingest(event);
      await send(result.accepted ? 'accepted' : 'dropped', result.accepted ? event : { event_id:event.event_id, reason:result.reason, response_id:event.response_id ?? null });
    }
    if (!controller.signal.aborted) await send('summary', runtime.snapshot());
  } finally {
    await provider.close();
    if (!res.destroyed) res.end();
  }
}
export async function readJson(req,maxBytes=4096) {
  let size=0;const chunks=[];
  for await(const chunk of req){size+=chunk.length;if(size>maxBytes)throw new Error('REQUEST_TOO_LARGE');chunks.push(chunk);}
  return JSON.parse(Buffer.concat(chunks).toString());
}
export function createGateway({ paceMs = 120, bridge, memoryPort, privacyPort, ...realtimeOptions } = {}) {
  const metrics=realtimeOptions.metrics ?? new Metrics();
  const authorize=(req,scope)=> {
    if(bridge)return bridge.authorize(req,scope);
    if(realtimeOptions.providerKind==='test')return {owner_id:'test-owner',learner_id:'test-learner',market:'SG',expires:Date.now()+60000,authorization_until:Date.now()+600000,memory:[],mission:null,scopes:['session:create','memory:read','memory:write','memory:delete']};
    throw new Error('UNAUTHORIZED');
  };
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
    // Local diagnostic surface: restrict Host to resist cross-site DNS rebinding.
    if (!/^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(req.headers.host ?? '')) return json(res, 403, { error:'LOCAL_HOST_REQUIRED' });
    if (req.headers['sec-fetch-site'] === 'cross-site') return json(res, 403, { error:'CROSS_SITE_DENIED' });
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/healthz') return json(res, 200, { service:'ask-kai', mode:'synthetic_replay', provider_connected:false, status:'ok' });
      if (req.method === 'GET' && url.pathname === '/api/replays') return json(res, 200, { scenarios:SCENARIOS });
      if(req.method==='GET' && url.pathname==='/api/metrics')return json(res,200,metrics.snapshot());
      if(req.method==='GET' && url.pathname==='/api/privacy')return json(res,200,{local_audio_persistence:false,local_transcript_persistence:false,memory_truth_source:'HSKai',provider_retention:'not_verified',privacy_requests_available:!!privacyPort});
      if(req.method==='POST' && url.pathname==='/api/privacy/requests') {
        if(req.headers.origin!==`http://${req.headers.host}`)return json(res,403,{error:'ORIGIN_REQUIRED'});
        let input;try{input=await readJson(req,512);}catch{return json(res,400,{error:'INVALID_REQUEST'});}
        if(!input || !['export','erase','status'].includes(input.operation) || Object.keys(input).some(k=>!['operation','request_id'].includes(k)) || (input.operation==='status' && !/^[A-Za-z0-9_-]{1,128}$/.test(input.request_id ?? '')))return json(res,400,{error:'INVALID_PRIVACY_REQUEST'});
        let identity;try{identity=authorize(req,input.operation==='status'?'privacy:read':`privacy:${input.operation}`);}catch{return json(res,401,{error:'HSKAI_AUTHORIZATION_REQUIRED'});}
        if(!privacyPort)return json(res,501,{error:'HSKAI_PRIVACY_WORKFLOW_REQUIRED'});
        try{const result=await privacyPort.request(identity,input.operation,input.request_id);if(input.operation==='erase')realtime.revoke(identity);return json(res,input.operation==='status'?200:202,result);}catch{return json(res,503,{error:'PRIVACY_REQUEST_UNAVAILABLE'});}
      }
      if(req.method==='GET' && url.pathname==='/api/memory/export') {
        let identity;try{identity=authorize(req,'memory:read');}catch{return json(res,401,{error:'HSKAI_AUTHORIZATION_REQUIRED'});}
        try{res.setHeader('Content-Disposition','attachment; filename="ask-kai-preferences.json"');return json(res,200,{scope:'authorized_learner_preferences',records:memoryPort?await memoryPort.read(identity):identity.memory});}catch{return json(res,503,{error:'HSKAI_MEMORY_UNAVAILABLE'});}
      }
      if(req.method==='GET' && url.pathname==='/api/bootstrap') {
        let identity;try{identity=authorize(req,'session:create');}catch{return json(res,401,{error:'HSKAI_AUTHORIZATION_REQUIRED'});}
        return json(res,200,{modes:['sports','free',...(identity.mission?['mission']:[])],mission:identity.mission?{id:identity.mission.id,title:identity.mission.title,targets:identity.mission.targets}:null,memory_writable:!!memoryPort && identity.scopes.includes('memory:write')});
      }
      if(url.pathname==='/api/memory') {
        if(['POST','DELETE'].includes(req.method) && req.headers.origin!==`http://${req.headers.host}`)return json(res,403,{error:'ORIGIN_REQUIRED'});
        const scope=req.method==='GET'?'memory:read':req.method==='POST'?'memory:write':'memory:delete';
        let identity;try{identity=authorize(req,scope);}catch{return json(res,401,{error:'HSKAI_AUTHORIZATION_REQUIRED'});}
        if(!['GET','POST','DELETE'].includes(req.method))return json(res,405,{error:'METHOD_NOT_ALLOWED'});
        try {
          if(req.method==='GET')return json(res,200,{records:memoryPort ? await memoryPort.read(identity):identity.memory,writable:!!memoryPort && identity.scopes.includes('memory:write'),can_delete:!!memoryPort && identity.scopes.includes('memory:delete')});
          if(!memoryPort)return json(res,501,{error:'HSKAI_MEMORY_WRITER_REQUIRED'});
          let input;try{input=await readJson(req,1024);}catch{return json(res,400,{error:'INVALID_REQUEST'});}
          const allowed=['interest','correction_preference','support_language'];
          if(!input || typeof input!=='object' || Array.isArray(input) || !Object.keys(input).every(k=>['field',...(req.method==='POST'?['value']:[])].includes(k)) || (input.field!==undefined && !allowed.includes(input.field)))return json(res,400,{error:'INVALID_MEMORY'});
          if(req.method==='POST') {
            const now=new Date().toISOString(),expires=new Date(Date.now()+30*86400000).toISOString();
            let record;try{record=validateMemoryRecord({field:input.field,value:input.value,source:'student_correction',updated_at:now,expires_at:expires});}catch{return json(res,400,{error:'INVALID_MEMORY'});}
            await memoryPort.write(identity,record);realtime.updateMemory(identity,await memoryPort.read(identity));
          } else {await memoryPort.delete(identity,input.field);realtime.revoke(identity);}
          return json(res,200,{records:await memoryPort.read(identity)});
        }catch{return json(res,503,{error:'HSKAI_MEMORY_UNAVAILABLE'});}
      }
      if(req.method==='POST' && url.pathname==='/api/authorization/revoke') {
        if(req.headers.origin!==`http://${req.headers.host}`)return json(res,403,{error:'ORIGIN_REQUIRED'});
        let identity;try{identity=authorize(req,'session:revoke');}catch{return json(res,401,{error:'HSKAI_AUTHORIZATION_REQUIRED'});}
        realtime.revoke(identity);return json(res,200,{revoked:true});
      }
      if (req.method === 'POST' && url.pathname === '/api/sessions') {
        if (!realtime.available) return json(res,501,{error:'REALTIME_NOT_IMPLEMENTED',provider_connected:false});
        const origin=`http://${req.headers.host}`;
        if(req.headers.origin!==origin)return json(res,403,{error:'ORIGIN_REQUIRED'});
        let identity;try{identity=authorize(req,'session:create');}catch{return json(res,401,{error:'HSKAI_AUTHORIZATION_REQUIRED'});}
        let input;
        try {input=await readJson(req);}catch{return json(res,400,{error:'INVALID_REQUEST'});}
        if(!input || !['sports','free','mission'].includes(input.mode) || Object.keys(input).some(k=>!['mode','mission_id'].includes(k)) || (input.mode==='mission' && typeof input.mission_id!=='string'))return json(res,400,{error:'INVALID_MODE'});
        if(input.mode==='mission' && identity.mission?.id!==input.mission_id)return json(res,403,{error:'TRUSTED_MISSION_REQUIRED'});
        try{if(memoryPort)identity.memory=await memoryPort.read(identity);}catch{return json(res,503,{error:'HSKAI_MEMORY_UNAVAILABLE'});}
        try{bridge?.consume(identity);}catch{return json(res,401,{error:'LAUNCH_ALREADY_USED'});}
        try{return json(res,201,realtime.create({origin,mode:input.mode,identity}));}catch{return json(res,429,{error:'SESSION_CAPACITY'});}
      }
      if (req.method === 'GET' && url.pathname.startsWith('/api/replays/')) {
        const id = url.pathname.slice('/api/replays/'.length);
        if (!SCENARIOS.some(item => item.id === id)) return json(res, 404, { error:'UNKNOWN_SCENARIO' });
        return await streamReplay(req, res, id, paceMs);
      }
      if (req.method === 'GET' && staticFiles.has(url.pathname)) {
        const [file, type] = staticFiles.get(url.pathname);
        const content = await readFile(new URL(file, publicDir));
        res.writeHead(200, { 'Content-Type':`${type}; charset=utf-8` });
        return res.end(content);
      }
      json(res, 404, { error:'NOT_FOUND' });
    } catch {
      // Never log transcript, request body, provider payload or credentials.
      if (!res.headersSent) json(res, 500, { error:'INTERNAL_ERROR' });
      else res.end();
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 5000;
  const realtime=attachRealtime(server,{...realtimeOptions,metrics});
  server.stopRealtime=()=>realtime.close();
  server.on('close',()=>realtime.close());
  return server;
}
