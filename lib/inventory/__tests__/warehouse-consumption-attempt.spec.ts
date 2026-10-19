import { describe, expect, it } from "vitest";
import { clearRejectedConsumptionAttempt } from "@/lib/inventory/warehouse-portal-client-state";

describe("#13 portal consumption retry", () => {
  it("releases the saved attempt after a server rejection so changed data can be sent", () => {
    const key = "warehouse-consumption:token";
    const attempt = { key: "attempt-one", payload: '["product",1]' };
    const values = new Map([[key, JSON.stringify(attempt)]]);
    const storage = {
      getItem: (name: string) => values.get(name) ?? null,
      removeItem: (name: string) => { values.delete(name); },
    };
    expect(clearRejectedConsumptionAttempt(storage, key, attempt)).toBeNull();
    expect(storage.getItem(key)).toBeNull();
  });
  it("does not remove a newer attempt written by another tab", () => {
    const key = "warehouse-consumption:token";
    const old = { key: "old", payload: "old payload" };
    const newer = { key: "new", payload: "new payload" };
    const values = new Map([[key, JSON.stringify(newer)]]);
    const storage = {
      getItem: (name: string) => values.get(name) ?? null,
      removeItem: (name: string) => { values.delete(name); },
    };
    expect(clearRejectedConsumptionAttempt(storage, key, old)).toBeNull();
    expect(JSON.parse(storage.getItem(key)!)).toEqual(newer);
  });
});
