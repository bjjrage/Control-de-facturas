/**
 * AUCTION SANDBOX — Poll controller (client-side, framework-free).
 *
 * Defect class it fixes (observed in production): unbounded 1s setInterval
 * polls overlapping each other AND overlapping interactive mutations that hit
 * the same room row (advance/tick vs start/bid) — with no timeout anywhere,
 * a slow action wedged the UI forever ("Iniciando…" eternamente).
 *
 * Guarantees:
 *  - never two polls from the same client concurrently (skip when in flight);
 *  - a mutation NEVER overlaps a poll: it suspends new ticks, WAITS for any
 *    in-flight poll to settle, then runs;
 *  - every mutation runs with a timeout and ends with exactly one
 *    authoritative refresh;
 *  - a timeout is NOT a failure verdict: the mutation may complete later, so
 *    runMutation resolves { status: 'unknown' } (never a blind retry, never
 *    a duplicate submit from this path) and the caller reconciles by reading
 *    fresh state (e.g. room already ACTIVE → reconciled success).
 */
export class TimeoutError extends Error {
  constructor(
    public readonly label: string,
    public readonly timeoutMs: number
  ) {
    super(`${label} tardó más de ${Math.round(timeoutMs / 1000)}s sin responder.`);
    this.name = 'TimeoutError';
  }
}

/** Rejects if `promise` does not settle within `ms`. Never swallows rejections. */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== null) clearTimeout(timer);
  });
}

export interface PollControllerOptions {
  intervalMs: number;
}

/**
 * Outcome of runMutation:
 *  - done: the mutation settled in time; `value` is fn()'s result.
 *  - unknown: the timeout fired first. The mutation MAY still complete
 *    server-side — the caller must reconcile from fresh state and must NOT
 *    blind-retry while ambiguous.
 */
export type MutationOutcome<T> =
  | { status: 'done'; value: T }
  | { status: 'unknown'; label: string; elapsedMs: number };

export class PollController {
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight: boolean = false;
  private inFlightPromise: Promise<unknown> | null = null;
  private inFlightSlot: object | null = null;
  private suspended = 0;
  private pollCount = 0;
  private skippedCount = 0;

  constructor(
    private readonly poll: () => Promise<unknown>,
    private readonly options: PollControllerOptions
  ) {}

  get isRunning(): boolean {
    return this.timer !== null;
  }

  get isSuspended(): boolean {
    return this.suspended > 0;
  }

  get stats(): { polls: number; skipped: number } {
    return { polls: this.pollCount, skipped: this.skippedCount };
  }

  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => void this.tick(), this.options.intervalMs);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  suspend(): void {
    this.suspended += 1;
  }

  resume(): void {
    if (this.suspended > 0) this.suspended -= 1;
  }

  /** One guarded poll: skipped while suspended or when another poll is in flight. */
  async tick(): Promise<'polled' | 'skipped'> {
    if (this.suspended > 0 || this.inFlight) {
      this.skippedCount += 1;
      return 'skipped';
    }
    this.inFlight = true;
    const slot: object = {};
    this.inFlightSlot = slot;
    const current = (async () => {
      try {
        await this.poll();
      } finally {
        this.inFlight = false;
        if (this.inFlightSlot === slot) {
          this.inFlightSlot = null;
          this.inFlightPromise = null;
        }
      }
    })();
    this.inFlightPromise = current;
    try {
      await current;
      this.pollCount += 1;
      return 'polled';
    } catch {
      // Poll errors belong to the poller (it surfaces them in UI state);
      // tick still settles so timers/mutations never wedge on a bad poll.
      return 'polled';
    }
  }

  /**
   * Runs an interactive mutation with full exclusion:
   *  1. suspend new ticks;
   *  2. wait for any currently in-flight poll to settle (it cannot be
   *     cancelled — its result is simply observed, never trusted blindly);
   *  3. run the mutation with a timeout;
   *  4. exactly one authoritative refresh;
   *  5. resume normal polling.
   *
   * A timeout resolves { status: 'unknown' } — the mutation may still
   * complete server-side, so the caller must RECONCILE by reading fresh state
   * (never blind-retry while ambiguous). Genuine fn() rejections propagate.
   */
  async runMutation<T>(fn: () => Promise<T>, timeoutMs: number, label: string): Promise<MutationOutcome<T>> {
    this.suspend();
    try {
      const inflight = this.inFlightPromise;
      if (inflight) {
        try {
          await inflight;
        } catch {
          // Settled (possibly failed) — what matters is that it finished.
        }
      }
      try {
        const value = await withTimeout(fn(), timeoutMs, label);
        return { status: 'done', value };
      } catch (e) {
        if (e instanceof TimeoutError) {
          return { status: 'unknown', label, elapsedMs: timeoutMs };
        }
        throw e;
      }
    } finally {
      this.resume();
      await this.tick();
    }
  }
}
