export class Semaphore {
  private active = 0;
  private readonly queue: Array<() => void> = [];
  constructor(private readonly limit: number) {}
  async acquire() {
    if (this.active < this.limit) { this.active++; return; }
    await new Promise<void>((resolve) => this.queue.push(resolve));
    this.active++;
  }
  release() {
    this.active--;
    this.queue.shift()?.();
  }
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try { return await fn(); } finally { this.release(); }
  }
}

export class DomainThrottle {
  private readonly semaphores = new Map<string, Semaphore>();
  private readonly lastStart = new Map<string, number>();
  constructor(private readonly concurrency: number, private readonly delayMs: number) {}
  async run<T>(hostname: string, fn: () => Promise<T>) {
    const sem = this.semaphores.get(hostname) ?? new Semaphore(this.concurrency);
    this.semaphores.set(hostname, sem);
    return sem.run(async () => {
      const wait = Math.max(0, (this.lastStart.get(hostname) ?? 0) + this.delayMs - Date.now());
      if (wait) await new Promise((r) => setTimeout(r, wait));
      this.lastStart.set(hostname, Date.now());
      return fn();
    });
  }
}
