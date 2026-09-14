import { describe, it, expect, beforeAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";

describe("Weekly Plan - Multi-tenant RLS & Security Invoker RPC Verification", () => {
  const supabaseUrl = "https://ezucivipgmbvamhugkbj.supabase.co";
  const anonKey =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV6dWNpdmlwZ21idmFtaHVna2JqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg2MTMyNTcsImV4cCI6MjEwNDE4OTI1N30.E-WBbmwrRgVHcU_2x6bVMRutjnaXocHVdEwZsQ57Id0";

  // Empresa Iasa: magymerlo@gmail.com (c040ee03-2302-49d2-8082-b2a4ae5b62af)
  // Empresa niu.pack: marceloechauri@gmail.com (bc551d96-dac1-4ffc-9fa8-c34cea6b5ffd)
  let clientUserA: any; // Iasa
  let clientUserB: any; // niu.pack
  let clientAnon: any;

  let projectIasaId: string;
  let projectNiuPackId: string;
  let budgetItemIasaId: string;

  beforeAll(async () => {
    clientAnon = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });

    // Login User A (Iasa)
    clientUserA = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    const authA = await clientUserA.auth.signInWithPassword({
      email: "magymerlo@gmail.com",
      password: "123456",
    });
    expect(authA.error).toBeNull();
    expect(authA.data.session).not.toBeNull();

    // Login User B (niu.pack)
    clientUserB = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    const authB = await clientUserB.auth.signInWithPassword({
      email: "marceloechauri@gmail.com",
      password: "123456",
    });
    expect(authB.error).toBeNull();
    expect(authB.data.session).not.toBeNull();

    // Fetch Project A (OBR-MOCK-001 in Iasa)
    const { data: pA } = await clientUserA
      .from("projects")
      .select("id, code")
      .eq("code", "OBR-MOCK-001")
      .single();
    expect(pA).not.toBeNull();
    projectIasaId = pA.id;

    // Fetch a budget item for Project A (02.01 Mampostería with contractual quantity = 500)
    const { data: bA } = await clientUserA
      .from("budget_items")
      .select("id, code, quantity")
      .eq("project_id", projectIasaId)
      .eq("code", "02.01")
      .single();
    expect(bA).not.toBeNull();
    expect(Number(bA.quantity)).toBe(500);
    budgetItemIasaId = bA.id;

    // Fetch Project B (OBR-001 in niu.pack)
    const { data: pB } = await clientUserB
      .from("projects")
      .select("id, code")
      .eq("code", "OBR-001")
      .single();
    expect(pB).not.toBeNull();
    projectNiuPackId = pB.id;
  }, 30000);

  it("1. User A creates and reads weekly plan in Empresa A (OK)", async () => {
    const { data: rpcRes, error: rpcErr } = await clientUserA.rpc("save_weekly_plan_atomic", {
      p_plan_id: null,
      p_project_id: projectIasaId,
      p_start_date: "2026-09-14",
      p_end_date: "2026-09-20",
      p_status: "DRAFT",
      p_notes: "Plan creado por Tenant A",
      p_items: [
        {
          budget_item_id: budgetItemIasaId,
          front_label: "Frente A",
          input_mode: "CONTRACT_PERCENTAGE_POINTS",
          input_value: 10,
          unit: "m2",
        },
      ],
      p_weather_snapshot_batch_id: null,
    });

    expect(rpcErr).toBeNull();
    expect(rpcRes.status).toBe("SUCCESS");
    const planId = rpcRes.plan_id;

    // Read plan with clientUserA
    const { data: planData, error: readErr } = await clientUserA
      .from("project_weekly_plans")
      .select("*, project_weekly_plan_items(*)")
      .eq("id", planId)
      .single();

    expect(readErr).toBeNull();
    expect(planData.id).toBe(planId);
    expect(planData.project_weekly_plan_items.length).toBe(1);
    // Verified: target_quantity is 50, not 10!
    expect(Number(planData.project_weekly_plan_items[0].target_quantity)).toBe(50);
  });

  it("2. User A attempts to read plans from Empresa B (0 rows returned)", async () => {
    const { data: plansB, error: readErr } = await clientUserA
      .from("project_weekly_plans")
      .select("*")
      .eq("project_id", projectNiuPackId);

    expect(readErr).toBeNull();
    // RLS filters out rows from other tenants
    expect(plansB.length).toBe(0);
  });

  it("3. User A attempts to invoke save_weekly_plan_atomic for Project B in Empresa B (DENIED)", async () => {
    const { data: rpcRes, error: rpcErr } = await clientUserA.rpc("save_weekly_plan_atomic", {
      p_plan_id: null,
      p_project_id: projectNiuPackId, // Cross-tenant project!
      p_start_date: "2026-09-14",
      p_end_date: "2026-09-20",
      p_status: "DRAFT",
      p_notes: "Intrusión cross-tenant",
      p_items: [],
      p_weather_snapshot_batch_id: null,
    });

    expect(rpcErr).not.toBeNull();
    expect(rpcErr.message).toContain("no pertenece a la empresa");
  });

  it("4. User B attempts to read plans from Empresa A (0 rows returned)", async () => {
    const { data: plansA, error: readErr } = await clientUserB
      .from("project_weekly_plans")
      .select("*")
      .eq("project_id", projectIasaId);

    expect(readErr).toBeNull();
    expect(plansA.length).toBe(0);
  });

  it("5. User B attempts to invoke save_weekly_plan_atomic for Project A in Empresa A (DENIED)", async () => {
    const { data: rpcRes, error: rpcErr } = await clientUserB.rpc("save_weekly_plan_atomic", {
      p_plan_id: null,
      p_project_id: projectIasaId, // Cross-tenant project!
      p_start_date: "2026-09-14",
      p_end_date: "2026-09-20",
      p_status: "DRAFT",
      p_notes: "Intrusión cross-tenant de B",
      p_items: [],
      p_weather_snapshot_batch_id: null,
    });

    expect(rpcErr).not.toBeNull();
    expect(rpcErr.message).toContain("no pertenece a la empresa");
  });

  it("6. Anonymous unauthenticated caller invokes save_weekly_plan_atomic (DENIED / PERMISSION DENIED)", async () => {
    const { data: rpcRes, error: rpcErr } = await clientAnon.rpc("save_weekly_plan_atomic", {
      p_plan_id: null,
      p_project_id: projectIasaId,
      p_start_date: "2026-09-14",
      p_end_date: "2026-09-20",
      p_status: "DRAFT",
      p_notes: "Anon call",
      p_items: [],
      p_weather_snapshot_batch_id: null,
    });

    expect(rpcErr).not.toBeNull();
    // PostgREST/Postgres denies execution to anon because EXECUTE privilege was revoked from anon and PUBLIC
    expect(
      rpcErr.message.includes("permission denied") ||
      rpcErr.message.includes("function") ||
      rpcErr.message.includes("Acceso denegado")
    ).toBe(true);
  });

  it("7. Tenant Isolation on Weather Batches & Snapshots: User A cannot read User B batches/snapshots", async () => {
    // User A reads batches from Project B (niu.pack)
    const { data: batchesB, error: bErr } = await clientUserA
      .from("project_weather_forecast_batches")
      .select("*")
      .eq("project_id", projectNiuPackId);

    expect(bErr).toBeNull();
    expect(batchesB.length).toBe(0);

    // User A reads snapshots from Project B (niu.pack)
    const { data: snapsB, error: sErr } = await clientUserA
      .from("project_weather_forecast_snapshots")
      .select("*")
      .eq("project_id", projectNiuPackId);

    expect(sErr).toBeNull();
    expect(snapsB.length).toBe(0);
  });
});
