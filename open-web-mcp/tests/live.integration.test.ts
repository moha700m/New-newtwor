import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/env.js';
import { SafeFetcher } from '../src/fetch/fetcher.js';
import { BrowserManager } from '../src/browser/manager.js';

const live = process.env.RUN_LIVE_TESTS === '1' ? describe : describe.skip;

live('live integration', () => {
  const config = loadConfig({ ...process.env, NODE_ENV:'test', ENABLE_DDG_FALLBACK:'true' });
  it('blocks redirect attempts to private addresses', async () => {
    const fetcher = new SafeFetcher(config);
    await expect(fetcher.fetch('https://httpbin.org/redirect-to?url=http://127.0.0.1/')).rejects.toThrow();
  }, 30_000);
  it('supports persistent browser navigate, snapshot, type, click, close', async () => {
    const browser = new BrowserManager(config);
    try {
      const nav = await browser.navigate('https://www.wikipedia.org/');
      const snapshot = await browser.snapshot(nav.session_id);
      const input = snapshot.elements.find((e) => e.type === 'input');
      expect(input).toBeTruthy();
      await browser.type(nav.session_id, input!.id, 'OpenAI');
      const after = await browser.snapshot(nav.session_id);
      const button = after.elements.find((e) => e.type === 'button');
      expect(button).toBeTruthy();
      await browser.click(nav.session_id, button!.id);
      const closed = await browser.closeSession(nav.session_id);
      expect(closed.closed).toBe(true);
    } finally { await browser.shutdown(); }
  }, 60_000);
});
