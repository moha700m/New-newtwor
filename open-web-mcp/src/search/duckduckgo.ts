import * as cheerio from 'cheerio';
import type { SafeFetcher } from '../fetch/fetcher.js';
import type { SearchProvider, SearchQuery, SearchResult } from './provider.js';

export class DuckDuckGoHtmlProvider implements SearchProvider {
  readonly name = 'duckduckgo-html';
  constructor(private readonly fetcher: SafeFetcher) {}
  async search(query: SearchQuery): Promise<SearchResult[]> {
    const url = new URL('https://html.duckduckgo.com/html/');
    url.searchParams.set('q', query.query);
    if (query.language !== 'auto') url.searchParams.set('kl', query.language === 'ar' ? 'xa-ar' : 'us-en');
    const df = { day: 'd', week: 'w', month: 'm', year: 'y', any: '' }[query.freshness];
    if (df) url.searchParams.set('df', df);
    const response = await this.fetcher.fetch(url.toString(), { maxBytes: 2_000_000 });
    const $ = cheerio.load(response.body.toString('utf8'));
    const results: SearchResult[] = [];
    $('.result').each((_i, el) => {
      if (results.length >= query.limit) return false;
      const link = $(el).find('.result__a').first();
      const title = link.text().trim();
      let href = link.attr('href') ?? '';
      try {
        const wrapped = new URL(href, 'https://html.duckduckgo.com');
        const uddg = wrapped.searchParams.get('uddg');
        if (uddg) href = uddg;
      } catch {}
      const snippet = $(el).find('.result__snippet').text().replace(/\s+/g, ' ').trim();
      if (title && href.startsWith('http')) results.push({ title, url: href, snippet, source: this.name, published_at: null });
    });
    return results;
  }
  async health() {
    try { const response = await this.fetcher.fetch('https://html.duckduckgo.com/html/?q=health', { maxBytes: 100_000, timeoutMs: 5000 }); return response.status < 500; }
    catch { return false; }
  }
}
