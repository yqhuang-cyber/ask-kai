import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { SessionRuntime } from '../../../packages/agent-core/session.js';
import { SCENARIOS, loadScenario, ReplayProvider } from '../../../packages/provider-replay/index.js';

const publicDir = new URL('../public/', import.meta.url);
const staticFiles = new Map([
  ['/', ['index.html','text/html']], ['/web.js', ['web.js','text/javascript']], ['/web.css', ['web.css','text/css']],
  ['/dev/replay', ['replay.html','text/html']], ['/app.js',['app.js','text/javascript']], ['/style.css',['style.css','text/css']]
]);
function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}
async function streamReplay(req, res, id, paceMs) {
  const fixture = await loadScenario(id);
  const sessionId = randomUUID();
  const runtime = new SessionRuntime(sessionId);
  const provider = new ReplayProvider(fixture, { paceMs });
  const controller = new AbortController();
  res.on('close', () => controller.abort());
  res.writeHead(200, { 'Content-Type':'text/event-stream; charset=utf-8', 'Cache-Control':'no-cache, no-transform', 'X-Accel-Buffering':'no' });
  const send = async (type, data) => {
    if (res.destroyed) return;
    if (!res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`)) {
      try { await once(res, 'drain', { signal: controller.signal }); } catch (error) { if (error.name !== 'AbortError') throw error; }
    }
  };
  try {
    await send('mode', { mode:'synthetic_replay', provider_connected:false, scenario:id });
    for await (const event of provider.open({ sessionId, signal: controller.signal })) {
      const result = runtime.ingest(event);
      await send(result.accepted ? 'accepted' : 'dropped', result.accepted ? event : { event_id:event.event_id, reason:result.reason, response_id:event.response_id ?? null });
    }
    if (!controller.signal.aborted) await send('summary', runtime.snapshot());
  } finally {
    await provider.close();
    if (!res.destroyed) res.end();
  }
}
export function createGateway({ paceMs = 120 } = {}) {
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
    // Local diagnostic surface: restrict Host to resist cross-site DNS rebinding.
    if (!/^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(req.headers.host ?? '')) return json(res, 403, { error:'LOCAL_HOST_REQUIRED' });
    if (req.headers['sec-fetch-site'] === 'cross-site') return json(res, 403, { error:'CROSS_SITE_DENIED' });
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/healthz') return json(res, 200, { service:'ask-kai', mode:'synthetic_replay', provider_connected:false, status:'ok' });
      if (req.method === 'GET' && url.pathname === '/api/replays') return json(res, 200, { scenarios:SCENARIOS });
      if (req.method === 'POST' && url.pathname === '/api/sessions') return json(res, 501, { error:'REALTIME_NOT_IMPLEMENTED', provider_connected:false, next_step:'verified_doubao_adapter_and_hskai_authorization' });
      if (req.method === 'GET' && url.pathname.startsWith('/api/replays/')) {
        const id = url.pathname.slice('/api/replays/'.length);
        if (!SCENARIOS.some(item => item.id === id)) return json(res, 404, { error:'UNKNOWN_SCENARIO' });
        return await streamReplay(req, res, id, paceMs);
      }
      if (req.method === 'GET' && staticFiles.has(url.pathname)) {
        const [file, type] = staticFiles.get(url.pathname);
        const content = await readFile(new URL(file, publicDir));
        res.writeHead(200, { 'Content-Type':`${type}; charset=utf-8` });
        return res.end(content);
      }
      json(res, 404, { error:'NOT_FOUND' });
    } catch {
      // Never log transcript, request body, provider payload or credentials.
      if (!res.headersSent) json(res, 500, { error:'INTERNAL_ERROR' });
      else res.end();
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 5000;
  server.on('upgrade', (_req, socket) => socket.end('HTTP/1.1 501 Not Implemented\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'));
  return server;
}
