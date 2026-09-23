import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRequireProfile, mockCreateVoiceSession, mockIsVoiceAvailable } = vi.hoisted(() => ({
  mockRequireProfile: vi.fn(),
  mockCreateVoiceSession: vi.fn(),
  mockIsVoiceAvailable: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireProfile: mockRequireProfile }));
vi.mock("@/lib/voice/service", () => ({ createVoiceSession: mockCreateVoiceSession }));
vi.mock("@/lib/voice/providers", () => ({ isVoiceAvailable: mockIsVoiceAvailable }));
vi.mock("@/lib/agent/context", () => ({
  actorFromProfile: (profile: unknown) => profile,
  withWorkspace: (actor: unknown) => actor,
}));

import { POST } from "@/app/api/agent/voice/session/route";

describe("POST /api/agent/voice/session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsVoiceAvailable.mockReturnValue(true);
    mockRequireProfile.mockResolvedValue({ id: "user-1", empresa_id: "tenant-1" });
  });

  it("redacts provider errors from the response and logs", async () => {
    mockCreateVoiceSession.mockRejectedValue(
      new Error("Bearer abc.def secret=xyz owner@example.com https://provider.test/private")
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const response = await POST(new Request("http://localhost/api/agent/voice/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }) as never);
      const responseText = await response.text();
      const logText = JSON.stringify(consoleError.mock.calls);

      expect(response.status).toBe(500);
      expect(responseText).toContain("No se pudo crear la sesión de voz");
      for (const secret of ["abc.def", "xyz", "owner@example.com", "provider.test/private"]) {
        expect(responseText).not.toContain(secret);
        expect(logText).not.toContain(secret);
      }
    } finally {
      consoleError.mockRestore();
    }
  });
});
