import { z } from 'zod';

const boolish = z.string().optional().transform((v) => v === undefined ? undefined : ['1','true','yes','on'].includes(v.toLowerCase()));
const intish = (fallback: number, min = 0) => z.coerce.number().int().min(min).default(fallback);

const schema = z.object({
  NODE_ENV: z.enum(['development','test','production']).default('development'),
  PORT: intish(8787, 1),
  HOST: z.string().default('0.0.0.0'),
  MCP_API_KEY: z.string().optional(),
  MCP_ALLOWED_HOSTS: z.string().default(''),
  PUBLIC_BASE_URL: z.string().url().optional(),
  RAILWAY_PUBLIC_DOMAIN: z.string().optional(),
  VERCEL_URL: z.string().optional(),
  VERCEL_PROJECT_PRODUCTION_URL: z.string().optional(),
  SEARXNG_URL: z.string().url().optional(),
  ENABLE_DDG_FALLBACK: boolish.default(true),
  MAX_BROWSER_SESSIONS: intish(5, 1),
  BROWSER_SESSION_TTL: intish(600, 1),
  BROWSER_IDLE_TTL: intish(300, 1),
  BROWSER_MEMORY_MB: intish(256, 64),
  PAGE_TIMEOUT_MS: intish(30000, 1000),
  MAX_HTML_BYTES: intish(10_000_000, 1024),
  MAX_TEXT_CHARS: intish(100_000, 1000),
  MAX_DOWNLOAD_BYTES: intish(25_000_000, 1024),
  MAX_REDIRECTS: intish(5, 0),
  SEARCH_CACHE_TTL: intish(300, 0),
  PAGE_CACHE_TTL: intish(300, 0),
  CACHE_MAX_ENTRIES: intish(256, 1),
  USER_AGENT: z.string().default('OpenWebMCP/1.0'),
  REQUEST_DELAY_MS: intish(100, 0),
  PER_DOMAIN_CONCURRENCY: intish(2, 1),
  RATE_LIMIT_MAX: intish(120, 1),
  RATE_LIMIT_WINDOW_MS: intish(60_000, 1000),
  GLOBAL_CONCURRENCY: intish(16, 1),
});

export type Config = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = schema.parse(env);
  if (parsed.NODE_ENV === 'production' && !parsed.MCP_API_KEY) {
    throw new Error('MCP_API_KEY is required in production');
  }
  const allowedHosts = parsed.MCP_ALLOWED_HOSTS.split(',').map((x) => x.trim()).filter(Boolean);
  if (parsed.RAILWAY_PUBLIC_DOMAIN) allowedHosts.push(parsed.RAILWAY_PUBLIC_DOMAIN);
  if (parsed.VERCEL_URL) allowedHosts.push(parsed.VERCEL_URL);
  if (parsed.VERCEL_PROJECT_PRODUCTION_URL) allowedHosts.push(parsed.VERCEL_PROJECT_PRODUCTION_URL);
  if (parsed.NODE_ENV !== 'production') allowedHosts.push('localhost', '127.0.0.1', '[::1]');
  if (parsed.NODE_ENV === 'production' && allowedHosts.length === 0) {
    throw new Error('MCP_ALLOWED_HOSTS, RAILWAY_PUBLIC_DOMAIN, VERCEL_URL, or VERCEL_PROJECT_PRODUCTION_URL is required in production');
  }
  const publicBaseUrl = parsed.PUBLIC_BASE_URL
    ?? (parsed.VERCEL_PROJECT_PRODUCTION_URL ? `https://${parsed.VERCEL_PROJECT_PRODUCTION_URL}` : undefined)
    ?? (parsed.VERCEL_URL ? `https://${parsed.VERCEL_URL}` : undefined)
    ?? (parsed.RAILWAY_PUBLIC_DOMAIN ? `https://${parsed.RAILWAY_PUBLIC_DOMAIN}` : undefined)
    ?? `http://localhost:${parsed.PORT}`;
  return { ...parsed, allowedHosts: [...new Set(allowedHosts)], publicBaseUrl };
}
