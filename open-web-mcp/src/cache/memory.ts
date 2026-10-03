import type { CacheProvider } from './provider.js';

type Entry = { value: unknown; expiresAt: number };
export class MemoryLruCache implements CacheProvider {
  private readonly map = new Map<string, Entry>();
  constructor(private readonly maxEntries = 256) {}
  get<T>(key: string): T | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) { this.map.delete(key); return undefined; }
    this.map.delete(key); this.map.set(key, entry);
    return entry.value as T;
  }
  set<T>(key: string, value: T, ttlSeconds: number) {
    if (ttlSeconds <= 0) return;
    this.map.delete(key);
    this.map.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }
  delete(key: string) { this.map.delete(key); }
  clear() { this.map.clear(); }
}
