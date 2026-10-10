/**
 * Retry and pace helpers for the site-people loops (D73). Exponential
 * backoff with jitter on 429 / 5xx; a process-wide token bucket so Gemini
 * stays just under the configured RPM; a per-host cap so two workers do
 * not hammer the same origin. Counts only.
 */

export function isRetryable(err: unknown): boolean {
  const m = String(err);
  return /(?:^|\D)(429|5\d\d)(?:\D|$)|rate limit|RESOURCE_EXHAUSTED|Too Many|aborted|timeout|ECONNRESET|fetch failed/i.test(m);
}

export function backoffMs(attempt: number, baseMs = 400, capMs = 16_000): number {
  const exp = Math.min(capMs, baseMs * 2 ** attempt);
  return exp + Math.floor(Math.random() * exp * 0.4);
}

export async function withBackoff<T>(fn: () => Promise<T>, opts: { attempts?: number; sleep?: (ms: number) => Promise<void>; now?: () => number } = {}): Promise<T> {
  const attempts = opts.attempts ?? 5;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (!isRetryable(e) || i === attempts - 1) throw e;
      await sleep(backoffMs(i));
    }
  }
  throw last;
}

/** Process-wide request-per-minute bucket. `take()` waits when the bucket is empty. */
export class RpmLimiter {
  private tokens: number;
  private last = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(
    readonly rpm: number,
    private readonly now: () => number = Date.now,
  ) {
    if (!Number.isFinite(rpm) || rpm < 1) throw new Error("rpm must be at least 1");
    this.tokens = rpm;
    this.last = this.now();
  }

  async take(): Promise<void> {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }
    return new Promise((resolve) => {
      this.waiters.push(() => {
        this.tokens -= 1;
        resolve();
      });
    });
  }

  private refill(): void {
    const t = this.now();
    const add = ((t - this.last) / 60_000) * this.rpm;
    if (add > 0) {
      this.tokens = Math.min(this.rpm, this.tokens + add);
      this.last = t;
    }
    while (this.tokens >= 1 && this.waiters.length) this.waiters.shift()!();
  }
}

/** At most `max` in-flight tasks per host (registrable hostname, lower case, no www). */
export class HostCap {
  private readonly inflight = new Map<string, number>();
  private readonly waiters: Array<{ host: string; grant: () => void }> = [];

  constructor(readonly max: number) {
    if (!Number.isInteger(max) || max < 1) throw new Error("host cap must be at least 1");
  }

  static hostOf(urlOrDomain: string): string {
    const raw = urlOrDomain.trim().toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, "").split(/[/:?]/)[0] ?? "";
    return raw;
  }

  async run<T>(urlOrDomain: string, fn: () => Promise<T>): Promise<T> {
    const host = HostCap.hostOf(urlOrDomain) || "_";
    await this.acquire(host);
    try {
      return await fn();
    } finally {
      this.release(host);
    }
  }

  private n(host: string): number {
    return this.inflight.get(host) ?? 0;
  }

  private acquire(host: string): Promise<void> {
    if (this.n(host) < this.max) {
      this.inflight.set(host, this.n(host) + 1);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.waiters.push({
        host,
        grant: () => {
          this.inflight.set(host, this.n(host) + 1);
          resolve();
        },
      });
    });
  }

  private release(host: string): void {
    const left = this.n(host) - 1;
    if (left <= 0) this.inflight.delete(host);
    else this.inflight.set(host, left);
    const i = this.waiters.findIndex((w) => this.n(w.host) < this.max);
    if (i >= 0) {
      const w = this.waiters.splice(i, 1)[0]!;
      w.grant();
    }
  }
}
