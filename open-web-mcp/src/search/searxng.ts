import { SearchProviderError } from '../errors/index.js';
import type { SearchProvider, SearchQuery, SearchResult } from './provider.js';

const ranges: Record<string,string|undefined> = { day:'day', week:'month', month:'month', year:'year', any:undefined };
export class SearxngProvider implements SearchProvider {
  readonly name = 'searxng';
  constructor(private readonly baseUrl: string, private readonly timeoutMs = 10000) {}
  async search(query: SearchQuery): Promise<SearchResult[]> {
    const url = new URL('/search', this.baseUrl);
    url.searchParams.set('q', query.query);
    url.searchParams.set('format', 'json');
    url.searchParams.set('language', query.language === 'auto' ? 'all' : query.language);
    const range = ranges[query.freshness];
    if (range) url.searchParams.set('time_range', range);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } });
      if (!response.ok) throw new SearchProviderError(`SearXNG returned ${response.status}`);
      const data = await response.json() as any;
      const results = Array.isArray(data.results) ? data.results : [];
      return results.slice(0, query.limit).map((item: any) => ({
        title: String(item.title ?? ''), url: String(item.url ?? ''), snippet: String(item.content ?? ''),
        source: String(item.engine ?? 'searxng'), published_at: item.publishedDate ? String(item.publishedDate) : null,
      })).filter((r: SearchResult) => r.url.startsWith('http'));
    } catch (error) {
      if (error instanceof SearchProviderError) throw error;
      throw new SearchProviderError(`SearXNG request failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally { clearTimeout(timer); }
  }
  async health() {
    // Readiness must reflect whether the SearXNG service itself is reachable,
    // not whether an upstream search engine is currently rate-limited or showing a CAPTCHA.
    const candidates = ['/healthz', '/'];
    for (const path of candidates) {
      try {
        const url = new URL(path, this.baseUrl);
        const response = await fetch(url, {
          method: 'GET',
          signal: AbortSignal.timeout(3000),
          headers: { accept: 'text/html,application/json;q=0.9,*/*;q=0.8' },
        });
        if (response.ok) return true;
      } catch {}
    }
    return false;
  }
}
