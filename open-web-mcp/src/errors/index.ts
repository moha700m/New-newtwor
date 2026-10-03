export class OpenWebError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable = false,
    public readonly statusCode = 500,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidUrlError extends OpenWebError {
  constructor(message = 'Invalid URL') { super('INVALID_URL', message, false, 400); }
}
export class BlockedAddressError extends OpenWebError {
  constructor(message = 'URL resolves to a blocked or non-public address') { super('BLOCKED_ADDRESS', message, false, 403); }
}
export class NavigationTimeoutError extends OpenWebError {
  constructor(message = 'Navigation timed out') { super('TIMEOUT', message, true, 504); }
}
export class ContentTooLargeError extends OpenWebError {
  constructor(message = 'Response exceeds configured content limit') { super('CONTENT_TOO_LARGE', message, false, 413); }
}
export class SearchProviderError extends OpenWebError {
  constructor(message = 'Search provider failed', retryable = true) { super('SEARCH_PROVIDER_ERROR', message, retryable, 502); }
}
export class BrowserSessionError extends OpenWebError {
  constructor(message = 'Browser session error') { super('BROWSER_SESSION_ERROR', message, false, 400); }
}
export class AuthenticationError extends OpenWebError {
  constructor(message = 'Unauthorized') { super('UNAUTHORIZED', message, false, 401); }
}

export function toPublicError(error: unknown) {
  if (error instanceof OpenWebError) {
    return { error: { code: error.code, message: error.message, retryable: error.retryable } };
  }
  const message = error instanceof Error ? error.message : 'Unknown error';
  return { error: { code: 'INTERNAL_ERROR', message, retryable: false } };
}
