import { describe, expect, it, vi } from "vitest";
import { SectionRequests } from "./section-requests";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("per-shell section reads", () => {
  it("shares an in-flight prefetch with clicks and route synchronization", async () => {
    const response = deferred<string>();
    const load = vi.fn(() => response.promise);
    const requests = new SectionRequests(load);
    const hover = requests.read("/projects");
    expect(requests.read("/projects")).toBe(hover);
    expect(requests.read("/projects")).toBe(hover);
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(1);
    expect(requests.busy).toBe(true);
    response.resolve("Obras");
    await expect(hover).resolves.toBe("Obras");
    expect(requests.busy).toBe(false);
  });

  it("revalidates on a later visit instead of keeping a permanent result cache", async () => {
    const load = vi.fn().mockResolvedValueOnce("before").mockResolvedValueOnce("after");
    const requests = new SectionRequests(load);
    expect(await requests.read("/invoices")).toBe("before");
    expect(await requests.read("/invoices")).toBe("after");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("retries after a failed read", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce("ok");
    const requests = new SectionRequests(load);
    await expect(requests.read("/projects")).rejects.toThrow("offline");
    expect(requests.busy).toBe(false);
    await expect(requests.read("/projects")).resolves.toBe("ok");
  });

  it("discards a read started before a mutation, without removing the fresh request", async () => {
    const old = deferred<string>();
    const fresh = deferred<string>();
    const load = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    const requests = new SectionRequests(load);
    const beforeSave = requests.read("/invoices");
    await Promise.resolve();
    requests.invalidate();
    const afterSave = requests.read("/invoices");
    await Promise.resolve();
    old.resolve("deleted invoice still present");
    await expect(beforeSave).resolves.toBeUndefined();
    expect(requests.read("/invoices")).toBe(afterSave);
    expect(requests.busy).toBe(true);
    fresh.resolve("deleted invoice gone");
    await expect(afterSave).resolves.toBe("deleted invoice gone");
    expect(load).toHaveBeenCalledTimes(2);
    expect(requests.busy).toBe(false);
  });

  it("ignores errors from superseded reads and retains foreground busy status", async () => {
    const old = deferred<string>();
    const fresh = deferred<string>();
    const load = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    const requests = new SectionRequests(load);
    const discarded = requests.read("/projects");
    await Promise.resolve();
    requests.invalidate();
    const current = requests.read("/stock");
    await Promise.resolve();
    old.reject(new Error("old request failed"));
    await expect(discarded).resolves.toBeUndefined();
    expect(requests.busy).toBe(true);
    fresh.resolve("stock");
    await current;
    expect(requests.busy).toBe(false);
  });

  it("does not share data or requests between shell instances", async () => {
    const first = new SectionRequests(async () => "company A");
    const second = new SectionRequests(async () => "company B");
    expect(await first.read("/projects")).toBe("company A");
    expect(await second.read("/projects")).toBe("company B");
  });

  it("does not dispatch a read invalidated before it starts", async () => {
    const load = vi.fn(async () => "unused");
    const requests = new SectionRequests(load);
    const cancelled = requests.read("/projects");
    requests.invalidate();
    await expect(cancelled).resolves.toBeUndefined();
    expect(load).not.toHaveBeenCalled();
    expect(requests.busy).toBe(false);
  });
});
