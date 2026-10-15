import { randomBytes } from 'node:crypto';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
// Local POC services share server credentials through an ignored, owner-only file.
// Environment overrides must specify both roles; never expose either via gateway.
export async function topicCredentials(env=process.env) {
  if(env.TOPIC_MANAGER_ADMIN_TOKEN||env.TOPIC_MANAGER_READ_TOKEN){if(!env.TOPIC_MANAGER_ADMIN_TOKEN||!env.TOPIC_MANAGER_READ_TOKEN)throw new Error('TOPIC_SERVICE_TOKENS_REQUIRED');return {adminToken:env.TOPIC_MANAGER_ADMIN_TOKEN,readToken:env.TOPIC_MANAGER_READ_TOKEN};}
  const directory=env.TOPIC_MANAGER_STORE??'.local/topic-manager',path=join(directory,'credentials.json');await mkdir(directory,{recursive:true,mode:0o700});
  try{return JSON.parse(await readFile(path,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  const credentials={adminToken:randomBytes(32).toString('base64url'),readToken:randomBytes(32).toString('base64url')};
  try{await writeFile(path,JSON.stringify(credentials),{mode:0o600,flag:'wx'});return credentials;}catch(e){if(e.code!=='EEXIST')throw e;return JSON.parse(await readFile(path,'utf8'));}
}
