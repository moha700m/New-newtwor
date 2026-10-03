type Bucket = { count: number; resetAt: number };
export class FixedWindowRateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  constructor(private readonly max: number, private readonly windowMs: number) {}
  take(key: string) {
    const now = Date.now();
    const current = this.buckets.get(key);
    if (!current || current.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      return { allowed: true, remaining: this.max - 1 };
    }
    if (current.count >= this.max) return { allowed: false, remaining: 0, retryAfterMs: current.resetAt - now };
    current.count++;
    return { allowed: true, remaining: this.max - current.count };
  }
}
