import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { assertNonProductionTestTarget } from "../test-utils/external-test-target";

const runRealRls = process.env.RUN_CLIMATE_RLS_TESTS === "1";
if (runRealRls) {
  assertNonProductionTestTarget({
    url: process.env.SUPABASE_TEST_URL,
    label: "Climate RLS test",
  });
}
const describeRls = runRealRls ? describe : describe.skip;

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Falta ${name} para ejecutar la verificación RLS real.`);
  return value;
}

describeRls("Climate workdays - multi-tenant RLS verification", () => {
  let clientA: SupabaseClient;
  let clientB: SupabaseClient;
  let projectA: string;
  let projectB: string;

  it("aísla eventos, jornadas y evidencias entre dos tenants y rechaza escrituras cruzadas", async () => {
    const url = requiredEnv("SUPABASE_TEST_URL");
    const anonKey = requiredEnv("SUPABASE_TEST_ANON_KEY");
    clientA = createClient(url, anonKey, { auth: { persistSession: false } });
    clientB = createClient(url, anonKey, { auth: { persistSession: false } });

    const authA = await clientA.auth.signInWithPassword({
      email: requiredEnv("SUPABASE_TEST_USER_A_EMAIL"),
      password: requiredEnv("SUPABASE_TEST_USER_A_PASSWORD"),
    });
    const authB = await clientB.auth.signInWithPassword({
      email: requiredEnv("SUPABASE_TEST_USER_B_EMAIL"),
      password: requiredEnv("SUPABASE_TEST_USER_B_PASSWORD"),
    });
    expect(authA.error).toBeNull();
    expect(authB.error).toBeNull();

    projectA = requiredEnv("CLIMATE_RLS_PROJECT_A");
    projectB = requiredEnv("CLIMATE_RLS_PROJECT_B");

    const [eventsB, workdaysB, evidenceB, eventsA, workdaysA, evidenceA] = await Promise.all([
      clientA.from("climate_events").select("id").eq("project_id", projectB),
      clientA.from("project_workday_status").select("id").eq("project_id", projectB),
      clientA.from("climate_evidence").select("id").eq("project_id", projectB),
      clientB.from("climate_events").select("id").eq("project_id", projectA),
      clientB.from("project_workday_status").select("id").eq("project_id", projectA),
      clientB.from("climate_evidence").select("id").eq("project_id", projectA),
    ]);
    expect(eventsB.error).toBeNull();
    expect(workdaysB.error).toBeNull();
    expect(evidenceB.error).toBeNull();
    expect(eventsA.error).toBeNull();
    expect(workdaysA.error).toBeNull();
    expect(evidenceA.error).toBeNull();
    expect(eventsB.data).toEqual([]);
    expect(workdaysB.data).toEqual([]);
    expect(evidenceB.data).toEqual([]);
    expect(eventsA.data).toEqual([]);
    expect(workdaysA.data).toEqual([]);
    expect(evidenceA.data).toEqual([]);

    const crossTenantInsert = await clientA.from("climate_events").insert({
      project_id: projectB,
      event_date: "2099-12-31",
      source: "DMH_OBSERVATION",
      external_precipitation_mm: 0,
      contract_threshold_mm: 15,
      external_threshold_exceeded: false,
      threshold_exceeded: false,
    }).select("id");
    expect(crossTenantInsert.error !== null || (crossTenantInsert.data ?? []).length === 0).toBe(true);

    const crossTenantEvidence = await clientA.from("climate_evidence").insert({
      project_id: projectB,
      evidence_type: "RESIDENT_NOTE",
      metadata: { attempted_by: "tenant-a" },
    }).select("id");
    expect(crossTenantEvidence.error !== null || (crossTenantEvidence.data ?? []).length === 0).toBe(true);

    const crossTenantWorkdayUpdate = await clientA
      .from("project_workday_status")
      .update({ notes: "cross-tenant attempt" })
      .eq("project_id", projectB)
      .select("id");
    expect(crossTenantWorkdayUpdate.error !== null || (crossTenantWorkdayUpdate.data ?? []).length === 0).toBe(true);

    const crossTenantProjectConfig = await clientA
      .from("projects")
      .update({ precipitation_threshold_mm: 999 })
      .eq("id", projectB)
      .select("id");
    expect(crossTenantProjectConfig.error !== null || (crossTenantProjectConfig.data ?? []).length === 0).toBe(true);

    const crossTenantStoragePath = `${projectB}/climate/2099-12-31/rls-test.txt`;
    const crossTenantStorage = await clientA.storage
      .from("execution-photos")
      .upload(crossTenantStoragePath, new Blob(["cross-tenant attempt"], { type: "text/plain" }), { upsert: false });
    expect(crossTenantStorage.error).not.toBeNull();
    if (!crossTenantStorage.error) {
      await clientA.storage.from("execution-photos").remove([crossTenantStoragePath]);
    }

    const evidenceDelete = await clientA
      .from("climate_evidence")
      .delete()
      .eq("id", "00000000-0000-0000-0000-000000000000");
    expect(evidenceDelete.data ?? []).toEqual([]);
  }, 30000);
});
