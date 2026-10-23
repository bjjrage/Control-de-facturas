/** Per-shell in-flight reads. Never shared across users or persisted. */
export class SectionRequests<Key extends string, Value> {
  private pending = new Map<Key, Promise<Value | undefined>>();
  private generation = 0;
  private activeReads = 0;

  constructor(private readonly load: (key: Key) => Promise<Value>) {}

  get busy() { return this.activeReads > 0; }

  read(key: Key): Promise<Value | undefined> {
    const existing = this.pending.get(key);
    if (existing) return existing;

    const generation = this.generation;
    this.activeReads += 1;
    const promise = Promise.resolve().then(() => generation === this.generation ? this.load(key) : undefined).then(
      (value) => generation === this.generation ? value : undefined,
      (error: unknown) => {
        if (generation !== this.generation) return undefined;
        throw error;
      },
    ).finally(() => {
      this.activeReads -= 1;
      if (this.pending.get(key) === promise) this.pending.delete(key);
    });
    this.pending.set(key, promise);
    return promise;
  }

  // A server refresh/mutation must not reuse a read started before that change.
  invalidate() {
    this.generation += 1;
    this.pending.clear();
  }
}
