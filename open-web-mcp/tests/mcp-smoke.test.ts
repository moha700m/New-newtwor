import { afterEach, describe, expect, it } from 'vitest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { buildApp, type OpenWebApp } from '../src/server.js';

let runtime: OpenWebApp | undefined;
afterEach(async () => { await runtime?.close(); runtime = undefined; });

describe('MCP smoke', () => {
  it('negotiates MCP and lists tools over /mcp', async () => {
    runtime = buildApp({ ...process.env, NODE_ENV:'test', ENABLE_DDG_FALLBACK:'true', MCP_ALLOWED_HOSTS:'127.0.0.1' });
    const origin = await runtime.app.listen({ host: '127.0.0.1', port: 0 });
    const client = new Client(
      { name: 'open-web-mcp-smoke', version: '1.0.0' },
      { versionNegotiation: { mode: 'auto' } },
    );
    const transport = new StreamableHTTPClientTransport(new URL('/mcp', origin));
    try {
      await client.connect(transport);
      const tools = await client.listTools();
      const names = tools.tools.map((tool) => tool.name);
      expect(names).toContain('search_web');
      expect(names).toContain('browser_navigate');
      expect(names).toContain('browser_close');
    } finally {
      await transport.terminateSession().catch(() => {});
      await client.close();
    }
  });
});
