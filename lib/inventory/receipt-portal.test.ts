import { describe, expect, it } from "vitest";
import {
  generateReceiptPortalToken,
  hashReceiptPortalToken,
  isReceiptPortalToken,
  isReceiptPortalDate,
  receiptPortalUrl,
  validateReceiptPortalLines,
} from "./receipt-portal";

describe("receipt portal", () => {
  it("generates a strong token and exposes only a stable hash for persistence", () => {
    const first = generateReceiptPortalToken();
    const second = generateReceiptPortalToken();
    expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(isReceiptPortalToken(first.token)).toBe(true);
    expect(isReceiptPortalToken("nope")).toBe(false);
    expect(first.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.tokenHash).not.toBe(first.token);
    expect(hashReceiptPortalToken(first.token)).toBe(first.tokenHash);
    expect(second.tokenHash).not.toBe(first.tokenHash);
    expect(first.tokenHint).toBe(first.token.slice(-6));
  });

  it("builds an encoded absolute-capable public link", () => {
    expect(receiptPortalUrl("abc_def", "https://erp.example/")).toBe("https://erp.example/recepcion/abc_def");
  });

  it("accepts real calendar dates and rejects normalized invalid dates", () => {
    expect(isReceiptPortalDate("2026-09-22")).toBe(true);
    expect(isReceiptPortalDate("2026-02-30")).toBe(false);
    expect(isReceiptPortalDate("22-09-2026")).toBe(false);
  });

  it("accepts only unique positive lines within the current pending quantity", () => {
    const pending = new Map([["11111111-1111-4111-8111-111111111111", 4]]);
    expect(validateReceiptPortalLines([
      { order_item_id: "11111111-1111-4111-8111-111111111111", quantity: 2.5, notes: " recibido " },
    ], pending)).toEqual([
      { order_item_id: "11111111-1111-4111-8111-111111111111", quantity: 2.5, notes: "recibido" },
    ]);
    expect(validateReceiptPortalLines([
      { order_item_id: "11111111-1111-4111-8111-111111111111", quantity: 2 },
      { order_item_id: "11111111-1111-4111-8111-111111111111", quantity: 1 },
    ], pending)).toBeNull();
    expect(validateReceiptPortalLines([
      { order_item_id: "11111111-1111-4111-8111-111111111111", quantity: 4.01 },
    ], pending)).toBeNull();
    expect(validateReceiptPortalLines([
      { order_item_id: "22222222-2222-4222-8222-222222222222", quantity: 1 },
    ], pending)).toBeNull();
    expect(validateReceiptPortalLines([
      { order_item_id: "11111111-1111-4111-8111-111111111111", quantity: Number.NaN },
    ], pending)).toBeNull();
  });
});
