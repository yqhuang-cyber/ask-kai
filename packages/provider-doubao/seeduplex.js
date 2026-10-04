import { randomUUID } from 'node:crypto';
import { DoubaoJsonTransport, ReviewedDoubaoProvider, validateRealtimeProfile } from './realtime.js';
import { validateProfile } from './probe.js';

export const SEEDUPLEX_PROTOCOL = 'seeduplex-1.2.6.1';
export const SEEDUPLEX_SOURCE = 'https://docs.volcengine.com/docs/DoubaoVoice/endtoend-realtime-voice-full-duplex-version?lang=zh';
export function validateSeeduplexProfile(profile) {
  validateProfile(profile);
  const rt = profile.realtime, session = profile.session_create.session;
  if (!profile.reviewed || !rt?.reviewed || rt.protocol !== SEEDUPLEX_PROTOCOL || profile.evidence_source !== SEEDUPLEX_SOURCE || rt.evidence_source !== SEEDUPLEX_SOURCE) throw new Error('DOUBAO_PROTOCOL_NOT_VERIFIED');
  if (profile.auth.header !== 'X-Api-Key' || profile.auth.prefix !== '' || profile.ready.type !== 'session.created' || profile.ready.session_id_path !== 'session.id') throw new Error('INVALID_SEEDUPLEX_MAPPING');
  if (session.model !== '1.2.6.1' || session.audio?.input?.format?.type !== 'pcm' || session.audio.input.format.rate !== 16000 || session.audio?.output?.format?.type !== 'pcm_s16le' || session.audio.output.format.rate !== 24000 || !/^[a-zA-Z0-9_-]{1,128}$/.test(session.audio.output.voice ?? '')) throw new Error('UNSUPPORTED_REVIEWED_AUDIO');
  if (rt.audio?.encoding !== 'pcm_s16le' || rt.audio.input_rate !== 16000 || rt.audio.output_rate !== 24000 || rt.audio.frame_ms !== 20 || rt.initial_instructions !== 'session.instructions') throw new Error('UNSUPPORTED_REVIEWED_AUDIO');
  // The PDF identifies ACK types, but does not prove their ordering/identity on an account.
  // Do not enable this policy solely because the static mapping has been reviewed.
  if (rt.ordered_acks_reviewed !== true) throw new Error('SEEDUPLEX_ACK_REVIEW_REQUIRED');
  if (session.id !== undefined || session.tools?.length || profile.session_create.extension !== undefined) throw new Error('UNREVIEWED_SEEDUPLEX_FEATURE');
  return profile;
}
export function validateDoubaoRealtimeProfile(profile) {
  return profile.realtime?.protocol === SEEDUPLEX_PROTOCOL ? validateSeeduplexProfile(profile) : validateRealtimeProfile(profile);
}
export function createDoubaoProvider(options) {
  return options.profile.realtime?.protocol === SEEDUPLEX_PROTOCOL ? new SeeduplexProvider(options) : new ReviewedDoubaoProvider(options);
}

/** Wire names/fields come from the supplied PDF and its official Go/Python demos.
 * All tests use authored synthetic payloads; unsupported/ambiguous ownership fails closed.
 */
