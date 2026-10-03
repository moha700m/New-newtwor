export interface CacheProvider {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T, ttlSeconds: number): void;
  delete(key: string): void;
  clear(): void;
}
