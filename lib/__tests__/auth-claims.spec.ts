import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ claims: vi.fn(), profile: vi.fn() }));
vi.mock("react", () => ({ cache: (fn: unknown) => fn }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw Error(path); }, notFound: () => { throw Error("404"); } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getClaims: mocks.claims },
  from: () => ({ select: () => ({ eq: () => ({ single: mocks.profile }) }) }),
}) }));
import { requireProfile, requireSuperAdmin } from "@/lib/auth";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.claims.mockResolvedValue({ data: { claims: { sub: "user", user_metadata: { role: "admin", is_super_admin: true } } }, error: null });
  mocks.profile.mockResolvedValue({ data: { id: "user", active: true, role: "comercial", is_super_admin: false, empresas: { active: true, plan: "basico" } } });
});
describe("verified claims with fresh database authority", () => {
  it.each([{ data: null, error: { message: "invalid signature" } }, { data: { claims: {} }, error: null }])("denies invalid/missing claims before a profile read", async (result) => {
    mocks.claims.mockResolvedValue(result);
    await expect(requireProfile()).rejects.toThrow("/login");
    expect(mocks.profile).not.toHaveBeenCalled();
  });
  it("ignores elevated user metadata", async () => {
    expect((await requireProfile()).role).toBe("comercial");
    await expect(requireSuperAdmin()).rejects.toThrow("/dashboard");
    expect(mocks.claims).toHaveBeenCalledWith();
  });
  it.each([{ active: false, empresas: { active: true } }, { active: true, empresas: { active: false } }])("denies a freshly suspended profile/company", async (profile) => {
    mocks.profile.mockResolvedValue({ data: { ...profile, is_super_admin: false } });
    await expect(requireProfile()).rejects.toThrow("/suspendido");
  });
  it("denies an existing JWT after profile deletion", async () => {
    mocks.profile.mockResolvedValue({ data: null });
    await expect(requireProfile()).rejects.toThrow("/login");
  });
});
