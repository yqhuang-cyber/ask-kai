import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { readFile } from 'node:fs/promises';
import WebSocket from 'ws';
import { SeeduplexProvider, createDoubaoProvider, validateSeeduplexProfile } from '../packages/provider-doubao/seeduplex.js';
import { createGateway } from '../apps/realtime-gateway/src/server.js';
import { SessionRuntime } from '../packages/agent-core/session.js';
import { REPLY_INSTRUCTIONS } from '../packages/agent-core/reply-policy.js';
import { until } from './helpers/realtime.js';
const template = JSON.parse(await readFile(new URL('../docs/protocol/seeduplex-profile.template.json',import.meta.url),'utf8'));
function profile() {
  const p = structuredClone(template); p.reviewed = true; p.realtime.reviewed = true; p.realtime.ordered_acks_reviewed = true;
  return p; // Synthetic test attestation, never evidence about a real supplier account.
}
function setup() {
  const socket = new EventEmitter(), sent = [], packets = [], failures = [];
  Object.assign(socket,{readyState:1,bufferedAmount:0,send:v=>sent.push(JSON.parse(v)),terminate:()=>socket.ended=true});
  const provider = createDoubaoProvider({profile:profile(),env:{DOUBAO_API_KEY:'synthetic-only'},socketFactory:(_url,options)=>{
    assert.equal(options.headers['X-Api-Key'],'synthetic-only'); assert.equal(options.maxPayload,131072); return socket;
  }});
  provider.open({sessionId:'local-session',instructions:'trusted lesson',onEvent:p=>packets.push(p),onFailure:code=>failures.push(code)});
  socket.emit('open');
  let seq = 0;
  const wire = raw => socket.emit('message',Buffer.from(JSON.stringify({event_id:`wire-${++seq}`,...raw})),false);
  const ready = () => wire({type:'session.created',session:{id:'private-session'}});
  return {provider,socket,sent,packets,failures,wire,ready};
}
const output = (type,response='private-r1',question='private-q1',extra={})=>({type,response_id:response,question_id:question,...extra});

