import { readConfig } from './config.js';
import { createGateway } from './server.js';
try {
  const config = readConfig();
  const server = createGateway();
  server.listen(config.port, config.host, () => console.log(`Ask Kai synthetic replay: http://${config.host === '::1' ? '[::1]' : config.host}:${config.port} (Doubao disconnected)`));
  server.on('error', () => { console.error('GATEWAY_START_FAILED'); process.exitCode = 1; });
  for (const signal of ['SIGINT','SIGTERM']) process.once(signal, () => {
    server.close();
    server.closeAllConnections();
  });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
