import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import { toPublicError } from '../../errors/index.js';

export function jsonContent(value: unknown) {
  return [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }];
}

export function toolResult(value: Record<string, unknown>) {
  return { structuredContent: value, content: jsonContent(value) };
}

export function withAudit(
  logger: Logger,
  tool: string,
  handler: (input: any) => Promise<any>,
) {
  return async (input: any) => {
    const requestId = randomUUID();
    const started = performance.now();
    let hostname: string | undefined;
    const url = typeof input.url === 'string' ? input.url : undefined;
    if (url) { try { hostname = new URL(url).hostname; } catch {} }
    try {
      const value = await handler(input);
      const objectValue = (typeof value === 'object' && value !== null ? value : { value }) as Record<string, unknown>;
      logger.info({ request_id: requestId, tool, duration_ms: Math.round(performance.now() - started), status: 'ok', hostname,
        browser_used: (objectValue.metadata as any)?.browser_used ?? (tool.startsWith('browser_') || tool === 'screenshot'),
        cache_hit: (objectValue.metadata as any)?.cache_hit ?? objectValue.cache_hit ?? false }, 'mcp tool completed');
      return toolResult(objectValue);
    } catch (error) {
      const publicError = toPublicError(error);
      logger.warn({ request_id: requestId, tool, duration_ms: Math.round(performance.now() - started), status: 'error', hostname,
        error_code: publicError.error.code }, 'mcp tool failed');
      return { isError: true, structuredContent: publicError, content: jsonContent(publicError) };
    }
  };
}
