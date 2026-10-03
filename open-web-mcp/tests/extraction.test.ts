import { describe, expect, it } from 'vitest';
import { extractReadable } from '../src/extraction/readability.js';
import { htmlToMarkdown } from '../src/extraction/markdown.js';

const html = `<!doctype html><html><head><title>Example</title><meta name="author" content="Tester"></head><body><nav>Menu</nav><main><article><h1>Hello</h1><p>This is <strong>important</strong>.</p><a href="/next">Next</a></article></main><script>bad()</script></body></html>`;

describe('extraction', () => {
  it('extracts readable content and metadata', () => {
    const result = extractReadable(html, 'https://example.com/page');
    expect(result.title).toBe('Example');
    expect(result.content).toContain('Hello');
    expect(result.content).toContain('important');
    expect(result.content).toContain('https://example.com/next');
    expect(result.metadata.author).toBe('Tester');
  });
  it('converts core HTML constructs to markdown', () => {
    const markdown = htmlToMarkdown('<h2>Title</h2><p>A <a href="/x">link</a></p>', 'https://example.com');
    expect(markdown).toContain('## Title');
    expect(markdown).toContain('[link](https://example.com/x)');
  });
});
