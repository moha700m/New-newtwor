import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { Logger } from 'pino';
import type { Services } from '../../services.js';
import { jsonContent, withAudit } from './helpers.js';
import { toPublicError } from '../../errors/index.js';

export function registerBrowserTools(server: McpServer, services: Services, logger: Logger) {
  server.registerTool('screenshot', {
    description: 'Capture a PNG screenshot of a public web page in an isolated browser context. Returns the image as MCP image content plus structured page metadata.',
    inputSchema: z.object({ url: z.string().url(), full_page: z.boolean().default(false), width: z.number().int().min(320).max(3840).default(1440), height: z.number().int().min(240).max(2160).default(900) }),
  }, async (input) => {
    const started = performance.now();
    try {
      const image = await services.browser.screenshotUrl(input.url, input.full_page, input.width, input.height);
      const structuredContent = { url: image.url, title: image.title, mime_type: image.mimeType, width: input.width, height: input.height, full_page: input.full_page };
      logger.info({ request_id: randomUUID(), tool: 'screenshot', duration_ms: Math.round(performance.now()-started), status:'ok', hostname:new URL(input.url).hostname, browser_used:true, cache_hit:false }, 'mcp tool completed');
      return { structuredContent, content: [...jsonContent(structuredContent), { type: 'image' as const, data: image.base64, mimeType: image.mimeType }] };
    } catch (error) {
      const publicError = toPublicError(error);
      return { isError: true, structuredContent: publicError, content: jsonContent(publicError) };
    }
  });

  server.registerTool('browser_navigate', {
    description: 'Open a persistent isolated browser session at a public URL. Use the returned session_id with browser_snapshot and later browser interaction tools.',
    inputSchema: z.object({ url: z.string().url() }),
  }, withAudit(logger, 'browser_navigate', async ({ url }) => services.browser.navigate(url)));

  server.registerTool('browser_snapshot', {
    description: 'Return a compact snapshot of links, buttons, inputs, selects, and textareas in an existing browser session. Elements receive stable session-local ids such as e12 for later interaction.',
    inputSchema: z.object({ session_id: z.string().uuid() }),
  }, withAudit(logger, 'browser_snapshot', async ({ session_id }) => services.browser.snapshot(session_id)));

  server.registerTool('browser_click', {
    description: 'Click an interactive element previously returned by browser_snapshot, using its stable session-local element_id.',
    inputSchema: z.object({ session_id: z.string().uuid(), element_id: z.string().regex(/^e\d+$/) }),
  }, withAudit(logger, 'browser_click', async ({ session_id, element_id }) => services.browser.click(session_id, element_id)));

  server.registerTool('browser_type', {
    description: 'Fill an input or textarea previously returned by browser_snapshot. This replaces the current value and does not submit the form automatically.',
    inputSchema: z.object({ session_id: z.string().uuid(), element_id: z.string().regex(/^e\d+$/), text: z.string().max(20_000) }),
  }, withAudit(logger, 'browser_type', async ({ session_id, element_id, text }) => services.browser.type(session_id, element_id, text)));

  server.registerTool('browser_select', {
    description: 'Select an option by value in a select element previously returned by browser_snapshot.',
    inputSchema: z.object({ session_id: z.string().uuid(), element_id: z.string().regex(/^e\d+$/), value: z.string().max(2_000) }),
  }, withAudit(logger, 'browser_select', async ({ session_id, element_id, value }) => services.browser.select(session_id, element_id, value)));

  server.registerTool('browser_back', {
    description: 'Navigate an existing browser session back one history entry and return its current URL and title.',
    inputSchema: z.object({ session_id: z.string().uuid() }),
  }, withAudit(logger, 'browser_back', async ({ session_id }) => services.browser.back(session_id)));

  server.registerTool('browser_reload', {
    description: 'Reload the current page in an existing browser session and return its URL and title.',
    inputSchema: z.object({ session_id: z.string().uuid() }),
  }, withAudit(logger, 'browser_reload', async ({ session_id }) => services.browser.reload(session_id)));

  server.registerTool('browser_close', {
    description: 'Close an existing browser session immediately and release its isolated Chromium context and concurrency slot.',
    inputSchema: z.object({ session_id: z.string().uuid() }),
  }, withAudit(logger, 'browser_close', async ({ session_id }) => services.browser.closeSession(session_id)));
}
