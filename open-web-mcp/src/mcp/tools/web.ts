import * as cheerio from 'cheerio';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { Logger } from 'pino';
import type { Services } from '../../services.js';
import { extractReadable } from '../../extraction/readability.js';
import { withAudit } from './helpers.js';

export function registerWebTools(server: McpServer, services: Services, logger: Logger) {
  server.registerTool('search_web', {
    description: 'Search the public web for current information and return ranked results with URLs, titles, snippets, sources, and publication timestamps when available.',
    inputSchema: z.object({
      query: z.string().min(1).max(500), limit: z.number().int().min(1).max(20).default(10),
      language: z.enum(['ar','en','auto']).default('auto'), freshness: z.enum(['day','week','month','year','any']).default('any'),
    }),
  }, withAudit(logger, 'search_web', async (input) => services.search.search(input)));

  server.registerTool('open_url', {
    description: 'Retrieve readable content from a public HTTP or HTTPS URL. Uses a fast SSRF-safe HTTP fetch first and automatically renders JavaScript when the page appears client-rendered, or when render_js is requested.',
    inputSchema: z.object({ url: z.string().url(), render_js: z.boolean().default(false) }),
  }, withAudit(logger, 'open_url', async ({ url, render_js }) => {
    const page = await services.smartFetcher.open(url, render_js);
    const { raw_html: _raw, ...publicPage } = page;
    return publicPage;
  }));

  server.registerTool('extract_page', {
    description: 'Extract the main article or page content while removing navigation, scripts, ads, and boilerplate. Returns Markdown, plain text, or cleaned article HTML.',
    inputSchema: z.object({ url: z.string().url(), format: z.enum(['markdown','text','html']).default('markdown') }),
  }, withAudit(logger, 'extract_page', async ({ url, format }) => {
    const page = await services.smartFetcher.open(url, false);
    const extracted = extractReadable(page.raw_html ?? '', page.final_url);
    const content = format === 'markdown' ? extracted.content : format === 'text' ? extracted.text : extracted.html;
    return { type: 'extracted_page', url, final_url: page.final_url, title: extracted.title, format, content: content.slice(0, services.config.MAX_TEXT_CHARS), metadata: page.metadata };
  }));

  server.registerTool('find_text', {
    description: 'Find literal text within the readable content of a public web page and return match positions with surrounding context. This does not interpret the pattern as a regular expression.',
    inputSchema: z.object({ url: z.string().url(), pattern: z.string().min(1).max(500) }),
  }, withAudit(logger, 'find_text', async ({ url, pattern }) => {
    const page = await services.smartFetcher.open(url, false);
    const haystack = page.content;
    const lower = haystack.toLocaleLowerCase();
    const needle = pattern.toLocaleLowerCase();
    const matches: Array<{ index: number; context: string }> = [];
    let from = 0;
    while (matches.length < 20) {
      const index = lower.indexOf(needle, from);
      if (index < 0) break;
      matches.push({ index, context: haystack.slice(Math.max(0,index-180), Math.min(haystack.length,index+needle.length+180)) });
      from = index + Math.max(1, needle.length);
    }
    return { url: page.final_url, pattern, count: matches.length, matches };
  }));

  server.registerTool('get_links', {
    description: 'List normalized HTTP and HTTPS links from a public web page. Relative links are converted to absolute URLs; internal_only restricts results to the final page hostname.',
    inputSchema: z.object({ url: z.string().url(), internal_only: z.boolean().default(false) }),
  }, withAudit(logger, 'get_links', async ({ url, internal_only }) => {
    const page = await services.smartFetcher.open(url, false);
    const $ = cheerio.load(page.raw_html ?? '');
    const base = new URL(page.final_url);
    const seen = new Set<string>();
    const links: Array<{ text: string; url: string }> = [];
    $('a[href]').each((_i, el) => {
      if (links.length >= 500) return false;
      const href = $(el).attr('href'); if (!href) return;
      try {
        const target = new URL(href, base);
        if (!['http:','https:'].includes(target.protocol)) return;
        if (internal_only && target.hostname !== base.hostname) return;
        target.hash = '';
        const absolute = target.toString();
        if (seen.has(absolute)) return;
        seen.add(absolute);
        links.push({ text: $(el).text().replace(/\s+/g,' ').trim().slice(0,300), url: absolute });
      } catch {}
    });
    return { url: page.final_url, internal_only, links };
  }));

  server.registerTool('fetch_json', {
    description: 'Fetch a public JSON API over SSRF-safe HTTP(S). Intended for public GET/HEAD endpoints only; sensitive proxy headers and credentials are rejected.',
    inputSchema: z.object({
      url: z.string().url(), method: z.enum(['GET','HEAD']).default('GET'),
      headers: z.record(z.string(), z.string()).default({}),
    }),
  }, withAudit(logger, 'fetch_json', async ({ url, method, headers }) => {
    const blocked = new Set(['authorization','proxy-authorization','cookie','host','connection','content-length','transfer-encoding','x-forwarded-for','x-forwarded-host','x-real-ip']);
    const safeHeaders: Record<string,string> = {};
    for (const [key, value] of Object.entries(headers)) {
      if (blocked.has(key.toLowerCase())) throw new Error(`Header is not allowed: ${key}`);
      safeHeaders[key] = String(value);
    }
    safeHeaders.accept ??= 'application/json';
    const response = await services.safeFetcher.fetch(url, { method, headers: safeHeaders, maxBytes: services.config.MAX_DOWNLOAD_BYTES });
    const text = response.body.toString('utf8');
    let data: unknown = null;
    if (method !== 'HEAD' && text) data = JSON.parse(text);
    return { url, final_url: response.finalUrl, status: response.status, content_type: response.contentType, data, truncated: response.truncated };
  }));
}
