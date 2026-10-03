import { McpServer } from '@modelcontextprotocol/server';
import type { Services } from '../services.js';
import { registerWebTools } from './tools/web.js';
import { registerBrowserTools } from './tools/browser.js';

export function createOpenWebMcpServer(services: Services) {
  const server = new McpServer({ name: 'open-web-mcp', version: '1.0.0' });
  registerWebTools(server, services, services.logger);
  registerBrowserTools(server, services, services.logger);
  return server;
}
