/**
 * AUCTION SANDBOX — Poll controller (client-side, framework-free).
 *
 * Defect class it fixes (observed in production): unbounded 1s setInterval
 * polls overlapping each other AND overlapping interactive mutations that hit
 * the same room row (advance/tick vs start/bid) — with no timeout anywhere,
 * a slow action wedged the UI forever ("Iniciando…" eternamente).
 *
 * Model:
 *  - never two polls from the same client concurrently (skip when in flight);
 *  - every poll runs under a timeout: a hung read can never wedge the
 *    heartbeat (it is skipped, recorded, and retried next interval);
 *  - a mutation NEVER overlaps a poll: it suspends new ticks, WAITS for any
 *    in-flight poll to settle (bounded drain), then runs under its own
 *    timeout, then exactly one authoritative refresh;
 *  - a mutation timeout is NOT a failure verdict: the mutation may complete
 *    later, so runMutation resolves { status: 'unknown' } and raises the
 *    orphan hold — ticks (reads) keep flowing so the UI can reconcile, but
 *    new mutations are refused with ReconcilingError until the orphan
 *    settles (never a blind retry while ambiguous). A cap timer backstops a
 *    never-settling orphan.
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

/** Thrown when a mutation is attempted while a previous one is unconfirmed. */
export class ReconcilingError extends Error {
  constructor() {
    super('Hay una acción anterior sin confirmar. Esperá a que se resuelva antes de reintentar.');
    this.name = 'ReconcilingError';
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

/** Returns true for Next.js redirect digests (must propagate, never swallow). */
export function isNextRedirect(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const digest = (error as { digest?: unknown }).digest;
  return typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT');
}

export interface PollControllerOptions {
  intervalMs: number;
  /** Leash for a single poll read. Default 15s. */
  pollTimeoutMs?: number;
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

/** Backstop: an orphan that never settles releases the mutation hold after this. */
export const ORPHAN_HOLD_CAP_MS = 90000;

export class PollController {
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight: boolean = false;
  private inFlightPromise: Promise<unknown> | null = null;
  private inFlightSlot: object | null = null;
  private suspended = 0;
  private pollCount = 0;
  private skippedCount = 0;
  private orphanHold = false;
  private orphanCapTimer: ReturnType<typeof setTimeout> | null = null;
  private lastPollErrorValue: unknown = null;
  /** Called (at most once per orphan) when a held orphan finally settles. */
  onOrphanSettled: (() => void) | null = null;

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

  /** True while a timed-out mutation is still unconfirmed (mutations refused). */
  get hasUnsettledMutation(): boolean {
    return this.orphanHold;
  }

  get lastPollError(): unknown {
    return this.lastPollErrorValue;
  }

  get stats(): { polls: number; skipped: number } {
    return { polls: this.pollCount, skipped: this.skippedCount };
  }

  get pollTimeoutMs(): number {
    return this.options.pollTimeoutMs ?? 15000;
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

  private async executePoll(): Promise<'polled' | 'skipped'> {
    this.inFlight = true;
    const slot: object = {};
    this.inFlightSlot = slot;
    const current = (async () => {
      try {
        await withTimeout(this.poll(), this.pollTimeoutMs, 'lectura');
      } catch (e) {
        // A hung poll must never wedge the heartbeat: record it and move on.
        // Redirect digests are rethrown by the poller itself (see consoles);
        // here we only guarantee the in-flight flag always clears.
        this.lastPollErrorValue = e;
      } finally {
        this.inFlight = false;
        if (this.inFlightSlot === slot) {
          this.inFlightSlot = null;
          this.inFlightPromise = null;
        }
      }
    })();
    this.inFlightPromise = current;
    await current;
    this.pollCount += 1;
    return 'polled';
  }

  /**
   * Runs an interactive mutation with full exclusion:
   *  1. refuse while a previous mutation is unconfirmed (ReconcilingError);
   *  2. suspend new ticks;
   *  3. wait for any currently in-flight poll to settle — with a SHORT
   *     timeout: a stuck poll must never wedge a mutation. On drain timeout
   *     the mutation does NOT run (no overlap, ever);
   *  4. run the mutation with a timeout, then exactly one authoritative
   *     refresh;
   *  5. on mutation timeout: raise the orphan hold (ticks keep flowing so the
   *     UI can reconcile; new mutations are refused) and resolve unknown.
   *     The hold clears when the orphan settles (refresh then) or at the cap.
   *
   * Genuine fn() rejections propagate (after a refresh).
   */
  async runMutation<T>(
    fn: () => Promise<T>,
    timeoutMs: number,
    label: string,
    opts?: { drainTimeoutMs?: number }
  ): Promise<MutationOutcome<T>> {
    if (this.orphanHold) throw new ReconcilingError();
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
        // Timeout: fn() is still alive (orphan). Release the tick suspension
        // (reads keep flowing for reconciliation) but raise the orphan hold
        // so no new mutation can start while ambiguous.
        this.resume();
        this.raiseOrphanHold();
        void task.then(
          () => this.clearOrphanHold(),
          () => this.clearOrphanHold()
        );
        return { status: 'unknown', label, elapsedMs: timeoutMs };
      }
    } catch (e) {
      // Defensive: never leak a suspension on unexpected paths.
      this.resume();
      throw e;
    }
  }

  private raiseOrphanHold(): void {
    this.orphanHold = true;
    if (this.orphanCapTimer !== null) clearTimeout(this.orphanCapTimer);
    this.orphanCapTimer = setTimeout(() => {
      this.orphanCapTimer = null;
      this.clearOrphanHold();
    }, ORPHAN_HOLD_CAP_MS);
    // Unref in Node so a held cap never keeps a test process alive.
    const t = this.orphanCapTimer as unknown as { unref?: () => void };
    if (typeof t.unref === 'function') t.unref();
  }

  private async clearOrphanHold(): Promise<void> {
    if (!this.orphanHold) return;
    this.orphanHold = false;
    if (this.orphanCapTimer !== null) {
      clearTimeout(this.orphanCapTimer);
      this.orphanCapTimer = null;
    }
    await this.tick();
    this.onOrphanSettled?.();
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
