/** Serializes planilla autosaves while always draining the newest snapshot. */
export class PlanillaSaveQueue<Snapshot> {
  private pendingSnapshot: Snapshot | null = null;
  private inFlightSnapshot: Snapshot | null = null;
  private drainPromise: Promise<boolean> | null = null;

  enqueue(snapshot: Snapshot): void {
    this.pendingSnapshot = snapshot;
  }

  get hasPending(): boolean {
    return this.pendingSnapshot !== null;
  }

  get isIdle(): boolean {
    return this.pendingSnapshot === null && this.inFlightSnapshot === null && this.drainPromise === null;
  }

  get latestUnsentSnapshot(): Snapshot | null {
    return this.pendingSnapshot ?? this.inFlightSnapshot;
  }

  flush(save: (snapshot: Snapshot) => Promise<void>): Promise<boolean> {
    if (this.drainPromise) return this.drainPromise;

    const drainPromise = this.drain(save).finally(() => {
      if (this.drainPromise === drainPromise) this.drainPromise = null;
    });
    this.drainPromise = drainPromise;
    return drainPromise;
  }

  private async drain(save: (snapshot: Snapshot) => Promise<void>): Promise<boolean> {
    while (this.pendingSnapshot !== null) {
      const snapshot = this.pendingSnapshot;
      this.pendingSnapshot = null;
      this.inFlightSnapshot = snapshot;

      try {
        await save(snapshot);
      } catch {
        // Prefer any newer edits that arrived while this request was in flight.
        if (this.pendingSnapshot === null) this.pendingSnapshot = snapshot;
        this.inFlightSnapshot = null;
        return false;
      }

      this.inFlightSnapshot = null;
    }

    return true;
  }
}
