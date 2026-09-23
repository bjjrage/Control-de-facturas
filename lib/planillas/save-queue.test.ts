import { describe, expect, it, vi } from "vitest";
import { PlanillaSaveQueue } from "./save-queue";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("PlanillaSaveQueue", () => {
  it("espera un PATCH en vuelo y guarda después el snapshot más reciente antes de quedar idle", async () => {
    const queue = new PlanillaSaveQueue<string[]>();
    const firstPatch = deferred<void>();
    const save = vi.fn(async (rows: string[]) => {
      if (rows[0] === "first") await firstPatch.promise;
    });

    queue.enqueue(["first"]);
    const firstFlush = queue.flush(save);
    await Promise.resolve();
    expect(save).toHaveBeenCalledTimes(1);

    queue.enqueue(["latest"]);
    const confirmFlush = queue.flush(save);
    expect(confirmFlush).toBe(firstFlush);
    expect(queue.isIdle).toBe(false);

    firstPatch.resolve();
    await expect(confirmFlush).resolves.toBe(true);
    expect(save.mock.calls.map(([rows]) => rows)).toEqual([["first"], ["latest"]]);
    expect(queue.isIdle).toBe(true);
  });

  it("no confirma al fallar el guardado y conserva la edición más nueva para reintentar", async () => {
    const queue = new PlanillaSaveQueue<string[]>();
    const failedSave = vi.fn(async () => {
      queue.enqueue(["latest"]);
      throw new Error("PATCH failed");
    });

    queue.enqueue(["old"]);
    await expect(queue.flush(failedSave)).resolves.toBe(false);
    expect(queue.latestUnsentSnapshot).toEqual(["latest"]);
    expect(queue.hasPending).toBe(true);

    const retry = vi.fn(async () => {});
    await expect(queue.flush(retry)).resolves.toBe(true);
    expect(retry).toHaveBeenCalledWith(["latest"]);
    expect(queue.isIdle).toBe(true);
  });

  it("restaura el snapshot fallido si no llegaron ediciones posteriores", async () => {
    const queue = new PlanillaSaveQueue<string[]>();
    queue.enqueue(["retry-me"]);

    await expect(queue.flush(async () => { throw new Error("network"); })).resolves.toBe(false);
    expect(queue.latestUnsentSnapshot).toEqual(["retry-me"]);
  });
});
