import { describe, expect, it, vi } from 'vitest';
import { MemoryLruCache } from '../src/cache/memory.js';

describe('MemoryLruCache', () => {
  it('expires entries and evicts least recently used entries', () => {
    vi.useFakeTimers();
    const cache = new MemoryLruCache(2);
    cache.set('a', 1, 10); cache.set('b', 2, 10);
    expect(cache.get<number>('a')).toBe(1);
    cache.set('c', 3, 10);
    expect(cache.get('b')).toBeUndefined();
    vi.advanceTimersByTime(11_000);
    expect(cache.get('a')).toBeUndefined();
    vi.useRealTimers();
  });
});
