import { describe, expect, it } from "vitest";
import { createWorkbookPreviewToken, verifyWorkbookPreviewToken } from "../preview-token";

describe("workbook preview token", () => {
  const now = 1_800_000_000_000;
  const fileBytes = new TextEncoder().encode("workbook contents");
  const result = { project: { name: { status: "FOUND", value: "Original", confidence: 0.9 } } };
  const secret = "test-only-signing-secret";

  it("binds the preview to the exact file, result, user and tenant until expiry", () => {
    const token = createWorkbookPreviewToken({ fileBytes, result, userId: "user-1", empresaId: "company-1", now, secret });
    const verify = (overrides: Partial<Parameters<typeof verifyWorkbookPreviewToken>[0]> = {}) => verifyWorkbookPreviewToken({
      token,
      fileBytes,
      result,
      userId: "user-1",
      empresaId: "company-1",
      now: now + 1,
      secret,
      ...overrides,
    });

    expect(verify()).toBe(true);
    expect(verify({ result: { ...result, project: { name: { ...result.project.name, value: "Tampered" } } } })).toBe(false);
    expect(verify({ fileBytes: new TextEncoder().encode("different workbook") })).toBe(false);
    expect(verify({ userId: "user-2" })).toBe(false);
    expect(verify({ empresaId: "company-2" })).toBe(false);
    expect(verify({ now: now + 15 * 60 * 1000 })).toBe(false);
  });
});
