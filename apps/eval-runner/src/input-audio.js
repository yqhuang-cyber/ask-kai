import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SeeduplexProvider,validateSeeduplexProfile } from '../../../packages/provider-doubao/seeduplex.js';
import { PCMResampler } from '../../realtime-gateway/public/audio.js';
import { sha256 } from './multiturn-plan.js';
import { atomicPrivateJson } from './private-artifacts.js';

// A separate fixed-text TTS session creates an authored *student input* fixture.
// This audio is not an Agent reply, a real learner recording or a model score.
export async function synthesizeInput({text,profile,env=process.env,signal,timeoutMs=45000,socketFactory,protocolProbe=false}={}) {
  validateSeeduplexProfile(profile,{protocolProbe});
  if(typeof text!=='string'||!text.trim()||text.length>2000||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>120000)throw new Error('INVALID_TTS_INPUT');
  if(signal?.aborted)throw new Error('RUN_ABORTED');
  return await new Promise((resolve,reject)=>{
    let provider,owner=null,done=false,closing=false,total=0;
    const chunks=[],resampler=new PCMResampler(24000,16000);
    const finish=async(error)=>{
      if(done||closing)return;closing=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);
      let ack=false;try{ack=(await provider?.close())?.acknowledged===true;}catch{}
      done=true;
      if(error)return reject(new Error(error));
      if(!ack)return reject(new Error('TTS_CLOSE_ACK_MISSING'));
      const pcm=Buffer.concat(chunks);if(pcm.length<640||pcm.length>960000)return reject(new Error('TTS_AUDIO_BOUNDS'));
      resolve(pcm);
    };
    const abort=()=>void finish('RUN_ABORTED'),timer=setTimeout(()=>void finish('TTS_TIMEOUT'),timeoutMs);
    signal?.addEventListener('abort',abort,{once:true});
    try {
      provider=new SeeduplexProvider({profile,env,protocolProbe,...(socketFactory?{socketFactory}:{})});
      provider.open({sessionId:randomUUID(),instructions:'只合成指定的测试输入文本，不生成对话回答。',onFailure:()=>void finish('TTS_PROVIDER_FAILED'),onEvent:packet=>{
        if(done||closing)return;
        try {
          const e=packet.event;
          if(e?.type==='session.ready') {
            provider.send({type:'input_audio_mute.commit',event_id:randomUUID()});
            provider.send({type:'speech_text_buffer.commit',event_id:randomUUID(),text});
          }
          if(e?.type==='response.started'){if(owner!==null)throw new Error('TTS_MULTIPLE_REPLIES');owner=e.response_id;}
          if(e?.type==='response.audio.chunk') {
            if(e.response_id!==owner||packet.sample_rate!==24000||total+e.payload.byte_length>1440000)throw new Error('TTS_AUDIO_BOUNDS');
            const pcm=Buffer.from(packet.audio,'base64');total+=pcm.length;
            const samples=Float32Array.from({length:pcm.length/2},(_,i)=>{const v=pcm.readInt16LE(i*2);return v/(v<0?32768:32767);});
            chunks.push(Buffer.from(resampler.push(samples)));
          }
          if(e?.type==='response.done'){if(e.response_id!==owner)throw new Error('TTS_OWNER_MISMATCH');void finish();}
        }catch{void finish('TTS_OUTPUT_INVALID');}
      }});
    }catch{void finish('TTS_CONFIGURATION_FAILED');}
  });
}
export async function prepareInputAudio({cases,datasetSha256,profile,env,signal,directory,onProgress=()=>{},synthesize=synthesizeInput,timeoutMs=45000,protocolProbe=false}={}) {
  const manifest={version:1,kind:'ask-kai-eval-input-audio',dataset_sha256:datasetSha256,format:'pcm_s16le',sample_rate:16000,channels:1,
    status:'preparing',model:profile.session_create.session.model,voice:profile.session_create.session.audio.output.voice,profile_sha256:sha256(Buffer.from(JSON.stringify(profile))),entries:[]};
  const path=join(directory,'audio-manifest.json'),cache=new Map();
  await writeFile(path,JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
  try {
    for(const c of cases)for(const t of c.turns) {
      if(signal?.aborted)throw new Error('RUN_ABORTED');
      const script=sha256(Buffer.from(t.text));
      let entry=cache.get(script);
      if(!entry) {
        const bytes=await synthesize({text:t.text,profile,env,signal,timeoutMs,protocolProbe});
        const filename=`input-${script}.pcm`;
        await writeFile(join(directory,filename),bytes,{flag:'wx',mode:0o600});
        entry={path:filename,source:'authored_tts',script_sha256:script,sha256:sha256(bytes),bytes:bytes.length};cache.set(script,entry);
      }
      manifest.entries.push({case_id:c.id,turn:t.turn,...entry});
      await atomicPrivateJson(path,manifest);
      onProgress({case_id:c.id,turn:t.turn,state:'input_audio_prepared'});
    }
    manifest.status='prepared';
  }catch(error){manifest.status='partial';manifest.failure=/^[A-Z_]{1,80}$/.test(error.message)?error.message:'AUDIO_PREPARATION_FAILED';throw error;}
  finally{await atomicPrivateJson(path,manifest);}
  return manifest;
}
