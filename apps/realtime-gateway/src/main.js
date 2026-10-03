import { readConfig } from './config.js';
import { createGateway } from './server.js';
import { loadProfile } from '../../../packages/provider-doubao/probe.js';
import { ReviewedDoubaoProvider, validateRealtimeProfile } from '../../../packages/provider-doubao/realtime.js';
import { HskaiBridge } from '../../../packages/hskai-bridge/identity.js';
import { HskaiMemoryPort } from '../../../packages/hskai-bridge/memory.js';
try {
  const config = readConfig();
  const profile=config.provider==='doubao' ? validateRealtimeProfile(await loadProfile(config.profilePath)) : null;
  if(profile)new ReviewedDoubaoProvider({profile});
  const bridge=profile ? new HskaiBridge({secret:process.env.HSKAI_BRIDGE_SECRET,markets:(process.env.HSKAI_ALLOWED_MARKETS ?? '').split(',').filter(Boolean)}) : undefined;
  const memoryPort=profile && process.env.HSKAI_MEMORY_ENDPOINT ? new HskaiMemoryPort({endpoint:process.env.HSKAI_MEMORY_ENDPOINT,secret:process.env.HSKAI_BRIDGE_SECRET}):undefined;
  const server = createGateway({bridge,memoryPort,providerFactory:profile ? ()=>new ReviewedDoubaoProvider({profile}) : undefined});
  server.listen(config.port, config.host, () => console.log(`Ask Kai Web: http://${config.host === '::1' ? '[::1]' : config.host}:${config.port} (${profile ? 'reviewed provider configured; readiness per session':'Doubao disconnected'})`));
  server.on('error', () => { console.error('GATEWAY_START_FAILED'); process.exitCode = 1; });
  for (const signal of ['SIGINT','SIGTERM']) process.once(signal, () => {
    server.stopRealtime();
    server.close();
    server.closeAllConnections();
  });
} catch (error) {
  console.error(/^[A-Z][A-Z0-9_]+$/.test(error.message) ? error.message : 'GATEWAY_CONFIGURATION_ERROR');
  process.exitCode = 1;
}
