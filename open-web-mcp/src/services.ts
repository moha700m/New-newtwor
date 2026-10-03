import pino from 'pino';
import type { Config } from './config/env.js';
import { MemoryLruCache } from './cache/memory.js';
import { SafeFetcher } from './fetch/fetcher.js';
import { BrowserManager } from './browser/manager.js';
import { SmartFetcher } from './fetch/smart-fetcher.js';
import { SearchService } from './search/service.js';
import { SearxngProvider } from './search/searxng.js';
import { DuckDuckGoHtmlProvider } from './search/duckduckgo.js';
import type { SearchProvider } from './search/provider.js';

export function createServices(config: Config) {
  const logger = pino({
    level: config.NODE_ENV === 'development' ? 'debug' : 'info',
    redact: { paths: ['req.headers.authorization','headers.authorization','authorization','cookie','cookies','password','token','api_key','apiKey'], censor: '[REDACTED]' },
  });
  const cache = new MemoryLruCache(config.CACHE_MAX_ENTRIES);
  const safeFetcher = new SafeFetcher(config);
  const browser = new BrowserManager(config);
  const smartFetcher = new SmartFetcher(safeFetcher, browser, cache, config);
  const providers: SearchProvider[] = [];
  if (config.SEARXNG_URL) providers.push(new SearxngProvider(config.SEARXNG_URL));
  if (config.ENABLE_DDG_FALLBACK) providers.push(new DuckDuckGoHtmlProvider(safeFetcher));
  if (!providers.length) throw new Error('Configure SEARXNG_URL or enable ENABLE_DDG_FALLBACK');
  const search = new SearchService(providers, cache, config.SEARCH_CACHE_TTL);
  return { config, logger, cache, safeFetcher, browser, smartFetcher, search };
}

export type Services = ReturnType<typeof createServices>;
