import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { SessionRuntime } from '../../../packages/agent-core/session.js';
import { TeachingSession } from '../../../packages/agent-core/teaching.js';

export function attachRealtime(server,{providerFactory,providerKind='doubao',maxConnections=8,readyTimeoutMs=8000,maxSessionMs=600000,cancelTimeoutMs=1500,contextTimeoutMs=1500}={}) {
  const tickets = new Map();
  const connections = new Set();
  const wss = new WebSocketServer({noServer:true,maxPayload:65536,perMessageDeflate:false,handleProtocols:protocols=>protocols.has('ask-kai.v1') ? 'ask-kai.v1' : false});
  const sweep = setInterval(() => { for(const [key,item] of tickets) if(item.expires <= Date.now()) tickets.delete(key); },1000);
  sweep.unref();
  const reject = (socket,status) => socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  server.on('upgrade',(req,socket,head) => {
    if (!providerFactory) return reject(socket,'501 Not Implemented');
    const expectedOrigin = `http://${req.headers.host}`;
    if (!/^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(req.headers.host ?? '') || req.headers.origin !== expectedOrigin) return reject(socket,'403 Forbidden');
    if (req.url !== '/api/realtime' || !providerFactory) return reject(socket,'501 Not Implemented');
    const protocols = (req.headers['sec-websocket-protocol'] ?? '').split(',').map(p=>p.trim());
    const token = protocols.find(p=>p.startsWith('ticket.'))?.slice(7);
    const ticket = tickets.get(token);
    tickets.delete(token); // one use, including a failed attempt
    if (!protocols.includes('ask-kai.v1') || !ticket || ticket.expires <= Date.now() || ticket.origin !== expectedOrigin) return reject(socket,'401 Unauthorized');
    if (connections.size >= maxConnections) return reject(socket,'429 Too Many Requests');
    wss.handleUpgrade(req,socket,head,ws => {
      connections.add(ws);
      const runtime = new SessionRuntime(ticket.session_id,{target:null});
      const teaching=new TeachingSession({sessionId:ticket.session_id,mode:ticket.mode});
      let provider;
      let ended = false;
      let ready = false;
      let lastResponse = null;
      const pendingCancel = new Map();
      let appliedVersion=1,pendingContext=null;
      let byteWindow = 0; let windowAt = Date.now();
      const send = data => {
        if (ws.readyState !== ws.OPEN) return;
        if (ws.bufferedAmount > 262144) return finish('CLIENT_BACKPRESSURE');
        ws.send(JSON.stringify(data));
      };
      const finish = code => {
        if (ended) return;
        ended = true;
        clearTimeout(readyTimer); clearTimeout(lifetime);
        for(const timer of pendingCancel.values())clearTimeout(timer);
        if(pendingContext)clearTimeout(pendingContext.timer);
        try { provider?.close(); } catch {}
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({type:'teaching.summary',...teaching.view()}));
          ws.send(JSON.stringify({type:code ? 'session.failed':'session.closed',code:code ?? undefined,provider_connected:false}));
        }
        ws.close(code ? 1011:1000,'session ended');
        connections.delete(ws);
      };
      const readyTimer = setTimeout(()=>finish('PROVIDER_READY_TIMEOUT'),readyTimeoutMs);
      const lifetime = setTimeout(()=>finish('SESSION_DURATION_LIMIT'),maxSessionMs);
      const flushContext = () => {
        if(ended || !ready || runtime.active || pendingContext || appliedVersion===teaching.version)return;
        const version=teaching.version;
        pendingContext={version,timer:setTimeout(()=>finish('CONTEXT_ACK_TIMEOUT'),contextTimeoutMs)};
        try{provider.updateContext({version,instructions:teaching.instructions()});}catch{finish('PROVIDER_CONTEXT_FAILED');}
      };
      const interrupt = responseId => {
        const active = runtime.active;
        const id=responseId ?? active?.id ?? lastResponse?.id;
        if (!id) return;
        send({type:'output.stop',response_id:id});
        if (!active || active.id!==id) return;
        runtime.ingest({version:1,event_id:randomUUID(),session_id:ticket.session_id,seq:0,at_ms:0,type:'response.cancel.requested',turn_id:active.turn,response_id:id,payload:{}});
        pendingCancel.set(id,setTimeout(()=>finish('CANCEL_ACK_TIMEOUT'),cancelTimeoutMs));
        try {provider.cancel(id);}catch{finish('PROVIDER_CANCEL_FAILED');}
      };
      ws.on('close',()=>finish()); ws.on('error',()=>finish('CLIENT_TRANSPORT_ERROR'));
      ws.on('message',(bytes,binary) => {
        try {
          if (binary) {
            if (!ready) throw new Error('AUDIO_BEFORE_READY');
            if (Date.now()-windowAt >= 1000) {windowAt=Date.now();byteWindow=0;}
            byteWindow += bytes.length;
            if (byteWindow > provider.audio.input_rate*2*1.25) throw new Error('AUDIO_RATE_LIMIT');
            provider.sendAudio(bytes);
          } else {
            if (bytes.length > 1024) throw new Error('CONTROL_TOO_LARGE');
            const value = JSON.parse(bytes.toString());
            if (value?.type === 'session.end' && Object.keys(value).length === 1) finish();
            else if (value?.type==='response.cancel' && ready && Object.keys(value).every(k=>['type','response_id'].includes(k)) && (value.response_id===undefined || /^[a-zA-Z0-9_.:-]{1,128}$/.test(value.response_id))) interrupt(value.response_id);
            else throw new Error('INVALID_CONTROL');
          }
        } catch { finish('INVALID_CLIENT_MESSAGE'); }
      });
      try {
        provider = providerFactory(ticket);
        provider.open({sessionId:ticket.session_id,instructions:teaching.instructions(),onFailure:code=>finish(code),onEvent:packet=> {
          if (ended) return;
          if (packet.control==='user.speech.started') {if(ready)interrupt();return;}
          if(packet.control==='context.updated') {
            if(pendingContext && packet.version===pendingContext.version){clearTimeout(pendingContext.timer);appliedVersion=packet.version;pendingContext=null;send({type:'teaching.context.applied',version:appliedVersion});flushContext();}
            return;
          }
          if (!packet.event) return;
          const result = runtime.ingest(packet.event);
          if (!result.accepted) {
            if (result.reason === 'event_limit' || result.reason === 'invalid_event') finish('PROVIDER_PROTOCOL_ERROR');
            return;
          }
          if (packet.event.type === 'session.ready') {ready=true;clearTimeout(readyTimer);}
          if (packet.event.type==='response.started')lastResponse={id:packet.event.response_id,turn:packet.event.turn_id};
          if (packet.event.type==='response.cancelled') {clearTimeout(pendingCancel.get(packet.event.response_id));pendingCancel.delete(packet.event.response_id);}
          if(teaching.accept(packet.event))send({type:'teaching.state',...teaching.view()});
          send({type:'event',event:packet.event,audio:packet.audio,sample_rate:packet.sample_rate,provider_connected:ready && providerKind==='doubao',synthetic:providerKind!=='doubao'});
          if(['response.done','response.cancelled'].includes(packet.event.type))flushContext();
        }});
        send({type:'session.config',session_id:ticket.session_id,audio:provider.audio,provider_connected:false,synthetic:providerKind!=='doubao'});
        send({type:'teaching.state',...teaching.view()});
      } catch { finish('PROVIDER_CONFIGURATION_ERROR'); }
    });
  });
  return {
    available:!!providerFactory,
    create({origin,mode}) {
      if (!providerFactory) return null;
      if (tickets.size+connections.size >= maxConnections) throw new Error('SESSION_CAPACITY');
      const token = randomUUID();
      const ticket = {session_id:randomUUID(),mode,origin,expires:Date.now()+30000};
      tickets.set(token,ticket);
      return {session_id:ticket.session_id,ticket:token,websocket_path:'/api/realtime',protocol:'ask-kai.v1',expires_in:30,provider_connected:false};
    },
    close() {clearInterval(sweep);tickets.clear();for(const ws of connections)ws.terminate();wss.close();}
  };
}
