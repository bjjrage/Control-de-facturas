import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  emptyContractClimateParameters,
  evaluateContractClimate,
  type ContractClimateParameters,
  type ContractClimatePolicy,
} from "@/lib/projects/contract-climate";
import type { ClimateEvent, ProjectWorkdayStatus } from "@/lib/types";

const date = "2026-07-01";
const parameters = (): ContractClimateParameters => ({
  ...emptyContractClimateParameters(),
  label: "PBC test", documentRef: "PBC-1", clauseRef: "Cláusula 1",
  effectiveFrom: date, startDate: date, baseDays: 30,
  dayBasis: "CALENDAR" as const, includeStart: true,
  thresholdMm: 15, thresholdOperator: "GTE" as const, rainSource: "EITHER" as const,
  eligibleCodes: ["LL"], requireEvidence: false, requireCausality: false,
  requireImpediment: false, requireConformity: false, toleranceDays: 0,
  toleranceScope: "CONTRACT" as const, partialMonth: "FULL" as const,
  capMode: "NONE" as const, rounding: "FLOOR" as const,
  formula: "EXCESS_ELIGIBLE_DAYS_V1" as const,
});

const policy: ContractClimatePolicy = {
  id: "policy-1", project_id: "project-1", empresa_id: "tenant-1", version: 1,
  status: "VALIDATED", parameters: parameters(), created_at: `${date}T00:00:00Z`,
  created_by: "admin-1", validated_by: "admin-1",
};

const workday = (): ProjectWorkdayStatus => ({
  id: "day-1", empresa_id: "tenant-1", project_id: "project-1", work_date: date,
  classification: "NON_WORKABLE_RAIN", climate_event_id: "event-1", parent_workday_status_id: null,
  reason_code: null, notes: null, source: "MANUAL", decision_status: "CONFIRMED",
  proposed_automatically: false, confirmed_by: "admin-1", confirmed_at: `${date}T12:00:00Z`,
  created_at: `${date}T12:00:00Z`, updated_at: `${date}T12:00:00Z`,
});

const event = (external: number | null, local: number | null): ClimateEvent => ({
  id: "event-1", empresa_id: "tenant-1", project_id: "project-1", event_date: date,
  source: "DMH_DINAC", external_station_id: "station-1", external_station_name: "Station",
  external_station_latitude: null, external_station_longitude: null, external_station_distance_km: null,
  external_observed_at: null, external_precipitation_mm: external, local_precipitation_mm: local,
  contract_threshold_mm: 15, external_threshold_exceeded: false, local_threshold_exceeded: false,
  threshold_exceeded: false, local_source: "LOCAL_RAIN_GAUGE", provider_fallback_reason: null,
  raw_source_payload: null, status: "CONFIRMED", created_at: `${date}T12:00:00Z`, updated_at: `${date}T12:00:00Z`,
});

function evaluate(rain: ClimateEvent) {
  return evaluateContractClimate({
    policies: [policy], workdays: [workday()], events: [rain], evidence: [], assessments: [], adjustments: [],
    periodStart: date, periodEnd: date, asOf: date,
  });
}

describe("contract climate engine", () => {
  it("keeps an EITHER-source day pending when a measured source is below threshold and the other is missing", () => {
    const result = evaluate(event(5, null));
    expect(result.dates[0]).toMatchObject({ state: "PENDING", computableDays: 0 });
    expect(result.status).toBe("PROVISIONAL");
  });

  it("accepts a threshold crossing from either configured source", () => {
    expect(evaluate(event(15, null)).dates[0].state).toBe("ELIGIBLE");
    expect(evaluate(event(5, 15)).dates[0].state).toBe("ELIGIBLE");
  });

  it("excludes a day only when every allowed source has a below-threshold measurement", () => {
    expect(evaluate(event(5, 8)).dates[0].state).toBe("EXCLUDED");
  });

  it("revokes direct authenticated inserts of certificate snapshots and keeps server recalculation", () => {
    const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20261006020454_climate_snapshot_server_write.sql"), "utf8");
    const action = readFileSync(resolve(process.cwd(), "app/(internal)/projects/contract-climate-actions.ts"), "utf8");
    expect(migration).toMatch(/REVOKE\s+INSERT\s+ON\s+public\.certificate_climate_snapshots\s+FROM\s+authenticated/i);
    expect(migration).toMatch(/DROP POLICY IF EXISTS contract_climate_insert ON public\.certificate_climate_snapshots/i);
    expect(migration).toMatch(/auth\.role\(\)\s*=\s*'service_role'/i);
    expect(migration).toMatch(/NEW\.created_by/);
    expect(action).toContain("const result=evaluateContractClimate(");
    expect(action).toContain('if(result.status!=="COMPLETE")');
    expect(action).toContain('createAdminClient().from("certificate_climate_snapshots").insert');
  });
});
