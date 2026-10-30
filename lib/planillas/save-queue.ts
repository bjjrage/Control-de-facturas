/** Serializes acknowledged revisions. A failed older request never replaces
 * edits queued while it was running. Conflicts require explicit resolution. */
export class DraftSaveQueue<Row> {
  pending: Row[] | null = null;
  private flight: Promise<void> | null = null;
  constructor(public version: string, private save: (rows: Row[], version: string) => Promise<string>) {}
  get dirty() { return this.pending !== null || this.flight !== null; }
  enqueue(rows: Row[]) { this.pending = structuredClone(rows); }
  async flush(): Promise<void> {
    if (this.flight) { await this.flight; return this.flush(); }
    if (!this.pending) return;
    const rows = this.pending;
    this.pending = null;
    this.flight = (async () => {
      try { this.version = await this.save(rows, this.version); }
      catch (error) { this.pending ??= rows; throw error; }
      finally { this.flight = null; }
    })();
    await this.flight;
    await this.flush();
  }
}
