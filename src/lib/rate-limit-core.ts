type Bucket = { count: number; resetsAt: number };

export class FixedWindowRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly maxBuckets: number) {}

  consume(
    key: string,
    options: { limit: number; windowMs: number },
    now = Date.now()
  ): boolean {
    const existing = this.buckets.get(key);
    if (!existing || existing.resetsAt <= now) {
      this.buckets.set(key, { count: 1, resetsAt: now + options.windowMs });
      this.evictToCapacity(key);
      return true;
    }
    if (existing.count >= options.limit) return false;
    existing.count += 1;
    return true;
  }

  reset(): void {
    this.buckets.clear();
  }

  get size(): number {
    return this.buckets.size;
  }

  private evictToCapacity(protectedKey: string): void {
    if (this.buckets.size <= this.maxBuckets) return;
    const excess = this.buckets.size - this.maxBuckets;
    const candidates = [...this.buckets.entries()]
      .filter(([key]) => key !== protectedKey)
      .sort((left, right) => left[1].resetsAt - right[1].resetsAt);
    for (let index = 0; index < excess; index += 1) {
      const candidate = candidates[index];
      if (candidate) this.buckets.delete(candidate[0]);
    }
  }
}
