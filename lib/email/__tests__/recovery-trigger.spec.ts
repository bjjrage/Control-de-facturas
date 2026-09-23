import { afterEach, describe, expect, it, vi } from "vitest";

const { mockRpc } = vi.hoisted(() => ({ mockRpc: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: mockRpc }),
}));

import { EMAIL_SEND_CLAIM_STALE_AFTER_MS, recoverStaleEmailSendAttempts } from "../recovery";

describe("stale email recovery trigger", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("invokes the database-owned recovery with an explicit ten-minute cutoff", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-23T06:00:00.000Z"));
    mockRpc.mockResolvedValue({ data: 2, error: null });

    await expect(recoverStaleEmailSendAttempts()).resolves.toBe(2);

    expect(EMAIL_SEND_CLAIM_STALE_AFTER_MS).toBe(10 * 60 * 1_000);
    expect(mockRpc).toHaveBeenCalledWith("recover_stale_email_send_attempts", {
      p_cutoff: "2026-09-23T05:50:00.000Z",
    });
  });

  it("fails closed when recovery errors or returns an ambiguous result", async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "db unavailable" } });
    await expect(recoverStaleEmailSendAttempts()).rejects.toThrow("No se pudo verificar la recuperación segura");

    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(recoverStaleEmailSendAttempts()).rejects.toThrow("No se pudo verificar la recuperación segura");
  });
});
