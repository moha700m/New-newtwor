import { afterEach, describe, expect, it, vi } from 'vitest';
import { SearxngProvider } from '../src/search/searxng.js';

afterEach(() => vi.restoreAllMocks());

describe('SearxngProvider', () => {
  it('normalizes search results', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ results: [{ title:'A', url:'https://example.com', content:'B', engine:'duckduckgo' }] }), { status: 200, headers: { 'content-type':'application/json' } })));
    const provider = new SearxngProvider('https://search.example/');
    const results = await provider.search({ query:'test', limit:10, language:'auto', freshness:'any' });
    expect(results).toEqual([{ title:'A', url:'https://example.com', snippet:'B', source:'duckduckgo', published_at:null }]);
  });
});
