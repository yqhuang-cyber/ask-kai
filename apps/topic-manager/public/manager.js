const $=id=>document.getElementById(id);
async function call(path,data){const response=await fetch('/api/admin'+path,{method:data?'POST':'GET',headers:{Authorization:'Bearer '+$('token').value,'Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});const value=await response.json();if(!response.ok)throw new Error(value.error);return value;}
async function run(action){try{$('status').textContent='处理中……';const result=await action();$('result').textContent=JSON.stringify(result,null,2);$('status').textContent='已完成；生成任务请点击读取查看状态。';}catch(e){$('status').textContent=e.message;}}
$('refresh').onclick=()=>run(()=>call(''));
$('define').onsubmit=e=>{e.preventDefault();run(()=>call('/topics',Object.fromEntries(new FormData(e.target))));};
$('generate').onclick=()=>run(async()=>{const j=await call('/generate',{topic_id:$('topic').value,request_id:crypto.randomUUID()});$('job').value=j.id;return j;});
for(const action of ['publish','revoke'])$(action).onclick=()=>run(()=>call('/'+action,{topic_id:$('topic').value,version:$('version').value}));
$('cancel').onclick=()=>run(()=>call('/cancel',{job_id:$('job').value}));
