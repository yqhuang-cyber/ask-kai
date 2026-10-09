import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { SessionRuntime } from '../../../packages/agent-core/session.js';
import { TeachingSession } from '../../../packages/agent-core/teaching.js';
import { SafetyPolicy,SAFETY_MESSAGE } from '../../../packages/policy/safety.js';
import { metadata } from '../public/diagnostics.js';
import { SEEDUPLEX_PROTOCOL } from '../../../packages/provider-doubao/seeduplex.js';
import { hasSpeechText } from '../../../packages/agent-core/turn-taking.js';
import { TurnOutputGate } from './output-gate.js';
import { ReplyAudit,REPLY_POLICY_VERSION } from '../../../packages/agent-core/reply-policy.js';

export function attachRealtime(server,{providerFactory,providerKind='doubao',businessSource='unconfigured',maxConnections=8,readyTimeoutMs=8000,maxSessionMs=600000,cancelTimeoutMs=1500,contextTimeoutMs=1500,replyGraceMs=350,turnWaitMs=5000,safeguardingPort,metrics}={}) {
  const tickets = new Map();
  const connections = new Set();
  const sessions=new Map();
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
    if (!protocols.includes('ask-kai.v1') || !ticket || ticket.expires <= Date.now() || ticket.identity.expires<=Date.now() || ticket.origin !== expectedOrigin) return reject(socket,'401 Unauthorized');
    if (connections.size >= maxConnections) return reject(socket,'429 Too Many Requests');
    wss.handleUpgrade(req,socket,head,ws => {
      connections.add(ws);
      const runtime = new SessionRuntime(ticket.session_id,{target:null});
      const teaching=new TeachingSession({sessionId:ticket.session_id,mode:ticket.mode,memory:ticket.identity.memory,mission:ticket.identity.mission,speechPace:ticket.speech_pace});
      const policy=new SafetyPolicy();
      const started=performance.now();metrics?.count(providerKind,'sessions');
      let restricted=false,controlCount=0,controlAt=Date.now(),replyAt=null,firstAudio=false;
      let provider;
      let outputGate;
      let ended = false;
      let ready = false;
      let lastResponse = null;
      const pendingCancel = new Map();
      const speechCandidates=new Map();
      let appliedVersion=1,pendingContext=null;
      let diagnostics=false;
      const replyStats=new Map();
      const diagnose=(name,fields={})=>{
        if(!diagnostics || ws.readyState!==ws.OPEN || ws.bufferedAmount>131072)return;
        try{ws.send(JSON.stringify({type:'diagnostics.event',row:{name,at_ms:performance.now()-started,fields:metadata(fields)}}));}catch{/* Diagnostics do not control the session. */}
      };
      const completeStats=(id,state)=>{
        const s=replyStats.get(id);if(!s)return;
        if(s.audit)diagnose('reply.audit',{response_id:id,turn_id:s.turn,state,...s.audit.finish(state)});
        diagnose('response.complete',{response_id:id,turn_id:s.turn,state,text_chars:s.chars,text_deltas:s.deltas,audio_chunks:s.chunks,pcm_duration_ms:s.pcmMs,elapsed_ms:performance.now()-s.at});
        replyStats.delete(id);
      };
      let byteWindow = 0; let windowAt = Date.now();
      const send = data => {
        if (ws.readyState !== ws.OPEN) return;
        if (ws.bufferedAmount > 262144) return finish('CLIENT_BACKPRESSURE');
        ws.send(JSON.stringify(data));
      };
      const finish = code => {
        if (ended) return;
        for(const id of replyStats.keys())completeStats(id,code?'failed':'closed');
        diagnose('session.end',{state:code?'failed':'closed',code:code??undefined});
        ended = true;
        outputGate?.close();speechCandidates.clear();
        clearTimeout(readyTimer); clearTimeout(lifetime);
        clearInterval(heartbeat);
        if(code)metrics?.count(providerKind,'failures');
        for(const pending of pendingCancel.values())clearTimeout(pending.timer);
        pendingCancel.clear();
        if(pendingContext)clearTimeout(pendingContext.timer);
        try { provider?.close(); } catch {}
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({type:'teaching.summary',...teaching.view()}));
          ws.send(JSON.stringify({type:code ? 'session.failed':'session.closed',code:code ?? undefined,provider_connected:false}));
        }
        ws.close(code ? 1011:1000,'session ended');
        connections.delete(ws);
        sessions.delete(ws);
      };
      const readyTimer = setTimeout(()=>finish('PROVIDER_READY_TIMEOUT'),readyTimeoutMs);
      const lifetime = setTimeout(()=>finish('SESSION_DURATION_LIMIT'),Math.min(maxSessionMs,ticket.identity.authorization_until-Date.now()));
      let alive=true;
      const heartbeat=setInterval(()=>{if(!alive){finish('CLIENT_HEARTBEAT_TIMEOUT');ws.terminate();return;}alive=false;if(ws.readyState===ws.OPEN)ws.ping();},15000);
      ws.on('pong',()=>{alive=true;});
      const flushContext = () => {
        if(ended || !ready || runtime.active || pendingCancel.size || pendingContext || appliedVersion===teaching.version)return;
        const version=teaching.version;
        diagnose('context.requested',{context_version:version});
        pendingContext={version,timer:setTimeout(()=>finish('CONTEXT_ACK_TIMEOUT'),contextTimeoutMs)};
        try{provider.updateContext({version,instructions:teaching.instructions()});}catch{finish('PROVIDER_CONTEXT_FAILED');}
      };
      const cancelSent=id=> {
        const pending=pendingCancel.get(id);if(!pending || pending.timer!==undefined)return;
        pending.sentAt=performance.now();
        diagnose('cancel.sent',{response_id:id,turn_id:pending.turn,source:pending.source,elapsed_ms:pending.sentAt-pending.at});
        pending.timer=setTimeout(()=>finish('CANCEL_ACK_TIMEOUT'),cancelTimeoutMs);
      };
      const interrupt = (responseId,source='manual') => {
        const active = runtime.active;
        const id=responseId ?? active?.id ?? lastResponse?.id;
        if (!id) return;
        if(pendingCancel.has(id)){diagnose('cancel.ignored',{response_id:id,source,reason:'duplicate'});return;}
        diagnose('cancel.requested',{response_id:id,source,active:!!active && active.id===id,pending_context:!!pendingContext,pending_cancel:pendingCancel.size>0});
        outputGate?.stop(id);send({type:'output.stop',response_id:id});
        metrics?.count(providerKind,'interruptions');
        if (!active || active.id!==id) return;
        const stats=replyStats.get(id);if(stats)stats.cancelAt=performance.now();
        runtime.ingest({version:1,event_id:randomUUID(),session_id:ticket.session_id,seq:0,at_ms:0,type:'response.cancel.requested',turn_id:active.turn,response_id:id,payload:{}});
        pendingCancel.set(id,{turn:active.turn,source,at:performance.now()});
        try {const state=provider.cancel(id);if(state!=='queued')cancelSent(id);}catch{finish('PROVIDER_CANCEL_FAILED');}
      };
      const captureSpeech=turnId=> {
        if(speechCandidates.has(turnId))return speechCandidates.get(turnId);
        if(speechCandidates.size>=1000){finish('TURN_LIMIT');return null;}
        const reply=runtime.active ? {id:runtime.active.id,turn:runtime.active.turn}:lastResponse;
        const candidate={target:reply?.turn!==turnId?reply?.id:null,ownerTurn:reply?.turn,confirmed:false};
        speechCandidates.set(turnId,candidate);return candidate;
      };
      sessions.set(ws,{identity:ticket.identity,teaching,finish,flushContext});
      const restrict = (risk,event) => {
        restricted=true;metrics?.count(providerKind,'restricted');
        outputGate?.close();
        diagnose('cancel.requested',{response_id:runtime.active?.id??lastResponse?.id,source:'safety',active:!!runtime.active,pending_context:!!pendingContext});
        send({type:'output.stop',response_id:runtime.active?.id ?? lastResponse?.id});
        try{if(runtime.active)provider.cancel(runtime.active.id);}catch{}
        send({type:'safety.notice',message:SAFETY_MESSAGE,handoff:'pending',policy_version:risk.policy_version});
        const request={identity:ticket.identity,session_id:ticket.session_id,source_event_id:event.event_id,reason:risk.reason,policy_version:risk.policy_version};
        const delivery=safeguardingPort ? Promise.resolve().then(()=>safeguardingPort.request(request)):Promise.reject(new Error('NO_HANDOFF_PORT'));
        let timer;
        Promise.race([delivery,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('HANDOFF_TIMEOUT')),1800);})]).then(result=> {
          if(result?.mocked===true){send({type:'safety.handoff',delivered:false,mocked:true});return;}
          if(result?.delivered!==true)throw new Error('HANDOFF_NOT_CONFIRMED');
          metrics?.count(providerKind,'handoffs_delivered');send({type:'safety.handoff',delivered:true});
        }).catch(()=>send({type:'safety.handoff',delivered:false})).finally(()=>{clearTimeout(timer);finish('SAFETY_RESTRICTED');});
      };
      ws.on('close',()=>finish()); ws.on('error',()=>finish('CLIENT_TRANSPORT_ERROR'));
      ws.on('message',(bytes,binary) => {
        if(ended || restricted)return;
        try {
          if (binary) {
            if (!ready) throw new Error('AUDIO_BEFORE_READY');
            if (Date.now()-windowAt >= 1000) {windowAt=Date.now();byteWindow=0;}
            byteWindow += bytes.length;
            if (byteWindow > provider.audio.input_rate*2*1.25) throw new Error('AUDIO_RATE_LIMIT');
            provider.sendAudio(bytes);
          } else {
            if(Date.now()-controlAt>=1000){controlAt=Date.now();controlCount=0;}
            if(++controlCount>20){metrics?.count(providerKind,'control_rate_limited');return finish('CONTROL_RATE_LIMIT');}
            if (bytes.length > 1024) throw new Error('CONTROL_TOO_LARGE');
            const value = JSON.parse(bytes.toString());
            if (value?.type === 'session.end' && Object.keys(value).length === 1) finish();
            else if(value?.type==='diagnostics.enable' && Object.keys(value).length===1) {
              if(!diagnostics) {
                diagnostics=true;
                diagnose('backend.config',{business_source:businessSource});
                const output=provider.profile?.session_create?.session?.audio?.output;
                diagnose('session.config',{synthetic:providerKind!=='doubao',protocol:providerKind!=='doubao'?'synthetic':provider.profile?.realtime?.protocol===SEEDUPLEX_PROTOCOL?SEEDUPLEX_PROTOCOL:'reviewed_mapping',reply_policy_version:REPLY_POLICY_VERSION,input_rate:provider.audio.input_rate,output_rate:provider.audio.output_rate,frame_ms:provider.audio.frame_ms,speech_pace:provider.speechPace,speech_pace_supported:provider.profile?.realtime?.protocol===SEEDUPLEX_PROTOCOL,output_speed:output?.speed,speed_explicit:Number.isFinite(output?.speed),cancel_timeout_ms:cancelTimeoutMs,context_timeout_ms:contextTimeoutMs,ready_timeout_ms:readyTimeoutMs,grace_ms:outputGate?replyGraceMs:0,turn_wait_ms:outputGate?turnWaitMs:0});
                if(ready)diagnose('session.ready',{provider_ready:true,elapsed_ms:performance.now()-started});
              }
            }
            else if (value?.type==='response.cancel' && ready && Object.keys(value).every(k=>['type','response_id'].includes(k)) && (value.response_id===undefined || /^[a-zA-Z0-9_.:-]{1,128}$/.test(value.response_id))) interrupt(value.response_id);
            else throw new Error('INVALID_CONTROL');
          }
        } catch { finish('INVALID_CLIENT_MESSAGE'); }
      });
      try {
        provider = providerFactory(ticket);
        if(provider.speechStartKind==='asr_candidate')outputGate=new TurnOutputGate({send,fail:finish,observe:diagnose,graceMs:replyGraceMs,maxWaitMs:turnWaitMs});
        provider.open({sessionId:ticket.session_id,instructions:teaching.instructions(),onFailure:code=>finish(code),onEvent:packet=> {
          if (ended || restricted) return;
          if(packet.control==='user.speech.candidate') {
            if(!ready || !/^[a-zA-Z0-9_-]{1,128}$/.test(packet.turn_id??'') || runtime.finalTurns.has(packet.turn_id))return;
            const candidate=captureSpeech(packet.turn_id);outputGate?.candidate(packet.turn_id);
            diagnose('speech.candidate',{turn_id:packet.turn_id,response_id:candidate?.target,source:'asr_start'});return;
          }
          if(packet.control==='cancel.sent') {if(pendingCancel.get(packet.response_id)?.turn===packet.turn_id)cancelSent(packet.response_id);return;}
          if(packet.control==='cancel.skipped') {
            const pending=pendingCancel.get(packet.response_id);if(!pending || pending.turn!==packet.turn_id)return;
            clearTimeout(pending.timer);pendingCancel.delete(packet.response_id);
            diagnose('cancel.skipped',{response_id:packet.response_id,turn_id:packet.turn_id,reason:packet.reason,source:pending.source});
            completeStats(packet.response_id,'cancelled');flushContext();return;
          }
          if (packet.control==='user.speech.started') {diagnose('user.speech.started',{turn_id:packet.turn_id,source:'provider_speech_start',active:!!runtime.active});if(ready)interrupt(undefined,'provider_speech_start');return;}
          if(packet.control==='context.updated') {
            if(pendingContext && packet.version===pendingContext.version){clearTimeout(pendingContext.timer);appliedVersion=packet.version;pendingContext=null;diagnose('context.applied',{context_version:appliedVersion});send({type:'teaching.context.applied',version:appliedVersion});flushContext();}
            return;
          }
          if (!packet.event) return;
          const result = runtime.ingest(packet.event);
          if (!result.accepted) {
            diagnose('event.dropped',{response_id:packet.event.response_id,turn_id:packet.event.turn_id,reason:result.reason});
            metrics?.count(providerKind,'dropped_events');
            if (result.reason === 'event_limit' || result.reason === 'invalid_event') finish('PROVIDER_PROTOCOL_ERROR');
            return;
          }
          if (packet.event.type === 'session.ready') {ready=true;clearTimeout(readyTimer);metrics?.count(providerKind,'ready');metrics?.observe(providerKind,'ready_ms',performance.now()-started);}
          if(packet.event.type==='session.ready')diagnose('session.ready',{provider_ready:true,elapsed_ms:performance.now()-started});
          if (packet.event.type==='response.started'){lastResponse={id:packet.event.response_id,turn:packet.event.turn_id};policy.newResponse();replyAt=performance.now();firstAudio=false;}
          const event=packet.event,ids={response_id:event.response_id,turn_id:event.turn_id};
          if(event.type==='response.started') {
            replyStats.set(event.response_id,{at:performance.now(),turn:event.turn_id,chars:0,deltas:0,chunks:0,pcmMs:0,audit:diagnostics?new ReplyAudit():null});
            diagnose('response.started',{...ids,pending_context:!!pendingContext,pending_cancel:pendingCancel.size>0});
          }
          if(['user.partial','user.final'].includes(event.type))diagnose(event.type,{...ids,chars:Array.from(event.payload.text).length});
          const stats=replyStats.get(event.response_id);
          if(stats && event.type==='response.text.delta') {
            stats.chars+=Array.from(event.payload.text).length;stats.deltas++;
            stats.audit?.append(event.payload.text);
            if(stats.deltas===1)diagnose('response.first_text',{...ids,elapsed_ms:performance.now()-stats.at});
          }
          if(stats && event.type==='response.audio.chunk') {
            stats.chunks++;stats.pcmMs+=event.payload.byte_length/(packet.sample_rate??provider.audio.output_rate)/2*1000;
            if(stats.chunks===1)diagnose('response.first_audio',{...ids,elapsed_ms:performance.now()-stats.at});
          }
          if(event.type==='response.cancelled') {
            const pending=pendingCancel.get(event.response_id);
            if(pending?.sentAt!==undefined)diagnose('cancel.ack',{...ids,ack_ms:performance.now()-pending.sentAt});
            completeStats(event.response_id,'cancelled');
          }
          if(event.type==='response.done')completeStats(event.response_id,'done');
          if(['user.partial','user.final','response.text.delta'].includes(packet.event.type)) {
            const risk=policy.inspect(packet.event.payload.text,{output:packet.event.type==='response.text.delta'});
            if(risk.restricted){restrict(risk,packet.event);return;}
          }
          if(packet.event.type==='response.audio.chunk' && !firstAudio && replyAt!==null){firstAudio=true;metrics?.observe(providerKind,'first_audio_ms',performance.now()-replyAt);}
          if(outputGate && ['user.partial','user.final'].includes(event.type)) {
            if(event.type==='user.final' || !runtime.finalTurns.has(event.turn_id)) {
              const candidate=captureSpeech(event.turn_id);
              if(candidate && !candidate.confirmed && hasSpeechText(event.payload.text)) {
                if(!candidate.target && candidate.ownerTurn===undefined){const reply=runtime.active??lastResponse;if(reply?.turn!==event.turn_id)candidate.target=reply?.id;}
                candidate.confirmed=true;
                diagnose('speech.confirmed',{turn_id:event.turn_id,response_id:candidate.target,source:'asr_confirmed'});
                if(candidate.target)interrupt(candidate.target,'asr_confirmed');
              }
              outputGate.user(event);
            }
          }
          if (packet.event.type==='response.cancelled') {clearTimeout(pendingCancel.get(packet.event.response_id)?.timer);pendingCancel.delete(packet.event.response_id);}
          if(teaching.accept(packet.event))send({type:'teaching.state',...teaching.view()});
          const projected={type:'event',event:packet.event,audio:packet.audio,sample_rate:packet.sample_rate,provider_connected:ready && providerKind==='doubao',synthetic:providerKind!=='doubao'};
          if(outputGate && ['response.started','response.text.delta','response.audio.chunk','response.done'].includes(event.type))outputGate.push(projected);else send(projected);
          if(['response.done','response.cancelled'].includes(packet.event.type))flushContext();
        }});
        send({type:'session.config',session_id:ticket.session_id,audio:provider.audio,speech:{supported:provider.profile?.realtime?.protocol===SEEDUPLEX_PROTOCOL,pace:provider.speechPace??null,output_speed:provider.profile?.session_create?.session?.audio?.output?.speed??null},provider_connected:false,synthetic:providerKind!=='doubao'});
        send({type:'teaching.state',...teaching.view()});
      } catch { finish('PROVIDER_CONFIGURATION_ERROR'); }
    });
  });
  return {
    available:!!providerFactory,
    create({origin,mode,identity,speechPace}) {
      if (!providerFactory) return null;
      if (tickets.size+connections.size >= maxConnections) throw new Error('SESSION_CAPACITY');
      const token = randomUUID();
      const ticket = {session_id:randomUUID(),mode,speech_pace:speechPace,origin,identity,expires:Math.min(Date.now()+30000,identity.expires)};
      tickets.set(token,ticket);
      return {session_id:ticket.session_id,ticket:token,websocket_path:'/api/realtime',protocol:'ask-kai.v1',expires_in:30,provider_connected:false};
    },
    updateMemory(identity,memory) {for(const session of sessions.values())if(session.identity.owner_id===identity.owner_id && session.identity.learner_id===identity.learner_id){session.teaching.memory=structuredClone(memory);session.teaching.version++;session.flushContext();}},
    revoke(identity) {
      for(const [key,ticket] of tickets)if(ticket.identity.owner_id===identity.owner_id && ticket.identity.learner_id===identity.learner_id)tickets.delete(key);
      for(const session of sessions.values())if(session.identity.owner_id===identity.owner_id && session.identity.learner_id===identity.learner_id)session.finish('AUTHORIZATION_REVOKED');
    },
    close() {clearInterval(sweep);tickets.clear();for(const ws of connections)ws.terminate();wss.close();}
  };
}
