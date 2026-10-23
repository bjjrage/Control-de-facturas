import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  profile: {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    empresa_id: "11111111-1111-4111-8111-111111111111",
    role: "admin" as "admin" | "comercial" | "administracion",
    active: true,
    empresa_active: true,
    is_super_admin: false,
    email: "approver@example.invalid",
  },
  approval: {
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    empresa_id: "11111111-1111-4111-8111-111111111111",
    task_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    run_id: null,
    tool_name: "admin_only_tool",
    payload_json: { amount: 1 },
    payload_hash: "a".repeat(64),
    risk_level: 2,
    status: "APPROVED",
    requested_by: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    decided_by: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    decided_at: "2026-10-22T00:00:00.000Z",
    expires_at: null,
    created_at: "2026-10-22T00:00:00.000Z",
    updated_at: "2026-10-22T00:00:00.000Z",
  },
  requiredRoles: ["admin"] as string[] | null,
  requireProfile: vi.fn(),
  getApproval: vi.fn(),
  getTool: vi.fn(),
  executeApprovedTool: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireProfile: (...args: unknown[]) => mocks.requireProfile(...args) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({})) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({})) }));
vi.mock("@/lib/agent/approvals", () => ({
  decideApproval: vi.fn(),
  getApproval: (...args: unknown[]) => mocks.getApproval(...args),
}));
vi.mock("@/lib/agent/gateway", () => ({ executeApprovedTool: (...args: unknown[]) => mocks.executeApprovedTool(...args) }));
vi.mock("@/lib/agent/registry", () => ({ getTool: (...args: unknown[]) => mocks.getTool(...args) }));
vi.mock("@/lib/agent/events", () => ({ emitAgentEvent: vi.fn(), processAgentEvent: vi.fn() }));
vi.mock("@/lib/agent/runtime", () => ({
  createRun: vi.fn(), createTask: vi.fn(), finishRun: vi.fn(), updateTaskStatus: vi.fn(),
}));
vi.mock("@/lib/email/domain-service", () => ({
  getEmailDraftSendContext: vi.fn(), getEmailDraftPreview: vi.fn(), getRecipientLabel: vi.fn(),
  markEmailDraftWaitingApproval: vi.fn(), recordEmailEvent: vi.fn(),
}));
vi.mock("@/lib/tools", () => ({}));

import { processApprovalDecidedEvent } from "../../../app/(internal)/agent/approval-actions";

describe("processApprovalDecidedEvent server authority", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(mocks.profile, {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      empresa_id: "11111111-1111-4111-8111-111111111111",
      role: "admin",
      active: true,
      empresa_active: true,
    });
    Object.assign(mocks.approval, {
      empresa_id: "11111111-1111-4111-8111-111111111111",
      tool_name: "admin_only_tool",
      status: "APPROVED",
      decided_by: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    mocks.requiredRoles = ["admin"];
    mocks.requireProfile.mockImplementation(async () => mocks.profile);
    mocks.getApproval.mockImplementation(async () => ({ ...mocks.approval }));
    mocks.getTool.mockImplementation(() => ({ requiredRoles: mocks.requiredRoles }));
    mocks.executeApprovedTool.mockResolvedValue({ output: { completed: true } });
  });

  it("uses the authenticated profile and persisted decision, ignoring caller-supplied identity fields", async () => {
    const result = await processApprovalDecidedEvent({
      approvalId: mocks.approval.id,
      decision: "APPROVED",
      decidedBy: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      empresaId: "99999999-9999-4999-8999-999999999999",
      role: "administracion",
    } as never);

    expect(result.success).toBe(true);
    expect(mocks.requireProfile).toHaveBeenCalledWith(["comercial", "administracion", "admin"]);
    expect(mocks.executeApprovedTool).toHaveBeenCalledWith(expect.objectContaining({
      actor: expect.objectContaining({
        empresaId: mocks.profile.empresa_id,
        userId: mocks.profile.id,
        role: "admin",
        actorType: "user",
        source: "web",
      }),
      approvalId: mocks.approval.id,
    }));
  });

  it("does not execute an unapproved or mismatched decision", async () => {
    Object.assign(mocks.approval, { status: "REQUESTED", decided_by: null });
    const result = await processApprovalDecidedEvent({ approvalId: mocks.approval.id, decision: "APPROVED" });
    expect(result.success).toBe(false);
    expect(mocks.executeApprovedTool).not.toHaveBeenCalled();
  });

  it("rechecks the current role against the tool policy before execution", async () => {
    mocks.profile.role = "comercial";
    Object.assign(mocks.approval, { decided_by: mocks.profile.id });
    const result = await processApprovalDecidedEvent({ approvalId: mocks.approval.id, decision: "APPROVED" });
    expect(result.success).toBe(false);
    expect(mocks.executeApprovedTool).not.toHaveBeenCalled();
  });

  it("fails closed when the current profile is inactive", async () => {
    mocks.requireProfile.mockRejectedValue(new Error("inactive profile"));
    await expect(processApprovalDecidedEvent({ approvalId: mocks.approval.id, decision: "APPROVED" }))
      .rejects.toThrow("inactive profile");
    expect(mocks.executeApprovedTool).not.toHaveBeenCalled();
  });
});
