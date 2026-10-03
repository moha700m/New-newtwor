import { Readability } from '@mozilla/readability';
import * as cheerio from 'cheerio';
import { parseHTML } from 'linkedom';
import { htmlToMarkdown, htmlToText } from './markdown.js';

export interface ExtractedPage {
  title: string;
  content: string;
  html: string;
  text: string;
  metadata: { description?: string; author?: string; publishedAt?: string };
}

function normalizeDocumentHtml(html: string, baseUrl: string) {
  const $ = cheerio.load(html);
  $('[href]').each((_i, el) => {
    const value = $(el).attr('href');
    if (!value) return;
    try { $(el).attr('href', new URL(value, baseUrl).toString()); } catch {}
  });
  $('[src]').each((_i, el) => {
    const value = $(el).attr('src');
    if (!value) return;
    try { $(el).attr('src', new URL(value, baseUrl).toString()); } catch {}
  });
  return $.html();
}

export function extractReadable(html: string, baseUrl: string): ExtractedPage {
  const normalized = normalizeDocumentHtml(html, baseUrl);
  const { document } = parseHTML(normalized);
  let article: any = null;
  try { article = new Readability(document as any).parse(); } catch {}
  const $ = cheerio.load(normalized);
  const fallbackHtml = $('main').first().html() ?? $('article').first().html() ?? $('body').html() ?? normalized;
  const articleHtml = article?.content || fallbackHtml;
  const title = article?.title || $('title').text().trim() || $('h1').first().text().trim();
  const description = $('meta[name="description"]').attr('content') ?? $('meta[property="og:description"]').attr('content');
  const author = article?.byline ?? $('meta[name="author"]').attr('content');
  const publishedAt = $('meta[property="article:published_time"]').attr('content') ?? $('time[datetime]').first().attr('datetime');
  return {
    title,
    html: articleHtml,
    text: article?.textContent?.trim() || htmlToText(articleHtml),
    content: htmlToMarkdown(articleHtml, baseUrl),
    metadata: {
      ...(description ? { description } : {}),
      ...(author ? { author } : {}),
      ...(publishedAt ? { publishedAt } : {}),
    },
  };
}

export function looksJsHeavy(html: string, text: string) {
  const scriptCount = (html.match(/<script\b/gi) ?? []).length;
  const appMarkers = /__NEXT_DATA__|__NUXT__|id=["'](?:root|app)["']|data-reactroot|webpack/i.test(html);
  return text.trim().length < 350 && (scriptCount >= 4 || appMarkers);
}
