import { createConnection } from 'node:net';
import { SearchProviderError } from '../errors/index.js';
import type { SearchProvider, SearchQuery, SearchResult } from './provider.js';

const ranges: Record<string, string | undefined> = {
  day: 'day',
  week: 'month',
  month: 'month',
  year: 'year',
  any: undefined,
};

export class SearxngProvider implements SearchProvider {
  readonly name = 'searxng';

  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs = 10000,
  ) {}

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
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { accept: 'application/json' },
      });
      if (!response.ok) throw new SearchProviderError(`SearXNG returned ${response.status}`);

      const data = (await response.json()) as any;
      const results = Array.isArray(data.results) ? data.results : [];
      return results
        .slice(0, query.limit)
        .map((item: any) => ({
          title: String(item.title ?? ''),
          url: String(item.url ?? ''),
          snippet: String(item.content ?? ''),
          source: String(item.engine ?? 'searxng'),
          published_at: item.publishedDate ? String(item.publishedDate) : null,
        }))
        .filter((result: SearchResult) => result.url.startsWith('http'));
    } catch (error) {
      if (error instanceof SearchProviderError) throw error;
      throw new SearchProviderError(
        `SearXNG request failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async health(): Promise<boolean> {
    try {
      const url = new URL(this.baseUrl);
      const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
      if (!Number.isInteger(port) || port < 1 || port > 65535) return false;

      return await new Promise<boolean>((resolve) => {
        let settled = false;
        const socket = createConnection({ host: url.hostname, port });
        const finish = (ok: boolean) => {
          if (settled) return;
          settled = true;
          socket.destroy();
          resolve(ok);
        };

        socket.setTimeout(3000);
        socket.once('connect', () => finish(true));
        socket.once('timeout', () => finish(false));
        socket.once('error', () => finish(false));
      });
    } catch {
      return false;
    }
  }
}
