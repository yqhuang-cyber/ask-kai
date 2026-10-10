import { chromium } from 'playwright';
import { EventEmitter, once } from 'node:events';
import { mkdir, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createGateway } from '../apps/realtime-gateway/src/server.js';
import { createDoubaoProvider } from '../packages/provider-doubao/seeduplex.js';
import { startMockBackend } from '../apps/hskai-mock/src/backend.js';
import { summaryFixture } from '../tests/helpers/summary.js';
const server=createGateway({paceMs:1});server.listen(0,'127.0.0.1');await once(server,'listening');
const servers=[server];
const backends=[];
let browser;
try {
  browser=await chromium.launch({headless:true,executablePath:process.env.ASK_KAI_BROWSER_EXECUTABLE,args:['--no-sandbox','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required']});
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=> {window.microphoneRequests=0;const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async(...args)=>{window.microphoneRequests++;return original(...args);};});
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  assert.equal(await page.locator('#diagnostics').isVisible(),false);
  assert.equal(await page.locator('#session-summary').isVisible(),false);
  await page.getByText('当前服务暂不支持选择语速。',{exact:true}).waitFor();assert.equal(await page.locator('#speech-pace').isDisabled(),true);
  await page.getByRole('button',{name:'自由聊天',exact:true}).click();assert.match(await page.locator('#goal').textContent(),/感兴趣/);
  await page.getByRole('button',{name:'运动主题',exact:true}).click();assert.match(await page.locator('#goal').textContent(),/我喜欢/);
  assert.equal(await page.locator('[data-mode=mission]').isDisabled(),true);
  await page.locator('#connect').click();await page.getByText('实时语音尚未开通。需完成豆包协议和服务端连接验证。',{exact:true}).waitFor();
  assert.equal(await page.locator('#connection-status').textContent(),'未连接');assert.equal(await page.evaluate(()=>window.microphoneRequests),0);
  assert.equal(await page.locator('[data-mode=mission]').isDisabled(),true);
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await mkdir('.local/browser-check',{recursive:true});await page.screenshot({path:'.local/browser-check/mobile.png',fullPage:true});
  await page.setViewportSize({width:1280,height:900});await page.screenshot({path:'.local/browser-check/desktop.png',fullPage:true});
  await page.goto(`http://127.0.0.1:${server.address().port}/?diagnostics=1`);
  await page.waitForFunction(()=>document.querySelector('#diagnostic-case').options.length===10);
  await page.locator('#diagnostics summary').click();await page.locator('#diagnostic-case').selectOption('E01');
  await page.locator('#connect').click();await page.getByText('实时语音尚未开通。需完成豆包协议和服务端连接验证。',{exact:true}).waitFor();
  const downloaded=page.waitForEvent('download');await page.locator('#diagnostic-export').click();
  const download=await downloaded;assert.equal(download.suggestedFilename(),'ask-kai-baseline-E01.json');
  const stream=await download.createReadStream(),chunks=[];for await(const chunk of stream)chunks.push(chunk);
  const report=JSON.parse(Buffer.concat(chunks).toString());assert.equal(report.kind,'not_connected');assert.equal(report.real_experience_accepted,false);assert.equal(report.case_id,'E01');
  assert.equal(await page.evaluate(()=>window.microphoneRequests),0);
  // Exercise actual native AudioWorklet/AudioContext with Chromium's synthetic device, independently of provider readiness.
  await page.evaluate(async()=> {
    const {AudioIO}=await import('/audio.js');window.framesObserved=[];
    const {ExperienceTrace}=await import('/diagnostics.js');window.audioTrace=new ExperienceTrace();window.audioTrace.gateway({name:'session.config',at_ms:0,fields:{synthetic:true}});
    window.audioFailure=null;window.testAudio=new AudioIO({onFrame:bytes=>window.framesObserved.push(bytes.length),onFailure:error=>window.audioFailure=error,onObserve:(name,fields)=>window.audioTrace.record(name,fields)});
    await window.testAudio.prepare();await window.testAudio.start({input_rate:16000,output_rate:24000});
  });
  await page.waitForFunction(()=>window.framesObserved.length>=6);
  assert.equal(await page.evaluate(()=>window.framesObserved.every(size=>size===640)),true);
  // Production caption module + native playback clock; authored text/silent PCM
  // are a synthetic fixture, never a provider-ready or listening-quality result.
  const fixtureFrames=await page.evaluate(async()=> {
    const {Presentation}=await import('/presentation.js');
    window.captionFixtureText='你好。 Hello. 我喜欢足球。 I like football.';window.captionReveals=[];
    window.captionFixture=new Presentation({render:(text,parts)=>{
      window.captionReveals.push({text,current:parts.current,at:performance.now()});
      const caption=document.querySelector('#caption');caption.replaceChildren();
      const previous=document.createElement('span');previous.textContent=parts.previous;previous.className='caption-previous';caption.append(previous);
      if(parts.current){const active=document.createElement('strong');active.textContent=parts.current;active.className='caption-current';caption.append(active);}
    },play:(pcm,rate,id)=>window.testAudio.play(pcm,rate,id),stopAudio:()=>window.testAudio.stopPlayback(),
      getPlayback:id=>window.testAudio.playback(id),onObserve:(name,fields)=>window.audioTrace.record(name,fields)});
    window.captionFixture.begin('synthetic-caption');window.captionFixture.append('synthetic-caption',window.captionFixtureText);
    const pcm=btoa(String.fromCharCode(...new Uint8Array(28800))); // 600ms @ 24kHz
    for(let i=0;i<4;i++)window.captionFixture.audio('synthetic-caption',pcm,24000);
    window.captionFixture.done('synthetic-caption');
    if(document.querySelector('#caption').textContent!=='')throw new Error('CAPTION_BURST');
    return window.framesObserved.length;
  });
  await page.waitForFunction(()=>window.captionFixture.visible.length>0);
  assert.equal(await page.evaluate(()=>window.captionFixture.visible.length<window.captionFixtureText.length),true);
  assert.equal(await page.locator('#caption .caption-current').count(),1);
  const pausedText=await page.evaluate(async()=>{await window.testAudio.context.suspend();return window.captionFixture.visible;});
  await page.waitForFunction(()=>window.captionFixture.mode==='paused');
  await page.waitForTimeout(420);assert.equal(await page.evaluate(()=>window.captionFixture.visible),pausedText);
  await page.evaluate(()=>window.testAudio.context.resume());
  await page.waitForFunction(()=>window.captionFixture.mode==='complete');
  assert.equal(await page.evaluate(()=>window.captionFixture.visible===window.captionFixtureText),true);
  assert.equal(await page.evaluate(()=>window.framesObserved.length>window.captionReveals.length && window.framesObserved.length>0),true);
  assert.ok(await page.evaluate(()=>window.framesObserved.length)>fixtureFrames+5);
  const reveals=await page.evaluate(()=>window.captionReveals.filter(r=>r.current));assert.equal(reveals.length,4);
  assert.ok(reveals.slice(1).every((r,i)=>r.at-reveals[i].at>=310));
  await page.locator('#subtitle-size').selectOption('large');assert.equal(await page.locator('#caption').evaluate(el=>getComputedStyle(el).fontSize),'25px');
  await page.locator('#show-subtitles').uncheck();assert.equal(await page.locator('#caption').isVisible(),false);assert.equal(await page.locator('#caption-hint').isVisible(),false);
  await page.locator('#show-subtitles').check();assert.equal(await page.locator('#caption').isVisible(),true);
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:'.local/browser-check/captions-mobile.png',fullPage:true});await page.setViewportSize({width:1280,height:900});
  await page.evaluate(()=>window.captionFixture.reset());
  const before=await page.evaluate(()=>{window.testAudio.play(btoa(String.fromCharCode(...new Uint8Array(640))),16000);window.testAudio.mute(true);window.testAudio.stopPlayback();return window.framesObserved.length;});
  await page.waitForFunction(count=>window.framesObserved.length>count+5,before);
  await page.waitForFunction(()=>window.audioTrace.rows.some(r=>r.name==='audio.capture.progress'));
  await page.evaluate(async()=>{await window.testAudio.close();await window.testAudio.close();});
  assert.equal(await page.evaluate(()=>window.audioFailure),null);
  const audioReport=await page.evaluate(()=>window.audioTrace.snapshot());assert.equal(audioReport.kind,'synthetic');
  assert.ok(audioReport.timeline.some(r=>r.name==='audio.capture.started'));assert.ok(audioReport.timeline.some(r=>r.name==='audio.stopped'));assert.equal(audioReport.contains_audio,false);
  assert.ok(audioReport.timeline.some(r=>r.name==='caption.playback' && r.played_pcm_ms>0));
  assert.equal(JSON.stringify(audioReport).includes('我喜欢足球'),false);
  // Real summary builder and production DOM renderer, authored synthetic data.
  // This fixture does not activate the app's provider or microphone path.
  await page.evaluate(async()=> {
    const {SummaryCards}=await import('/summary-cards.js');window.summaryRestarts=0;
    window.summaryFixture=new SummaryCards({root:document.querySelector('#session-summary'),link:document.querySelector('#summary-jump'),onRestart:()=>window.summaryRestarts++});
  });
  const showSummary=async packet=>page.evaluate(packet=> {
    window.summaryFixture.begin(packet.session_id,packet.summary.mode);
    if(!window.summaryFixture.accept(packet))throw new Error('SUMMARY_FIXTURE_REJECTED');
    if(!document.querySelector('#session-summary').hidden)throw new Error('SUMMARY_RENDERED_BEFORE_END');
    window.summaryFixture.finish();
  },packet);
  for(const mode of ['sports','mission','free']) {
    const packet=summaryFixture({mode,sessionId:`browser-${mode}`});await showSummary(packet);
    assert.equal(await page.locator('#session-summary .summary-card').count(),1);
    assert.equal(await page.locator('#session-summary h3').first().textContent(),'我喜欢足球');
    assert.match(await page.locator('#session-summary .pinyin').textContent(),/wǒ xǐ huān zú qiú/);
    assert.equal(await page.locator('#session-summary .summary-card [lang=en]').textContent(),'I like football.');
    assert.match(await page.locator('#session-summary .summary-label').textContent(),/表达尝试 · 1 次/);
    assert.equal(await page.locator('#session-summary .summary-review').count(),1);
    assert.match(await page.locator('#session-summary').textContent(),/工程测试数据/);
    assert.ok(!(await page.locator('#session-summary').textContent()).includes(packet.session_id));
    assert.equal(await page.evaluate(()=>window.summaryFixture.accept({type:'teaching.summary',session_id:'foreign'})),false);
  }
  await page.locator('#session-summary .summary-restart').click();assert.equal(await page.evaluate(()=>window.summaryRestarts),1);
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.locator('#session-summary').screenshot({path:'.local/browser-check/summary-mobile.png'});
  await page.setViewportSize({width:1280,height:900});await page.locator('#session-summary').screenshot({path:'.local/browser-check/summary-desktop.png'});
  for(const options of [{mode:'free',practice:false},{empty:true},{mode:'mission',unsupported:true}]) {
    const packet=summaryFixture(options);await showSummary(packet);
    assert.equal(await page.locator('#session-summary .summary-card').count(),0);assert.equal(await page.locator('#session-summary .summary-review').count(),0);
    if(options.unsupported)assert.match(await page.locator('#session-summary').textContent(),/当前目标暂未自动评估/);
    if(options.mode==='free')assert.match(await page.locator('#session-summary').textContent(),/本轮以交流为主/);
    if(options.empty)assert.equal(await page.locator('#session-summary').getAttribute('data-focus'),'insufficient');
  }
  await showSummary(summaryFixture({mode:'free',textOnly:true}));assert.match(await page.locator('#session-summary .summary-label').textContent(),/尚无尝试记录/);
  await showSummary(summaryFixture({failed:true}));assert.match(await page.locator('#session-summary').textContent(),/对话提前结束/);
  for(const reason of ['safety','authorization']) {
    const packet=summaryFixture();await showSummary(packet);await page.evaluate(reason=>window.summaryFixture.suppress(reason),reason);
    assert.equal(await page.locator('#session-summary').isVisible(),false);
    assert.equal(await page.evaluate(packet=>window.summaryFixture.accept(packet),packet),false);
    await page.evaluate(()=>window.summaryFixture.finish());assert.equal(await page.locator('#session-summary .summary-card').count(),0);
    assert.equal(await page.locator('#session-summary').getAttribute('data-focus'),'unavailable');
  }
  const literal=summaryFixture();literal.summary.headline.zh='<img src=x onerror="window.summaryInjected=true">';await showSummary(literal);
  assert.equal(await page.locator('#session-summary img').count(),0);assert.equal(await page.evaluate(()=>Boolean(window.summaryInjected)),false);
  await page.evaluate(()=>{window.summaryFixture.begin('summary-missing','sports');window.summaryFixture.finish();});
  assert.equal(await page.locator('#session-summary').getAttribute('data-focus'),'unavailable');
  await page.evaluate(()=>window.summaryFixture.reset());assert.equal(await page.locator('#session-summary').isVisible(),false);assert.equal(await page.locator('#summary-jump').isVisible(),false);
  await page.getByRole('link',{name:'工程回放'}).click();await page.locator('#start').click();await page.waitForFunction(()=>document.querySelector('#summary').textContent.includes('attempted'));
  // Synthetic Seeduplex transport: inspect actual Web selection -> ticket -> session.create.
  // Withhold provider ready; never expose the synthetic peer as connected or open the microphone.
  const profile=JSON.parse(await readFile(new URL('../docs/protocol/seeduplex-profile.template.json',import.meta.url),'utf8'));
  profile.reviewed=true;profile.realtime.reviewed=true;profile.realtime.ordered_acks_reviewed=true;
  const creates=[];
  const paceServer=createGateway({providerKind:'test',speechPaceSupported:true,providerFactory:ticket=>{
    const socket=new EventEmitter();Object.assign(socket,{readyState:1,bufferedAmount:0,send:value=>{const packet=JSON.parse(value);if(packet.type==='session.create')creates.push(packet);},terminate:()=>{}});
    const provider=createDoubaoProvider({profile,speechPace:ticket.speech_pace,env:{DOUBAO_API_KEY:'synthetic-only'},socketFactory:()=>socket});
    const open=provider.open.bind(provider);provider.open=options=>{open(options);socket.emit('open');};return provider;
  }});
  servers.push(paceServer);paceServer.listen(0,'127.0.0.1');await once(paceServer,'listening');
  await page.goto(`http://127.0.0.1:${paceServer.address().port}/?diagnostics=1`);
  await page.waitForFunction(()=>!document.querySelector('#speech-pace').disabled);
  assert.equal(await page.locator('#speech-pace').inputValue(),'slow');
  await page.locator('#connect').click();await page.getByText('本次语速：慢速；结束后可切换。',{exact:true}).waitFor();
  assert.equal(await page.locator('#speech-pace').isDisabled(),true);assert.equal(creates[0].session.audio.output.speed,-20);
  assert.equal(await page.evaluate(()=>window.microphoneRequests),0);
  await page.locator('#end').click();await page.waitForFunction(()=>!document.querySelector('#connect').disabled);
  assert.equal(await page.locator('#session-summary').isVisible(),true);assert.equal(await page.locator('#session-summary').getAttribute('data-focus'),'insufficient');
  assert.equal(await page.locator('#summary-jump').isVisible(),true);assert.equal(await page.locator('#session-summary .summary-card').count(),0);
  assert.equal(await page.locator('#speech-pace').isDisabled(),false);
  await page.locator('#diagnostics summary').click();
  const paceDownloaded=page.waitForEvent('download');await page.locator('#diagnostic-export').click();
  const paceStream=await(await paceDownloaded).createReadStream(),paceChunks=[];for await(const chunk of paceStream)paceChunks.push(chunk);
  const paceReport=JSON.parse(Buffer.concat(paceChunks).toString());assert.equal(paceReport.kind,'synthetic');
  const paceRow=paceReport.timeline.find(r=>r.clock==='gateway' && r.name==='session.config');assert.equal(paceRow.speech_pace,'slow');assert.equal(paceRow.output_speed,-20);
  await page.locator('#speech-pace').selectOption('normal');await page.locator('#session-summary .summary-restart').click();
  assert.equal(await page.locator('#session-summary').isVisible(),false);
  await page.getByText('本次语速：正常；结束后可切换。',{exact:true}).waitFor();assert.equal(creates[1].session.audio.output.speed,0);
  await page.locator('#end').click();await page.waitForFunction(()=>!document.querySelector('#connect').disabled);
  await page.locator('[data-mode=free]').click();assert.equal(await page.locator('#session-summary').isVisible(),false);assert.equal(await page.locator('#summary-jump').isVisible(),false);
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:'.local/browser-check/speech-pace-mobile.png',fullPage:true});
  // Real local mock HTTP service and signed cookies; the voice provider is absent.
  const backend=await startMockBackend();backends.push(backend);
  const pocServer=createGateway({...backend});servers.push(pocServer);pocServer.listen(0,'127.0.0.1');await once(pocServer,'listening');
  const pocOrigin=`http://127.0.0.1:${pocServer.address().port}`;
  await page.goto(pocOrigin);await page.waitForFunction(()=>!document.querySelector('[data-mode=mission]').disabled && !document.querySelector('#memory-save').disabled);
  assert.equal(await page.locator('#backend-note').isVisible(),true);assert.match(await page.locator('#backend-note').textContent(),/mock HSKai/);
  assert.equal(await page.evaluate(()=>document.cookie.includes('ask_kai_launch')),false);
  await page.locator('[data-mode=mission]').click();assert.match(await page.locator('#prompt-title').textContent(),/示例 Mission/);
  await page.locator('.memory').first().locator('summary').click();
  // Expire the launch cookie without waiting 60 seconds. Each protected action refreshes it.
  await page.context().clearCookies();await page.locator('#memory-value').fill('篮球');await page.locator('#memory-save').click();
  await page.getByText('偏好已更正；后续回合将使用新偏好。',{exact:true}).waitFor();assert.match(await page.locator('#memory-list').textContent(),/篮球/);
  for(const [field,value,display] of [['known_expressions','茶，音乐','茶,音乐'],['chinese_comprehension','comfortable','comfortable'],['support_language','auto','auto']]) {
    await page.locator('#memory-field').selectOption(field);await page.locator('#memory-value').fill(value);await page.locator('#memory-save').click();
    await page.waitForFunction(display=>document.querySelector('#memory-list').textContent.includes(display),display);
  }
  await page.context().clearCookies();const memoryDownload=page.waitForEvent('download');await page.locator('#memory-export').click();
  const memoryStream=await(await memoryDownload).createReadStream(),memoryChunks=[];for await(const chunk of memoryStream)memoryChunks.push(chunk);
  const exportedMemory=JSON.parse(Buffer.concat(memoryChunks).toString()).records;
  assert.equal(exportedMemory[0].value,'篮球');assert.deepEqual(exportedMemory.find(r=>r.field==='known_expressions').value,['茶','音乐']);
  await page.locator('#connect').click();await page.getByText('实时语音尚未开通。需完成豆包协议和服务端连接验证。',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.microphoneRequests),0);assert.equal(await page.locator('#connection-status').textContent(),'未连接');
  await page.locator('#memory-delete').click();await page.getByText('偏好已删除，当前对话已结束。',{exact:true}).waitFor();assert.equal(await page.locator('#memory-list li').count(),0);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:'.local/browser-check/poc-mobile.png',fullPage:true});
  assert.equal(errors.length,0);
  console.log(JSON.stringify({browser:'chromium',input:'synthetic_device',provider_connected:false,web_controls:true,mobile_overflow:false,microphone_before_readiness:false,audio_worklet_pcm:true,capture_continues_during_output_stop:true,progressive_captions:true,native_caption_clock:true,caption_pause_resume:true,caption_controls:true,diagnostics_export:true,audio_metadata:true,speech_pace_selection:true,speech_pace_session_lock:true,speech_pace_wire_payload:true,poc_mock_backend:true,poc_cookie_refresh:true,poc_mission:true,poc_preferences:true,adaptive_language_preferences:true,summary_cards:true,summary_empty_partial_states:true,summary_session_isolation:true,summary_safety_revocation:true,summary_restart:true,summary_literal_text:true,replay:true,page_errors:0}));
}finally{await browser?.close();for(const item of servers){item.stopRealtime();await new Promise(resolve=>{item.close(resolve);item.closeAllConnections();});}for(const backend of backends)await backend.close();}