test('Seeduplex startup requires separate static and ACK review; output pcm is explicitly 16 bit',()=>{
  assert.throws(()=>validateSeeduplexProfile(template),/NOT_VERIFIED/);
  const ack = profile(); ack.realtime.ordered_acks_reviewed = false;
  assert.throws(()=>validateSeeduplexProfile(ack),/ACK_REVIEW_REQUIRED/);
  const audio = profile(); audio.session_create.session.audio.output.format.type = 'pcm';
  assert.throws(()=>validateSeeduplexProfile(audio),/AUDIO/);
  const tools = profile(); tools.session_create.session.tools = [{name:'unexpected'}];
  assert.throws(()=>validateSeeduplexProfile(tools),/UNREVIEWED/);
  const x = setup(); assert.ok(x.provider instanceof SeeduplexProvider);
  assert.equal(x.sent[0].session.instructions,'trusted lesson');
  assert.equal(x.sent[0].session.audio.output.format.type,'pcm_s16le');
  x.provider.close();
});
test('text before audio starts a response once; ASR deltas accumulate and final alone forms an attempt',()=>{
  const x = setup(), runtime = new SessionRuntime('local-session'); x.ready();
  x.wire({type:'conversation.item.input_audio_transcription.started',item_id:'private-q1'});
  x.wire({type:'conversation.item.input_audio_transcription.delta',item_id:'private-q1',delta:'我喜欢'});
  x.wire({type:'conversation.item.input_audio_transcription.delta',item_id:'private-q1',delta:'足球'});
  x.wire(output('response.output_text.delta',undefined,undefined,{delta:'你喜欢足球。'}));
  x.wire(output('response.output_audio.started'));
  x.wire(output('response.output_audio.delta',undefined,undefined,{delta:Buffer.alloc(960).toString('base64')}));
  x.wire({type:'conversation.item.input_audio_transcription.completed',item_id:'private-q1',transcript:'我喜欢足球'});
  x.wire(output('response.done'));
  for (const p of x.packets) if (p.event) assert.equal(runtime.ingest(p.event).accepted,true);
  assert.deepEqual(x.packets.filter(p=>p.event?.type==='user.partial').map(p=>p.event.payload.text),['我喜欢','我喜欢足球']);
  assert.equal(x.packets.filter(p=>p.event?.type==='response.started').length,1);
  assert.equal(runtime.evidence.length,1); assert.equal(runtime.evidence[0].kind,'attempted');
  const audio = x.packets.find(p=>p.audio); assert.equal(audio.sample_rate,24000); assert.equal(audio.event.payload.byte_length,960);
  assert.ok(!JSON.stringify(x.packets).includes('private-')); assert.deepEqual(x.failures,[]);
  x.provider.sendAudio(Buffer.alloc(640)); assert.equal(x.sent.at(-1).type,'input_audio_buffer.append');
  x.provider.close(); assert.equal(x.sent.at(-1).type,'session.close');
});
test('audio completion alone does not finish the interaction; completed text contributes only its suffix',()=>{
  const x = setup(); x.ready();
  x.wire(output('response.output_audio.started'));
  x.wire(output('response.output_text.delta',undefined,undefined,{delta:'你好'}));
  x.wire(output('response.output_audio.done'));
  assert.equal(x.packets.filter(p=>p.event?.type==='response.done').length,0);
  x.wire(output('response.output_text.done',undefined,undefined,{text:'你好！'}));
  assert.deepEqual(x.packets.filter(p=>p.event?.type==='response.text.delta').map(p=>p.event.payload.text),['你好','！']);
  x.wire(output('response.done')); x.wire(output('response.output_text.delta',undefined,undefined,{delta:'迟到'}));
  assert.equal(x.packets.filter(p=>p.event?.type==='response.started').length,1);
  assert.ok(!JSON.stringify(x.packets).includes('迟到')); x.provider.close();
});
test('cancel uses official simple request; sole pending ACK preserves newer response and old output is fenced',()=>{
  const x = setup(); x.ready(); x.wire(output('response.output_text.delta',undefined,undefined,{delta:'旧回复'}));
  const old = x.packets.find(p=>p.event?.type==='response.started').event;
  x.provider.cancel(old.response_id);
  assert.deepEqual(Object.keys(x.sent.at(-1)).sort(),['event_id','type']);
  x.wire(output('response.output_text.delta',undefined,undefined,{delta:'迟到旧回复'}));
  x.wire(output('response.output_text.delta','private-r2','private-q2',{delta:'新回复'}));
  x.wire({type:'response.canceled',event_id:'cancel-ack-1'});
  const ack = x.packets.find(p=>p.event?.type==='response.cancelled').event;
  assert.equal(ack.response_id,old.response_id); assert.notEqual(x.provider.activeReply.id,old.response_id);
  x.wire(output('response.output_audio.delta',undefined,undefined,{delta:'AAAAAA=='}));
  assert.ok(!x.packets.some(p=>p.audio)); assert.ok(!JSON.stringify(x.packets).includes('迟到旧回复'));
  assert.deepEqual(x.failures,[]); x.provider.close();
});
test('context ACK is session-bound, serialized and deduplicated; no invented version field goes over wire',()=>{
  const x = setup(); x.ready(); x.provider.updateContext({instructions:'lesson two',version:2});
  const update = x.sent.at(-1); assert.equal(update.type,'session.update'); assert.equal(update.session.id,'private-session');
  assert.ok(!Object.hasOwn(update,'version')); assert.ok(!Object.hasOwn(update.session,'version'));
  assert.throws(()=>x.provider.updateContext({instructions:'overlap',version:3}),/CONTROL_PENDING/);
  x.wire({type:'session.updated',session:{id:'private-session'},event_id:'context-ack-1'});
  assert.equal(x.packets.at(-1).version,2);
  x.provider.updateContext({instructions:'lesson three',version:3});
  x.wire({type:'session.updated',session:{id:'private-session'},event_id:'context-ack-1'});
  assert.equal(x.provider.pendingControl.version,3);
  x.wire({type:'session.updated',session:{id:'another-session'}});
  assert.deepEqual(x.failures,['PROVIDER_PROTOCOL_ERROR']); x.provider.close();
});
test('missing/foreign ownership, unsolicited controls, bad audio and wire errors are masked',()=>{
  const cases = [
    {type:'response.done'}, {type:'session.updated',session:{id:'private-session'}}, {type:'response.canceled'},
    output('response.output_audio.delta',undefined,undefined,{delta:'***'}),
    {type:'error',error:{message:'private-error synthetic-only'}}
  ];
  for (const raw of cases) { const x = setup(); x.ready(); x.wire(raw); assert.deepEqual(x.failures,['PROVIDER_PROTOCOL_ERROR']); assert.ok(!JSON.stringify(x.failures).includes('private-')); x.provider.close(); }
});
test('request budget and input framing remain bounded; wire duplicates cannot repeat final student evidence',()=>{
  const x = setup(); assert.throws(()=>x.provider.sendAudio(Buffer.alloc(640)),/INPUT_AUDIO/); x.ready();
  for (const size of [0,1,642]) assert.throws(()=>x.provider.sendAudio(Buffer.alloc(size)),/INPUT_AUDIO/);
  const final = {type:'conversation.item.input_audio_transcription.completed',item_id:'private-q1',transcript:'我喜欢足球',event_id:'final-1'};
  x.wire(final); x.wire(final); x.wire({...final,event_id:'final-2'});
  assert.equal(x.packets.filter(p=>p.event?.type==='user.final').length,1);
  x.provider.close(); const before = x.packets.length; x.wire({type:'session.created',session:{id:'late-session'}}); assert.equal(x.packets.length,before);
});
test('Seeduplex wire events integrate through browser WSS and teaching context ACK (synthetic peer only)',async t=>{
  let wire, sent = [];
  const server = createGateway({providerKind:'test',providerFactory:()=>{
    const socket = new EventEmitter(); Object.assign(socket,{readyState:1,bufferedAmount:0,send:v=>sent.push(JSON.parse(v)),terminate:()=>{}});
    const p = new SeeduplexProvider({profile:profile(),env:{DOUBAO_API_KEY:'synthetic-only'},socketFactory:()=>socket});
    const open = p.open.bind(p); p.open = options=>{open(options);socket.emit('open');};
    let seq = 0; wire = raw=>socket.emit('message',Buffer.from(JSON.stringify({event_id:`w-${++seq}`,...raw})),false);
    return p;
  }});
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  t.after(()=>new Promise(resolve=>{server.stopRealtime();server.close(resolve);server.closeAllConnections();}));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const res = await fetch(origin+'/api/sessions',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({mode:'sports'})});
  assert.equal(res.status,201); const ticket = await res.json();
  const ws = new WebSocket(origin.replace('http:','ws:')+'/api/realtime',['ask-kai.v1',`ticket.${ticket.ticket}`],{origin}), packets = [];
  ws.on('message',b=>packets.push(JSON.parse(b.toString()))); await once(ws,'open');
  assert.ok(sent.find(e=>e.type==='session.create').session.instructions.includes(REPLY_INSTRUCTIONS));
  wire({type:'session.created',session:{id:'private-session'}});
  wire({type:'conversation.item.input_audio_transcription.completed',item_id:'private-q1',transcript:'我喜欢足球'});
  wire(output('response.output_text.delta',undefined,undefined,{delta:'很好！'})); wire(output('response.done'));
  await until(()=>sent.some(e=>e.type==='session.update'));
  assert.ok(sent.find(e=>e.type==='session.update').session.instructions.includes(REPLY_INSTRUCTIONS));
  wire({type:'session.updated',session:{id:'private-session'}});
  await until(()=>packets.some(e=>e.type==='teaching.context.applied'));
  assert.equal(packets.filter(e=>e.type==='teaching.state').at(-1).attempts[0].kind,'attempted');
  assert.ok(packets.every(p=>p.synthetic!==false)); ws.close(); await once(ws,'close');
});
