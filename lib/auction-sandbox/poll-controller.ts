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
 *  - mutations suspend polling, run with a timeout, then trigger exactly ONE
 *    authoritative refresh before polling resumes;
 *  - a timed-out mutation always settles (visible error) instead of hanging.
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

export class PollController {
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight = false;
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
    try {
      await this.poll();
      this.pollCount += 1;
      return 'polled';
    } finally {
      this.inFlight = false;
    }
  }

  /**
   * Runs an interactive mutation with polling suspended and a timeout.
   * Always resumes and performs exactly ONE authoritative refresh after,
   * whether the mutation succeeded, failed or timed out.
   */
  async runMutation<T>(fn: () => Promise<T>, timeoutMs: number, label: string): Promise<T> {
    this.suspend();
    try {
      return await withTimeout(fn(), timeoutMs, label);
    } finally {
      this.resume();
      await this.tick();
    }
  }
}
