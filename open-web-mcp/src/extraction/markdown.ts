import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';

function cleanText(input: string) {
  return input.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

export function htmlToMarkdown(html: string, baseUrl?: string): string {
  const $ = cheerio.load(html);
  $('script,style,noscript,svg,canvas,template').remove();

  function render(node: AnyNode): string {
    if (node.type === 'text') return (node as any).data ?? '';
    if (node.type !== 'tag') return '';
    const el = node as any;
    const name = el.name.toLowerCase();
    const inner = (el.children ?? []).map(render).join('');
    if (/^h[1-6]$/.test(name)) return `\n\n${'#'.repeat(Number(name[1]))} ${cleanText(inner)}\n\n`;
    if (name === 'p' || name === 'div' || name === 'section' || name === 'article') return `\n\n${inner}\n\n`;
    if (name === 'br') return '\n';
    if (name === 'strong' || name === 'b') return `**${inner}**`;
    if (name === 'em' || name === 'i') return `*${inner}*`;
    if (name === 'code') return `\`${inner.replace(/`/g, '\\`')}\``;
    if (name === 'pre') return `\n\n\`\`\`\n${$(el).text().trim()}\n\`\`\`\n\n`;
    if (name === 'blockquote') return `\n\n${cleanText(inner).split('\n').map((line) => `> ${line}`).join('\n')}\n\n`;
    if (name === 'li') return `\n- ${cleanText(inner)}`;
    if (name === 'ul' || name === 'ol') return `\n${inner}\n`;
    if (name === 'a') {
      const raw = el.attribs?.href;
      if (!raw) return inner;
      let href = raw;
      try { if (baseUrl) href = new URL(raw, baseUrl).toString(); } catch {}
      const text = cleanText(inner) || href;
      return `[${text}](${href})`;
    }
    return inner;
  }

  const root = $.root().get(0) as any;
  return cleanText((root.children ?? []).map(render).join(''));
}

export function htmlToText(html: string) {
  const $ = cheerio.load(html);
  $('script,style,noscript,svg,canvas,template').remove();
  return cleanText($.text());
}
