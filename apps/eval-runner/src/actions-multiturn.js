import { join } from 'node:path';
import { preflight } from '../../../packages/provider-doubao/probe.js';
import { validateSeeduplexProfile } from '../../../packages/provider-doubao/seeduplex.js';
import { selectCases,readAudioManifest,sha256 } from './multiturn-plan.js';
import { prepareInputAudio } from './input-audio.js';
import { runMultiturn,writeRunCheckpoint } from './multiturn.js';

// Fixed, bounded trial on authored scripts. The same probe-only attestation as
// the live adapter smoke never becomes an ordinary Web/CLI runtime profile.
export function validateActionsTrial({profile,request,data,datasetSha256,env={}}) {
  if(request?.version!==1||request.kind!=='doubao_multiturn_trial'||
    !/^multiturn-\d{4}-\d{2}-\d{2}-\d{2}$/.test(request.request_id??'')||
    request.profile_sha256!==sha256(Buffer.from(JSON.stringify(profile)))||request.dataset_sha256!==datasetSha256||
    request.case_id!=='ask-kai-v2-001'||request.expected_turns!==4||request.duration_ms!==300000||
    Object.keys(request).some(k=>!['version','kind','request_id','profile_sha256','dataset_sha256','case_id','expected_turns','duration_ms'].includes(k))||
    profile.review_scope!=='static_session_connect_only'||profile.realtime?.reviewed!==false||profile.realtime?.ordered_acks_reviewed!==false||
    profile.auth?.env!=='DOUBAO_API_KEY'||env.GITHUB_REF!=='refs/heads/main'||!/^[a-f0-9]{40}$/.test(env.GITHUB_SHA??''))throw new Error('INVALID_MULTITURN_TRIAL_REQUEST');
  const cases=selectCases(data,{caseIds:[request.case_id]});
  if(cases.length!==1||cases[0].entry!=='free'||cases[0].turns.length!==request.expected_turns)throw new Error('INVALID_MULTITURN_TRIAL_CASE');
  const scoped=structuredClone(profile);
  scoped.realtime={...scoped.realtime,reviewed:true,ordered_acks_reviewed:true,review_scope:'protocol_smoke'};
  validateSeeduplexProfile(scoped,{protocolProbe:true});
  return {cases,scoped,credentialReady:preflight(profile,env).live_eligible};
}
export async function runActionsTrial({profile,request,data,datasetSha256,env={},signal,directory,
  prepare=prepareInputAudio,collect=runMultiturn,readInputs=readAudioManifest,onProgress=()=>{}}) {
  const {cases,scoped,credentialReady}=validateActionsTrial({profile,request,data,datasetSha256,env});
  const report={version:1,kind:'ask-kai-actions-multiturn-trial',request_id:request.request_id,
    case_id:request.case_id,expected_turns:4,candidate_revision:env.GITHUB_SHA,dataset_sha256:datasetSha256,
    profile_sha256:request.profile_sha256,input_source:'authored_tts',business_source:'mock_hskai',
    protocol_probe:true,runtime_profile_scope:'protocol_smoke',web_profile_enabled:false,
    content_scored:false,judge_calls:0,microphone_uploaded:false,browser_audio_tested:false,real_experience_accepted:false,
    input_audio_prepared_turns:0,status:'running',phase:'preflight',failure:null};
  if(!credentialReady)return {...report,status:'blocked',failure:'SERVER_CREDENTIAL_REQUIRED'};
  const boundedSignal=AbortSignal.any([AbortSignal.timeout(request.duration_ms),...(signal?[signal]:[])]);
  try {
    if(boundedSignal.aborted)throw new Error('RUN_ABORTED');
    report.phase='prepare_authored_input_audio';
    const manifest=await prepare({cases,datasetSha256,profile:scoped,env,signal:boundedSignal,directory,
      timeoutMs:45000,protocolProbe:true,onProgress:row=>{
        if(row.state==='input_audio_prepared')report.input_audio_prepared_turns++;
        onProgress(row);
      }});
    report.input_audio_prepared_turns=manifest.entries.length;
    const audio=await readInputs(join(directory,'audio-manifest.json'),cases,{datasetSha256});
    report.phase='collect_actual_agent_replies';
    const result=await collect({cases,inputs:audio.inputs,profile:scoped,env,signal:boundedSignal,
      candidateRevision:env.GITHUB_SHA,datasetVersion:data.dataset_version,datasetSha256,manifestSha256:audio.manifest_sha256,
      turnTimeoutMs:45000,protocolProbe:true,onProgress,checkpoint:(o,r)=>writeRunCheckpoint(directory,o,r)});
    report.collection=result.report;report.status=result.report.status;report.phase='finished';
  }catch(error){report.status='failed';report.failure=/^[A-Z_]{1,80}$/.test(error.message)?error.message:'MULTITURN_TRIAL_FAILED';}
  return report;
}
