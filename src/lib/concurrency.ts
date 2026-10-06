/**
 * Work for one client overlaps, and work for different clients overlaps.
 * `withinClient` is the cap for a single client. `acrossClients` is the cap
 * for every client together. A full client does not hold slots another
 * client could use.
 */
export class Overlap {
  private globalInFlight = 0;
  private readonly byClient = new Map<string, number>();
  private readonly waiters: Array<{ clientTag: string; grant: () => void }> = [];

  constructor(
    readonly withinClient: number,
    readonly acrossClients: number,
  ) {
    if (!Number.isInteger(withinClient) || withinClient < 1) throw new Error("withinClient must be at least 1");
    if (!Number.isInteger(acrossClients) || acrossClients < 1) throw new Error("acrossClients must be at least 1");
  }

  async run<T>(clientTag: string, fn: () => Promise<T>): Promise<T> {
    await this.acquire(clientTag);
    try {
      return await fn();
    } finally {
      this.release(clientTag);
    }
  }

  private inFlight(clientTag: string): number {
    return this.byClient.get(clientTag) ?? 0;
  }

  private canStart(clientTag: string): boolean {
    return this.inFlight(clientTag) < this.withinClient && this.globalInFlight < this.acrossClients;
  }

  private take(clientTag: string): void {
    this.byClient.set(clientTag, this.inFlight(clientTag) + 1);
    this.globalInFlight += 1;
  }

  private acquire(clientTag: string): Promise<void> {
    if (this.canStart(clientTag)) {
      this.take(clientTag);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.waiters.push({
        clientTag,
        grant: () => {
          this.take(clientTag);
          resolve();
        },
      });
    });
  }

  private release(clientTag: string): void {
    const left = this.inFlight(clientTag) - 1;
    if (left <= 0) this.byClient.delete(clientTag);
    else this.byClient.set(clientTag, left);
    this.globalInFlight -= 1;
    this.pump();
  }

  /** First waiter that fits runs. A saturated client is skipped so another client can start. */
  private pump(): void {
    for (let i = 0; i < this.waiters.length; ) {
      const waiter = this.waiters[i]!;
      if (!this.canStart(waiter.clientTag)) {
        i += 1;
        continue;
      }
      this.waiters.splice(i, 1);
      waiter.grant();
    }
  }
}

/** One client's lists at a time, and every client's lists together. */
export const SIZE_WITHIN_CLIENT = 4;
export const SIZE_ACROSS_CLIENTS = 8;

/** Lane checks overlap the same way, with a smaller cap so the db pool stays free for a size. */
export const WATCH_WITHIN_CLIENT = 2;
export const WATCH_ACROSS_CLIENTS = 4;
