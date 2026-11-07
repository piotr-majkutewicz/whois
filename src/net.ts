// Outbound requests with a hard budget, a time limit per call, a total deadline and bounded concurrency.

export interface NetOptions {
  /** Maximum number of outbound requests for one lookup (Workers limit the count per invocation). */
  maxRequests: number;
  callTimeoutMs: number;
  totalTimeoutMs: number;
  concurrency: number;
}

export const DEFAULT_NET_OPTIONS: NetOptions = { maxRequests: 30, callTimeoutMs: 4000, totalTimeoutMs: 12000, concurrency: 6 };

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type NetResult =
  | { kind: "response"; status: number; contentType: string; retryAfterSec: number | null; body: unknown | null; finalUrl: string }
  | { kind: "error"; reason: "timeout" | "network" | "budget" | "deadline" };

const MAX_BODY_CHARS = 1_500_000;

export class Net {
  used = 0;
  budgetHit = false;
  deadlineHit = false;
  private active = 0;
  private waiting: (() => void)[] = [];
  private startedAt: number;

  constructor(
    private fetchImpl: FetchLike,
    readonly options: NetOptions = DEFAULT_NET_OPTIONS,
    private now: () => number = Date.now,
  ) {
    this.startedAt = now();
  }

  remainingMs(): number {
    return this.options.totalTimeoutMs - (this.now() - this.startedAt);
  }

  private async acquire(): Promise<void> {
    if (this.active < this.options.concurrency) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve) => this.waiting.push(resolve));
  }

  private release(): void {
    const next = this.waiting.shift();
    if (next) next();
    else this.active--;
  }

  /** GET a URL and read the body as JSON (null when it is not JSON). */
  async getJson(url: string, accept: string): Promise<NetResult> {
    await this.acquire();
    try {
      if (this.remainingMs() <= 0) {
        this.deadlineHit = true;
        return { kind: "error", reason: "deadline" };
      }
      if (this.used >= this.options.maxRequests) {
        this.budgetHit = true;
        return { kind: "error", reason: "budget" };
      }
      this.used++;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), Math.max(50, Math.min(this.options.callTimeoutMs, this.remainingMs())));
      try {
        const res = await this.fetchImpl(url, { headers: { accept }, signal: ctrl.signal, redirect: "follow" });
        const text = await res.text();
        let body: unknown = null;
        if (text.length <= MAX_BODY_CHARS) {
          try {
            body = JSON.parse(text);
          } catch {
            body = null;
          }
        }
        const ra = Number(res.headers.get("retry-after"));
        return {
          kind: "response",
          status: res.status,
          contentType: res.headers.get("content-type") ?? "",
          retryAfterSec: Number.isFinite(ra) && res.headers.get("retry-after") !== null ? ra : null,
          body,
          finalUrl: res.url || url,
        };
      } catch (e) {
        const aborted = ctrl.signal.aborted || (e instanceof Error && e.name === "AbortError");
        return { kind: "error", reason: aborted ? "timeout" : "network" };
      } finally {
        clearTimeout(timer);
      }
    } finally {
      this.release();
    }
  }
}
