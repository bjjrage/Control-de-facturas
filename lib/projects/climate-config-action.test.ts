import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ patch: null as Record<string, unknown> | null, location: { latitude: -25.28, longitude: -57.64 } as { latitude: number | null; longitude: number | null }, exists: true, eq: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requirePlan: vi.fn(async () => ({ id: "admin", empresa_id: "tenant" })) }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(async () => {}) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: () => {
  const chain = { select: () => chain, eq: (...args: unknown[]) => { state.eq(...args); return chain; }, single: async () => ({ data: state.exists ? { id: "project" } : null }), maybeSingle: async () => ({ data: state.location }), update: (patch: Record<string, unknown>) => { state.patch = patch; return chain; }, then: (resolve: (value: { error: null }) => void) => resolve({ error: null }) };
  return chain;
} }) }));
import { updateProjectClimateConfig, evaluateProjectWeatherDayAction } from "@/app/(internal)/projects/climate-actions";
const config = { precipitationThresholdMm: 15, weatherTrackingEnabled: true, weatherSource: "dmh-dinac" };
beforeEach(() => { state.patch = null; state.exists = true; state.location = { latitude: -25.28, longitude: -57.64 }; state.eq.mockClear(); });
it("saves valid coordinates and activation together within the tenant", async () => {
  expect(await updateProjectClimateConfig("project", { ...config, latitude: -25.28, longitude: -57.64 })).toEqual({ error: null });
  expect(state.patch).toMatchObject({ latitude: -25.28, longitude: -57.64, weather_tracking_enabled: true });
  expect(state.eq).toHaveBeenCalledWith("empresa_id", "tenant");
});
it("rejects activation without a stored location", async () => {
  state.location = { latitude: null, longitude: null };
  expect((await updateProjectClimateConfig("project", config)).error).toMatch(/ubicación/);
  expect(state.patch).toBeNull();
});
it("rejects incomplete or out-of-range coordinate patches", async () => {
  for (const patch of [{ latitude: -25 }, { latitude: 91, longitude: -57 }, { latitude: null, longitude: null }]) {
    expect((await updateProjectClimateConfig("project", { ...config, ...patch })).error).toMatch(/latitud/);
    expect(state.patch).toBeNull();
  }
});
it("preserves stored coordinates for existing callers without a location patch", async () => {
  expect((await updateProjectClimateConfig("project", config)).error).toBeNull();
  expect(state.patch).not.toHaveProperty("latitude");
});
it("rejects a project outside the authorized tenant before any update", async () => {
  state.exists = false;
  expect((await updateProjectClimateConfig("project", config)).error).toMatch(/no encontrado/);
  expect(state.patch).toBeNull();
});
it("rejects future or impossible observation dates before calling a weather provider", async () => {
  const fetch = vi.spyOn(globalThis, "fetch");
  try {
    for (const date of ["2100-01-01", "2026-02-31"]) {
      expect((await evaluateProjectWeatherDayAction("project", date)).error).toMatch(/fecha válida/);
    }
    expect(fetch).not.toHaveBeenCalled();
    expect(state.patch).toBeNull();
  } finally { fetch.mockRestore(); }
});
