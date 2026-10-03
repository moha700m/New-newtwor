import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const base = process.env.MCP_BASE_URL ?? 'http://127.0.0.1:8787';
const apiKey = process.env.MCP_API_KEY;

for (const path of ['/health', '/ready']) {
  const response = await fetch(`${base}${path}`);
  const body = await response.text();
  console.log(path, response.status, body);
  if (!response.ok) process.exitCode = 1;
}

const requestInit: RequestInit = apiKey
  ? { headers: { Authorization: `Bearer ${apiKey}` } }
  : {};
const client = new Client(
  { name: 'open-web-mcp-smoke', version: '1.0.0' },
  { versionNegotiation: { mode: 'auto' } },
);
const transport = new StreamableHTTPClientTransport(new URL('/mcp', base), { requestInit });

try {
  await client.connect(transport);
  const tools = await client.listTools();
  console.log('tools', tools.tools.map((tool) => tool.name).join(', '));

  const search = await client.callTool({
    name: 'search_web',
    arguments: { query: 'OpenAI MCP', limit: 3, language: 'en', freshness: 'any' },
  });
  console.log('search_web', JSON.stringify(search.structuredContent ?? search.content).slice(0, 1000));

  const opened = await client.callTool({
    name: 'open_url',
    arguments: { url: 'https://modelcontextprotocol.io/', render_js: false },
  });
  console.log('open_url', JSON.stringify(opened.structuredContent ?? opened.content).slice(0, 1000));

  const extracted = await client.callTool({
    name: 'extract_page',
    arguments: { url: 'https://modelcontextprotocol.io/', format: 'markdown' },
  });
  console.log('extract_page', JSON.stringify(extracted.structuredContent ?? extracted.content).slice(0, 1000));

  const nav = await client.callTool({
    name: 'browser_navigate',
    arguments: { url: 'https://www.wikipedia.org/' },
  });
  const sessionId = (nav.structuredContent as { session_id?: string } | undefined)?.session_id;
  if (!sessionId) throw new Error('browser_navigate did not return session_id');

  const snapshot = await client.callTool({ name: 'browser_snapshot', arguments: { session_id: sessionId } });
  console.log('browser_snapshot', JSON.stringify(snapshot.structuredContent ?? snapshot.content).slice(0, 1000));

  const closed = await client.callTool({ name: 'browser_close', arguments: { session_id: sessionId } });
  console.log('browser_close', JSON.stringify(closed.structuredContent ?? closed.content));
} finally {
  await transport.terminateSession().catch(() => {});
  await client.close();
}
