import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { readJson } from '../../realtime-gateway/src/server.js';
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export function createTopicServer({manager,adminToken,readToken}) {
  if(!adminToken||adminToken.length<24||!readToken||readToken.length<24||adminToken===readToken)throw new Error('TOPIC_SERVICE_TOKENS_REQUIRED');
  const server=createServer(async(req,res)=>{
    const send=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'");
    if(!/^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(req.headers.host??'')||req.headers['sec-fetch-site']==='cross-site')return send(403,{error:'LOCAL_SAME_SITE_REQUIRED'});
    try {
      const url=new URL(req.url,'http://localhost'),path=url.pathname;
      if(req.method==='GET'&&path==='/healthz')return send(200,{service:'topic-manager',generator_configured:!!manager.generator});
      if(req.method==='GET'&&['/','/manager.js','/manager.css'].includes(path)){res.writeHead(200,{'Content-Type':path==='/'?'text/html; charset=utf-8':path.endsWith('.css')?'text/css':'text/javascript'});return res.end(await readFile(new URL(path==='/'?'../public/index.html':path==='/manager.css'?'../public/manager.css':'../public/manager.js',import.meta.url)));}
      const bearer=req.headers.authorization?.replace(/^Bearer /,'');
      if(path.startsWith('/api/published')) {
        if(req.method!=='GET'||!equal(bearer,readToken))return send(401,{error:'TOPIC_READ_AUTH_REQUIRED'});
        if(path==='/api/published')return send(200,{topics:manager.store.list()});
        const id=path.slice('/api/published/'.length),pack=manager.store.read(id,url.searchParams.get('version')??undefined),etag=`"${pack.hash}"`;
        res.setHeader('ETag',etag);
        if(req.headers['if-none-match']===etag){res.writeHead(304);return res.end();}
        return send(200,pack);
      }
      if(!path.startsWith('/api/admin'))return send(404,{error:'NOT_FOUND'});
      if(!equal(bearer,adminToken))return send(401,{error:'TOPIC_ADMIN_AUTH_REQUIRED'});
      if(req.method!=='GET'&&req.headers.origin!==`http://${req.headers.host}`)return send(403,{error:'ORIGIN_REQUIRED'});
      if(req.method==='GET'&&path==='/api/admin')return send(200,manager.store.inspect());
      const input=await readJson(req,2048);
      if(req.method==='POST'&&path==='/api/admin/topics')return send(201,await manager.store.define(input));
      if(req.method==='POST'&&path==='/api/admin/generate')return send(202,await manager.enqueue(input.topic_id,input.request_id));
      if(req.method==='POST'&&path==='/api/admin/cancel')return send(200,await manager.cancel(input.job_id));
      if(req.method==='POST'&&path==='/api/admin/publish')return send(200,await manager.store.publish(input.topic_id,input.version));
      if(req.method==='POST'&&path==='/api/admin/revoke')return send(200,await manager.store.revoke(input.topic_id,input.version));
      return send(405,{error:'METHOD_NOT_ALLOWED'});
    }catch(error){return send(error.message==='TOPIC_UNAVAILABLE'?404:400,{error:/^[A-Z_]+$/.test(error.message)?error.message:'INVALID_TOPIC_REQUEST'});}
  });
  server.on('close',()=>manager.close());server.requestTimeout=5000;server.headersTimeout=5000;return server;
}
