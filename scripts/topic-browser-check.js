import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { TopicStore } from '../apps/topic-manager/src/store.js';
import { TopicManager } from '../apps/topic-manager/src/manager.js';
import { createTopicServer } from '../apps/topic-manager/src/server.js';
import { SyntheticTopicGenerator } from '../packages/topic-packs/generator.js';
import { PublishedTopicClient,withPublishedTopics } from '../packages/topic-packs/port.js';
import { startMockBackend } from '../apps/hskai-mock/src/backend.js';
import { createGateway } from '../apps/realtime-gateway/src/server.js';
const dir=await mkdtemp(join(tmpdir(),'kai-topic-browser-'));let browser,backend;const servers=[];
try {
  const store=await new TopicStore(dir).open(),generator=new SyntheticTopicGenerator();let calls=0;const generate=generator.generate.bind(generator);generator.generate=(...args)=>{calls++;return generate(...args);};
  const manager=new TopicManager({store,generator}),adminToken=randomBytes(32).toString('base64url'),readToken=randomBytes(32).toString('base64url'),server=createTopicServer({manager,adminToken,readToken});servers.push(server);server.listen(0,'127.0.0.1');await once(server,'listening');const origin=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({headless:true,executablePath:process.env.ASK_KAI_BROWSER_EXECUTABLE,args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);await page.locator('#token').fill(adminToken);
  for(const [id,title] of [['sports','运动'],['music','音乐']]){
    await page.locator('[name=id]').fill(id);await page.locator('[name=title]').fill(title);await page.locator('[name=brief]').fill(title+'与日常生活');await page.getByRole('button',{name:'保存主题'}).click();await page.waitForFunction(id=>JSON.parse(document.querySelector('#result').textContent).id===id,id);
    await page.locator('#topic').fill(id);await page.locator('#generate').click();await page.waitForFunction(()=>document.querySelector('#job').value.length>0);await manager.work;await page.locator('#refresh').click();await page.waitForFunction(()=>JSON.parse(document.querySelector('#result').textContent).jobs?.some(j=>j.status==='succeeded'));
    const version=Object.values(store.data.versions).find(v=>v.pack.id===id).pack.version;await page.locator('#version').fill(version);await page.locator('#publish').click();await page.waitForFunction(id=>{try{const v=JSON.parse(document.querySelector('#result').textContent);return v.id===id&&v.status==='published';}catch{return false;}},id);
  }
  assert.equal(store.list().length,2);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const topics=new PublishedTopicClient({endpoint:origin,token:readToken});backend=await startMockBackend({topicResources:topics});const planningPort=withPublishedTopics(backend.planningPort,topics),gateway=createGateway({...backend,planningPort,planningMode:'next_turn_advisory'});servers.push(gateway);gateway.listen(0,'127.0.0.1');await once(gateway,'listening');await page.goto(`http://127.0.0.1:${gateway.address().port}`);
  await page.waitForFunction(()=>document.querySelector('#topic-select').options.length===2);await page.getByText('对话已准备；当前使用保守策略，规划模型暂不可用。',{exact:true}).waitFor();assert.match(await page.locator('#goal').textContent(),/频率/);
  assert.equal(await page.locator('#goal-details').isVisible(),true);assert.match(await page.locator('#goal-key-points').textContent(),/频率/);assert.match(await page.locator('#goal-expression-task').textContent(),/运动/);
  for(const [uid,pattern] of [['mock-maya-hsk3','复杂经历'],['mock-leo-hsk5','具体理由'],['mock-nina-hsk7','限定观点']]){await page.locator('#mock-learner-select').selectOption(uid);await page.waitForFunction(pattern=>document.querySelector('#goal').textContent.includes(pattern),pattern);assert.ok((await page.locator('#goal-key-points').textContent()).includes(pattern));assert.ok((await page.locator('#goal-expression-task').textContent()).includes('运动'));}
  await page.locator('#topic-select').selectOption('music');await page.waitForFunction(()=>document.querySelector('#prompt-title').textContent==='音乐');assert.equal(await page.locator('.word-card').isVisible(),false);
  assert.ok((await page.locator('#goal-expression-task').textContent()).includes('音乐'));assert.ok(!(await page.locator('#goal-expression-task').textContent()).includes('运动'));
  if(process.env.ASK_KAI_BROWSER_SCREENSHOT)await page.screenshot({path:process.env.ASK_KAI_BROWSER_SCREENSHOT,fullPage:true});
  await page.locator('#opening-request').fill('我只想聊音乐，不想练习。');await page.locator('#opening-request').press('Tab');await page.getByText('主题式对话需要一个练习目标。如果只想聊天，请选择自由聊天。',{exact:true}).waitFor();assert.equal(await page.locator('#goal-details').isVisible(),false);assert.equal(await page.locator('#goal-expression-task').textContent(),'');
  await page.locator('[data-mode=free]').click();await page.waitForFunction(()=>document.querySelector('#goal').textContent==='由你选择话题，自然交流。');assert.equal(await page.locator('#goal-details').isVisible(),false);assert.equal(await page.locator('#goal-key-points').textContent(),'');
  assert.equal(calls,2);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await store.revoke('music',store.read('music').version);await page.locator('#refresh-topics').click();await page.waitForFunction(()=>document.querySelector('#topic-select').options.length===1);assert.equal(calls,2);assert.deepEqual(errors,[]);
  console.log(JSON.stringify({browser:'chromium',input:'synthetic',real_provider:false,manager_ui:true,publish_two_topics:true,four_learners:true,goal_details:true,declined_preparation_failed:true,free_without_goal:true,revocation_refresh:true,runtime_generation_calls:0,mobile_overflow:false,page_errors:0}));
}finally{await browser?.close();for(const s of servers.reverse()){s.stopRealtime?.();await new Promise(r=>{s.close(r);s.closeAllConnections();});}await backend?.close();await rm(dir,{recursive:true,force:true});}
