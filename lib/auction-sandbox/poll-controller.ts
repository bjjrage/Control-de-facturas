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
 *  - unknown: the timeout (or an undrainable poll) fired first. The mutation
 *    MAY still complete server-side — the caller must reconcile from fresh
 *    state and must NOT blind-retry while ambiguous. `detail` carries a
 *    human-ready hint for the specific unknown cause.
 */
export type MutationOutcome<T> =
  | { status: 'done'; value: T }
  | { status: 'unknown'; label: string; elapsedMs: number; detail?: string };

/** Max time runMutation waits for an in-flight poll to drain. */
export const DRAIN_TIMEOUT_MS = 5000;

/** Shown when a stuck poll blocks a mutation. */
export const DRAIN_TIMEOUT_MESSAGE =
  'La lectura actual no terminó. Recargá la sala antes de reintentar.';

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
    return this.executePoll();
  }

  /** Poll bypassing only the suspension gate (keeps the in-flight guard). */
  private async tickForce(): Promise<'polled' | 'skipped'> {
    if (this.inFlight) {
      this.skippedCount += 1;
      return 'skipped';
    }
    return this.executePoll();
  }

  private async executePoll(): Promise<'polled'> {
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
   *  2. wait for any currently in-flight poll to settle — with a SHORT
   *     timeout: a stuck poll must never wedge a mutation. On drain timeout
   *     the mutation does NOT run (no overlap, ever);
   *  3. run the mutation with a timeout;
   *  4. exactly one authoritative refresh — unless the mutation timed out,
   *     in which case polling stays suspended until the late promise
   *     settles, and only then refreshes + resumes (no overlap with the
   *     orphan, no premature mutating polls);
   *  5. resume normal polling.
   *
   * A mutation timeout resolves { status: 'unknown' } — the mutation may
   * still complete server-side, so the caller must RECONCILE by reading fresh
   * state (never blind-retry while ambiguous). Genuine fn() rejections
   * propagate (after the refresh rules below).
   */
  async runMutation<T>(
    fn: () => Promise<T>,
    timeoutMs: number,
    label: string,
    opts?: { drainTimeoutMs?: number }
  ): Promise<MutationOutcome<T>> {
    this.suspend();
    try {
      // Drain with a leash: never overlap the mutation with a stuck poll.
      const drainMs = opts?.drainTimeoutMs ?? DRAIN_TIMEOUT_MS;
      const drained = await this.drainInflight(drainMs);
      if (!drained) {
        this.resume();
        await this.tick();
        return { status: 'unknown', label, elapsedMs: drainMs, detail: DRAIN_TIMEOUT_MESSAGE };
      }
      const task = fn();
      try {
        const value = await withTimeout(task, timeoutMs, label);
        this.resume();
        await this.tick();
        return { status: 'done', value };
      } catch (e) {
        if (!(e instanceof TimeoutError)) {
          this.resume();
          await this.tick();
          throw e;
        }
        // Timeout: fn() is still alive (orphan). Hold the suspension — no new
        // mutating polls — and refresh + resume only when it settles.
        void task.then(
          () => void this.settleOrphan(),
          () => void this.settleOrphan()
        );
        return { status: 'unknown', label, elapsedMs: timeoutMs };
      }
    } catch (e) {
      // Defensive: never leak a suspension on unexpected paths.
      this.resume();
      throw e;
    }
  }

  /**
   * Settles an orphaned (timed-out but still running) mutation: one
   * authoritative refresh, then resume. Runs at most once per orphan —
   * guarded so a second orphan/settle cycle cannot double-refresh.
   */
  private orphanSettling = false;

  private async settleOrphan(): Promise<void> {
    if (this.orphanSettling) return;
    this.orphanSettling = true;
    try {
      await this.tickForce();
    } finally {
      this.orphanSettling = false;
      this.resume();
    }
  }

  /** Waits for the in-flight poll (if any), up to `ms`. Never throws. */
  private async drainInflight(ms: number): Promise<boolean> {
    const inflight = this.inFlightPromise;
    if (!inflight) return true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      await Promise.race([
        inflight.catch(() => {}),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, ms);
        }),
      ]);
      return this.inFlightPromise === null;
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  }
}
