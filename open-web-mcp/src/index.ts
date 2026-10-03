import { buildApp } from './server.js';

const runtime = buildApp();
const { app, config } = runtime;

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await runtime.close();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ host: config.HOST, port: config.PORT });
app.log.info({ port: config.PORT, host: config.HOST }, 'Open Web MCP listening');
