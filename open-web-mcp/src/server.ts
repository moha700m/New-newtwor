import { createMcpFastifyApp } from '@modelcontextprotocol/fastify';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { loadConfig, type Config } from './config/env.js';
import { verifyBearer } from './security/auth.js';
import { AuthenticationError, toPublicError } from './errors/index.js';
import { createOpenWebMcpServer } from './mcp/server.js';
import { createServices, type Services } from './services.js';
import { FixedWindowRateLimiter } from './utils/rate-limit.js';
import { Semaphore } from './utils/concurrency.js';

export interface OpenWebApp {
  app: ReturnType<typeof createMcpFastifyApp>;
  config: Config;
  services: Services;
  close(): Promise<void>;
}

export function buildApp(env: NodeJS.ProcessEnv = process.env): OpenWebApp {
  const config = loadConfig(env);
  const services = createServices(config);
  const app = createMcpFastifyApp({
    host: config.HOST,
    allowedHosts: config.allowedHosts,
    logger: {
      level: config.NODE_ENV === 'development' ? 'debug' : 'info',
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    },
    bodyLimit: 1_000_000,
  } as any);
  const limiter = new FixedWindowRateLimiter(config.RATE_LIMIT_MAX, config.RATE_LIMIT_WINDOW_MS);
  const concurrency = new Semaphore(config.GLOBAL_CONCURRENCY);
  const handler = createMcpHandler(() => createOpenWebMcpServer(services));
  const nodeHandler = toNodeHandler(handler);

  app.get('/health', async () => ({ status: 'ok', service: 'open-web-mcp', version: '1.0.0' }));

  app.get('/ready', async (_request, reply) => {
    const [chromium, search, network] = await Promise.all([
      services.browser.checkReady(),
      services.search.health(),
      services.safeFetcher
        .fetch('https://example.com/', { method: 'HEAD', maxBytes: 1024, timeoutMs: 5000 })
        .then(() => true)
        .catch(() => false),
    ]);
    const checks = { chromium, search, network, mcp: true };
    const ready = chromium && search.ok && network;
    console.log(JSON.stringify({ event: 'readiness', ready, checks }));
    reply.code(ready ? 200 : 503);
    return { ready, checks };
  });

  app.all('/mcp', async (request, reply) => {
    try {
      verifyBearer(request.headers.authorization, config.MCP_API_KEY, config.NODE_ENV === 'production');
      const rate = limiter.take(request.ip);
      if (!rate.allowed) {
        reply.header('retry-after', String(Math.ceil((rate.retryAfterMs ?? 1000) / 1000)));
        return reply
          .code(429)
          .send({ error: { code: 'RATE_LIMITED', message: 'Too many requests', retryable: true } });
      }
      return await concurrency.run(() => nodeHandler(request.raw as any, reply.raw as any, request.body));
    } catch (error) {
      const body = toPublicError(error);
      const code = error instanceof AuthenticationError ? 401 : 500;
      return reply.code(code).send(body);
    }
  });

  return {
    app,
    config,
    services,
    async close() {
      await services.browser.shutdown();
      await handler.close();
      await app.close();
    },
  };
}