export class SeeduplexProvider extends DoubaoJsonTransport {
  constructor(options) {
    validateSeeduplexProfile(options.profile);
    super(options);
    this.wireSeen = new Set(); this.turns = new Map(); this.replies = new Map();
    this.activeReply = null; this.pendingControl = null; this.ready = false;
  }
  text(value) {
    if (typeof value !== 'string' || !value.length || value.length > 2000) throw new Error('INVALID_PROVIDER_TEXT');
    return value;
  }
  turn(rawId) {
    const id = this.id(`turn:${this.checkId(rawId)}`);
    if (!this.turns.has(id)) this.turns.set(id,{id,text:'',final:false,started:false});
    return this.turns.get(id);
  }
  checkId(value) {
    if (typeof value !== 'string' || !value.length || value.length > 120) throw new Error('INVALID_PROVIDER_ID');
    return value;
  }
  reply(raw,create=false) {
    const rawId = this.checkId(raw.response_id);
    const id = this.id(`reply:${rawId}`);
    let reply = this.replies.get(id);
    if (!reply) {
      if (!create) throw new Error('UNBOUND_PROVIDER_RESPONSE');
      if (this.activeReply) throw new Error('OVERLAPPING_PROVIDER_RESPONSE');
      const turn = this.turn(raw.question_id);
      reply = {id,rawId,turn:turn.id,status:'active',text:''};
      this.replies.set(id,reply); this.activeReply = reply;
      this.onEvent({event:this.event('response.started',{},this.replyIds(reply))});
    } else if (raw.question_id !== undefined && this.turn(raw.question_id).id !== reply.turn) throw new Error('FOREIGN_PROVIDER_TURN');
    return reply;
  }
  replyIds(reply) { return {turn_id:reply.turn,response_id:reply.id}; }
  emitReply(type,reply,payload={},extra={}) {
    this.onEvent({event:this.event(type,payload,this.replyIds(reply)),...extra});
  }
  receive(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('INVALID_PROVIDER_EVENT');
    if (raw.event_id !== undefined) {
      this.checkId(raw.event_id);
      if (this.wireSeen.has(raw.event_id)) return;
      if (this.wireSeen.size >= 10000) throw new Error('PROVIDER_EVENT_LIMIT');
      this.wireSeen.add(raw.event_id);
    }
    if (raw.type === 'error') throw new Error('PROVIDER_REPORTED_ERROR');
    if (raw.type === 'session.created') {
      if (this.ready) throw new Error('DUPLICATE_PROVIDER_READY');
      this.rawSessionId = this.checkId(raw.session?.id); this.ready = true;
      return this.onEvent({event:this.event('session.ready')});
    }
    if (!this.ready) throw new Error('PROVIDER_EVENT_BEFORE_READY');
    if (raw.type === 'session.closed') throw new Error('PROVIDER_SESSION_CLOSED');
    if (raw.type === 'session.updated') {
      const pending = this.pendingControl;
      if (!pending || pending.kind !== 'context' || raw.session?.id !== this.rawSessionId || raw.event_id === undefined) throw new Error('UNBOUND_CONTEXT_ACK');
      this.pendingControl = null;
      return this.onEvent({control:'context.updated',version:pending.version});
    }
    if (raw.type === 'response.canceled') {
      const pending = this.pendingControl;
      if (!pending || pending.kind !== 'cancel' || raw.event_id === undefined || (raw.response_id !== undefined && raw.response_id !== pending.reply.rawId)) throw new Error('UNBOUND_CANCEL_ACK');
      this.pendingControl = null; pending.reply.status = 'cancelled';
      return this.emitReply('response.cancelled',pending.reply);
    }
    if (raw.type.startsWith('conversation.item.input_audio_transcription.')) {
      if (!['started','delta','completed','failed'].some(s=>raw.type.endsWith(`.${s}`))) return;
      const turn = this.turn(raw.item_id);
      if (turn.final) return;
      if (raw.type.endsWith('.started')) {
        if (turn.started) return;
        turn.started = true;
        return this.onEvent({control:'user.speech.started',turn_id:turn.id});
      }
      if (raw.type.endsWith('.failed')) throw new Error('PROVIDER_ASR_FAILED');
      if (raw.type.endsWith('.delta')) {
        turn.text = this.text(turn.text + this.text(raw.delta));
        return this.onEvent({event:this.event('user.partial',{text:turn.text},{turn_id:turn.id})});
      }
      const text = this.text(raw.transcript); turn.final = true; turn.text = '';
      return this.onEvent({event:this.event('user.final',{text},{turn_id:turn.id})});
    }
    if (['response.output_text.delta','response.output_text.done','response.output_audio.started','response.output_audio.delta','response.output_audio.done','response.done'].includes(raw.type)) {
      const reply = this.reply(raw,raw.type !== 'response.done');
      if (reply.status !== 'active') return; // cancelled/completed IDs cannot reopen
      if (raw.type === 'response.output_text.delta') {
        const text = this.text(raw.delta);
        if (reply.text.length + text.length > 4000) throw new Error('PROVIDER_TEXT_LIMIT');
        reply.text += text;
        return this.emitReply('response.text.delta',reply,{text});
      }
      if (raw.type === 'response.output_text.done') {
        // Never repeat a complete transcript as a new delta. Emit only an exact suffix.
        const text = this.text(raw.text);
        if (!text.startsWith(reply.text)) throw new Error('PROVIDER_TEXT_REWRITE');
        const suffix = text.slice(reply.text.length); reply.text = text;
        if (suffix) return this.emitReply('response.text.delta',reply,{text:suffix});
        return;
      }
      if (raw.type === 'response.output_audio.delta') {
        if (typeof raw.delta !== 'string' || raw.delta.length > 87384 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(raw.delta)) throw new Error('INVALID_PROVIDER_AUDIO');
        const bytes = Buffer.from(raw.delta,'base64');
        if (!bytes.length || bytes.length > 65536 || bytes.length % 2) throw new Error('INVALID_PROVIDER_AUDIO');
        return this.emitReply('response.audio.chunk',reply,{byte_length:bytes.length,format:'pcm_s16le'},{audio:raw.delta,sample_rate:24000});
      }
      if (raw.type === 'response.done') {
        reply.status = 'done'; reply.text = ''; this.activeReply = null;
        return this.emitReply('response.done',reply);
      }
      // audio.done is an audio boundary, not the end of the whole interaction.
      return;
    }
    if (raw.type === 'response.function_call_arguments.done') throw new Error('UNEXPECTED_PROVIDER_TOOL');
  }
  sendAudio(bytes) {
    if (!this.ready || !bytes.length || bytes.length % 2 || bytes.length > 640) throw new Error('INVALID_INPUT_AUDIO');
    this.send({type:'input_audio_buffer.append',audio:Buffer.from(bytes).toString('base64')});
  }
  cancel(responseId) {
    if (this.pendingControl) throw new Error('PROVIDER_CONTROL_PENDING');
    const reply = this.replies.get(responseId);
    if (!reply || reply.status !== 'active' || this.activeReply !== reply) throw new Error('UNKNOWN_RESPONSE');
    this.pendingControl = {kind:'cancel',reply}; reply.status = 'cancel_pending'; this.activeReply = null;
    this.send({type:'response.cancel',event_id:randomUUID()});
  }
  updateContext({instructions,version}) {
    if (!this.ready || this.pendingControl || this.activeReply || typeof instructions !== 'string' || instructions.length > 16000 || !Number.isSafeInteger(version) || version < 1) throw new Error('PROVIDER_CONTROL_PENDING');
    this.pendingControl = {kind:'context',version};
    this.send({type:'session.update',event_id:randomUUID(),session:{id:this.rawSessionId,instructions}});
  }
  close() {
    if (this.closed) return;
    try { if (this.ready) this.send({type:'session.close',event_id:randomUUID()}); } catch {}
    super.close(); this.turns.clear(); this.replies.clear(); this.wireSeen.clear(); this.pendingControl = null;
  }
}
