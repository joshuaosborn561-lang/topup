import { redact } from "../lib/log.js";

/**
 * Every vendor call a size makes, with its outcome, kept on the step (D48).
 * ok or not, the HTTP status when there was one, the message with addresses
 * stripped, and how long it took. Never a row. The AI Ark error that used to
 * vanish is the first entry this exists for.
 */
export interface VendorCall {
  vendor: string;
  action: string;
  ok: boolean;
  status: number | null;
  message: string | null;
  ms: number;
  rows: number | null;
  /** Reused from a cached size instead of sent. */
  cached?: boolean;
}

export const VENDOR_LOG_MAX = 60;

function httpStatus(message: string): number | null {
  const m = /HTTP (\d{3})/.exec(message);
  return m ? Number(m[1]) : null;
}

export class VendorCallLog {
  readonly calls: VendorCall[] = [];

  constructor(private readonly now: () => number = () => Date.now()) {}

  /** Time a call and record it, ok or thrown. The error is rethrown after it is logged. */
  async time<T>(vendor: string, action: string, fn: () => Promise<T>, rows: (value: T) => number | null = () => null): Promise<T> {
    const started = this.now();
    try {
      const value = await fn();
      this.push({ vendor, action, ok: true, status: null, message: null, ms: this.now() - started, rows: rows(value) });
      return value;
    } catch (err) {
      const message = String(redact((err as Error).message ?? String(err))).slice(0, 300);
      this.push({ vendor, action, ok: false, status: httpStatus(message), message, ms: this.now() - started, rows: null });
      throw err;
    }
  }

  note(call: Omit<VendorCall, "ms"> & { ms?: number }): void {
    this.push({ ...call, ms: call.ms ?? 0, message: call.message ? String(redact(call.message)).slice(0, 300) : null });
  }

  private push(call: VendorCall): void {
    if (this.calls.length < VENDOR_LOG_MAX) this.calls.push(call);
    else this.calls[VENDOR_LOG_MAX - 1] = { ...call, message: `${call.message ?? ""} (log capped at ${VENDOR_LOG_MAX})`.trim() };
  }

  summary(): { vendor_calls: number; vendor_calls_failed: number; vendor_calls_cached: number } {
    return {
      vendor_calls: this.calls.length,
      vendor_calls_failed: this.calls.filter((c) => !c.ok).length,
      vendor_calls_cached: this.calls.filter((c) => c.cached).length,
    };
  }
}
