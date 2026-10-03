import type { CacheProvider } from '../cache/provider.js';
import type { Config } from '../config/env.js';
import { extractReadable, looksJsHeavy } from '../extraction/readability.js';
import type { BrowserManager } from '../browser/manager.js';
import { SafeFetcher } from './fetcher.js';

export interface WebPageResult {
  type: 'web_page';
  url: string;
  final_url: string;
  title: string;
  status: number;
  content: string;
  content_type: string;
  retrieved_at: string;
  metadata: { description?: string; author?: string; published_at?: string; truncated?: boolean; browser_used: boolean; cache_hit: boolean };
  raw_html?: string;
}

export class SmartFetcher {
  constructor(
    private readonly safeFetcher: SafeFetcher,
    private readonly browser: BrowserManager,
    private readonly cache: CacheProvider,
    private readonly config: Config,
  ) {}

  async open(url: string, renderJs = false): Promise<WebPageResult> {
    const key = `page:${url}:${renderJs}`;
    const cached = this.cache.get<WebPageResult>(key);
    if (cached) return { ...cached, metadata: { ...cached.metadata, cache_hit: true } };

    let status = 200;
    let contentType = 'text/html';
    let finalUrl = url;
    let html = '';
    let browserUsed = false;
    let truncated = false;

    if (!renderJs) {
      const response = await this.safeFetcher.fetch(url, { maxBytes: this.config.MAX_HTML_BYTES });
      status = response.status; contentType = response.contentType; finalUrl = response.finalUrl; truncated = response.truncated;
      html = response.body.toString('utf8');
      const quick = extractReadable(html, finalUrl);
      if (looksJsHeavy(html, quick.text)) renderJs = true;
    }

    if (renderJs) {
      const rendered = await this.browser.render(url);
      status = rendered.status; contentType = rendered.contentType; finalUrl = rendered.finalUrl; html = rendered.html; browserUsed = true;
    }

    const extracted = extractReadable(html, finalUrl);
    const content = extracted.content.slice(0, this.config.MAX_TEXT_CHARS);
    const result: WebPageResult = {
      type: 'web_page', url, final_url: finalUrl, title: extracted.title, status, content,
      content_type: contentType, retrieved_at: new Date().toISOString(),
      metadata: {
        ...extracted.metadata,
        ...(extracted.metadata.publishedAt ? { published_at: extracted.metadata.publishedAt } : {}),
        truncated: truncated || extracted.content.length > this.config.MAX_TEXT_CHARS,
        browser_used: browserUsed,
        cache_hit: false,
      },
      raw_html: html,
    };
    delete (result.metadata as any).publishedAt;
    this.cache.set(key, result, this.config.PAGE_CACHE_TTL);
    return result;
  }
}
