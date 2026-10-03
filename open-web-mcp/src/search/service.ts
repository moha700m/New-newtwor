import { SearchProviderError } from '../errors/index.js';
import type { CacheProvider } from '../cache/provider.js';
import type { SearchProvider, SearchQuery, SearchResult } from './provider.js';

export class SearchService {
  constructor(private readonly providers: SearchProvider[], private readonly cache: CacheProvider, private readonly ttl: number) {}
  async search(query: SearchQuery): Promise<{ results: SearchResult[]; provider: string; cacheHit: boolean }> {
    const key = `search:${JSON.stringify(query)}`;
    const cached = this.cache.get<{ results: SearchResult[]; provider: string }>(key);
    if (cached) return { ...cached, cacheHit: true };
    const errors: string[] = [];
    for (const provider of this.providers) {
      try {
        const results = await provider.search(query);
        if (results.length) {
          const value = { results, provider: provider.name };
          this.cache.set(key, value, this.ttl);
          return { ...value, cacheHit: false };
        }
        errors.push(`${provider.name}: empty result`);
      } catch (error) { errors.push(`${provider.name}: ${error instanceof Error ? error.message : String(error)}`); }
    }
    throw new SearchProviderError(`All search providers failed (${errors.join('; ')})`);
  }
  async health() {
    const states = await Promise.all(this.providers.map(async (p) => ({ name: p.name, ok: await p.health() })));
    return { ok: states.some((x) => x.ok), providers: states };
  }
}
