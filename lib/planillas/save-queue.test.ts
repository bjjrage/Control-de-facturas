import { describe, it, expect } from "vitest";
import { DraftSaveQueue } from "./save-queue";
describe("draft save queue", () => {
  it("preserves newer edits when an older save fails", async () => {
    let reject!: (e: Error) => void;
    const queue = new DraftSaveQueue<number>("v1", () => new Promise((_, r) => { reject = r; }));
    queue.enqueue([1]); const save = queue.flush(); queue.enqueue([2]);
    reject(new Error("offline")); await expect(save).rejects.toThrow("offline");
    expect(queue.pending).toEqual([2]); expect(queue.version).toBe("v1");
  });
  it("waits for every edit before confirming and uses acknowledged revisions", async () => {
    let finish!: (v: string) => void; const versions: string[] = [];
    const queue = new DraftSaveQueue<number>("v1", async (rows, version) => {
      versions.push(version); return rows[0] === 1 ? new Promise(r => { finish = r; }) : "v3";
    });
    queue.enqueue([1]); const first = queue.flush(); queue.enqueue([2]); const confirm = queue.flush();
    finish("v2"); await Promise.all([first, confirm]);
    expect(versions).toEqual(["v1", "v2"]); expect(queue.version).toBe("v3"); expect(queue.dirty).toBe(false);
  });
});
