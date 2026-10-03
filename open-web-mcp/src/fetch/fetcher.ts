import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import { ContentTooLargeError, InvalidUrlError, NavigationTimeoutError } from '../errors/index.js';
import { isPublicIp } from '../security/ip.js';
import { validatePublicUrl } from '../security/url-validator.js';
import type { Config } from '../config/env.js';
import { DomainThrottle } from '../utils/concurrency.js';

export interface FetchResult {
  url: string;
  finalUrl: string;
  status: number;
  headers: Record<string, string>;
  contentType: string;
  body: Buffer;
  truncated: boolean;
}

function normalizeHeaders(headers: http.IncomingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value !== undefined) out[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
  }
  return out;
}

function safeLookup(hostname: string, options: any, callback: any) {
  dns.lookup(hostname, { all: true, verbatim: true, family: options?.family ?? 0 }, (error, addresses) => {
    if (error) return callback(error);
    if (!addresses.length || addresses.some((entry) => !isPublicIp(entry.address))) {
      return callback(new Error(`Blocked DNS resolution for ${hostname}`));
    }
    const selected = addresses[0]!;
    callback(null, selected.address, selected.family);
  });
}

export class SafeFetcher {
  private readonly throttle: DomainThrottle;
  constructor(private readonly config: Config) {
    this.throttle = new DomainThrottle(config.PER_DOMAIN_CONCURRENCY, config.REQUEST_DELAY_MS);
  }

  async fetch(
    input: string,
    options: { method?: 'GET' | 'HEAD'; headers?: Record<string, string>; maxBytes?: number; timeoutMs?: number } = {},
  ): Promise<FetchResult> {
    const original = input;
    let current = input;
    const maxBytes = options.maxBytes ?? this.config.MAX_DOWNLOAD_BYTES;
    const timeoutMs = options.timeoutMs ?? this.config.PAGE_TIMEOUT_MS;

    for (let redirects = 0; redirects <= this.config.MAX_REDIRECTS; redirects++) {
      const { url } = await validatePublicUrl(current);
      const result = await this.throttle.run(url.hostname, () => this.requestOnce(url, { ...options, maxBytes, timeoutMs }));
      if ([301,302,303,307,308].includes(result.status) && result.headers.location) {
        if (redirects === this.config.MAX_REDIRECTS) throw new InvalidUrlError('Too many redirects');
        current = new URL(result.headers.location, url).toString();
        continue;
      }
      return { ...result, url: original, finalUrl: current };
    }
    throw new InvalidUrlError('Too many redirects');
  }

  private requestOnce(
    url: URL,
    options: { method?: 'GET' | 'HEAD'; headers?: Record<string, string>; maxBytes: number; timeoutMs: number },
  ): Promise<Omit<FetchResult, 'url' | 'finalUrl'>> {
    const transport = url.protocol === 'https:' ? https : http;
    const headers = {
      'user-agent': this.config.USER_AGENT,
      accept: '*/*',
      'accept-encoding': 'identity',
      ...options.headers,
    };

    return new Promise((resolve, reject) => {
      const req = transport.request(url, {
        method: options.method ?? 'GET',
        headers,
        lookup: safeLookup as any,
      }, (res) => {
        const responseHeaders = normalizeHeaders(res.headers);
        const contentLength = Number(responseHeaders['content-length'] ?? 0);
        if (contentLength > options.maxBytes) {
          res.destroy();
          reject(new ContentTooLargeError(`Content-Length ${contentLength} exceeds limit ${options.maxBytes}`));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        let truncated = false;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > options.maxBytes) {
            truncated = true;
            res.destroy();
            return;
          }
          chunks.push(Buffer.from(chunk));
        });
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: responseHeaders,
            contentType: responseHeaders['content-type'] ?? 'application/octet-stream',
            body: Buffer.concat(chunks),
            truncated,
          });
        });
        res.on('close', () => {
          if (truncated) {
            resolve({
              status: res.statusCode ?? 0,
              headers: responseHeaders,
              contentType: responseHeaders['content-type'] ?? 'application/octet-stream',
              body: Buffer.concat(chunks),
              truncated: true,
            });
          }
        });
        res.on('error', reject);
      });
      req.setTimeout(options.timeoutMs, () => req.destroy(new NavigationTimeoutError()));
      req.on('error', (error) => {
        if (error instanceof NavigationTimeoutError) reject(error);
        else if ((error as NodeJS.ErrnoException).code === 'ETIMEDOUT') reject(new NavigationTimeoutError());
        else reject(error);
      });
      req.end();
    });
  }
}
