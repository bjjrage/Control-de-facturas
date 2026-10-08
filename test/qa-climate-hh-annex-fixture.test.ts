import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ClimateEvent, ClimateEvidence, ProjectWorkdayStatus } from "@/lib/types";
import {
  evaluateContractClimate,
  type ContractClimateParameters,
  type ContractClimatePolicy,
} from "@/lib/projects/contract-climate";

const fixture = JSON.parse(readFileSync("test/fixtures/qa-admin/climate-pbc-hh.json", "utf8")) as {
  pbc: ContractClimateParameters;
  escenarioHistorico: { LL: { fecha: string; mmLocal: number }; HH: { fecha: string }; B: { fecha: string } };
  esperado: Record<string, Record<string, unknown>>;
};

function workday(id: string, date: string, classification: ProjectWorkdayStatus["classification"], extra: Partial<ProjectWorkdayStatus> = {}): ProjectWorkdayStatus {
  return {
    id,
    empresa_id: "tenant-qa",
    project_id: "proj-qa",
    work_date: date,
    classification,
    climate_event_id: extra.climate_event_id ?? null,
    parent_workday_status_id: extra.parent_workday_status_id ?? null,
    reason_code: extra.reason_code ?? null,
    notes: extra.notes ?? null,
    source: "MANUAL",
    decision_status: "CONFIRMED",
    proposed_automatically: false,
    confirmed_by: "admin-qa",
    confirmed_at: "2026-10-07T09:00:00Z",
    created_at: "2026-10-07T09:00:00Z",
    updated_at: "2026-10-07T09:00:00Z",
  };
}

function climateEvent(date: string, mm: number | null): ClimateEvent {
  return {
    id: `event-${date}`,
    empresa_id: "tenant-qa",
    project_id: "proj-qa",
    event_date: date,
    source: "MANUAL",
    external_station_id: null,
    external_station_name: null,
    external_station_latitude: null,
    external_station_longitude: null,
    external_station_distance_km: null,
    external_observed_at: null,
    external_precipitation_mm: null,
    local_precipitation_mm: mm,
    contract_threshold_mm: fixture.pbc.thresholdMm,
    external_threshold_exceeded: false,
    local_threshold_exceeded: mm != null && mm > (fixture.pbc.thresholdMm ?? 0),
    threshold_exceeded: mm != null && mm > (fixture.pbc.thresholdMm ?? 0),
    local_source: "MANUAL",
    provider_fallback_reason: null,
    raw_source_payload: null,
    status: "CONFIRMED",
    created_at: "2026-10-07T09:00:00Z",
    updated_at: "2026-10-07T09:00:00Z",
  };
}

function evidenceFor(id: string, workdayStatusId: string): ClimateEvidence {
  return {
    id,
    empresa_id: "tenant-qa",
    project_id: "proj-qa",
    climate_event_id: null,
    workday_status_id: workdayStatusId,
    evidence_type: "RAIN_GAUGE_PHOTO",
    storage_bucket: "execution-photos",
    storage_path: "proj-qa/climate/fixture.png",
    file_name: "FOTO_LLUVIA_QA.png",
    mime_type: "image/png",
    size_bytes: 1000,
    captured_at: "2026-10-04T10:00:00Z",
    uploaded_by: "admin-qa",
    metadata: {},
    created_at: "2026-10-07T09:00:00Z",
  };
}

function buildScenario(hhEvidenceAttached: boolean) {
  const ll = workday("wd-ll", fixture.escenarioHistorico.LL.fecha, "NON_WORKABLE_RAIN", { climate_event_id: `event-${fixture.escenarioHistorico.LL.fecha}` });
  const hh = workday(
    "wd-hh",
    fixture.escenarioHistorico.HH.fecha,
    "NON_WORKABLE_OTHER",
    { climate_event_id: `event-${fixture.escenarioHistorico.LL.fecha}`, parent_workday_status_id: ll.id, reason_code: "TERRAIN_SATURATED" },
  );
  const b = workday("wd-b", fixture.escenarioHistorico.B.fecha, "WORKABLE");
  // Días históricos anteriores a la primera lluvia, confirmados como practicables.
  const leadDays = ["2026-10-01", "2026-10-02", "2026-10-03"].map((date, i) => workday(`wd-lead-${i}`, date, "WORKABLE"));
  const events = [climateEvent(fixture.escenarioHistorico.LL.fecha, fixture.escenarioHistorico.LL.mmLocal)];
  const evidence = [evidenceFor("ev-ll", ll.id)];
  if (hhEvidenceAttached) evidence.push({ ...evidenceFor("ev-hh", hh.id), evidence_type: "OTHER" as const, file_name: "DOC_EVIDENCIA_HH_QA.pdf" });
  const policy: ContractClimatePolicy = {
    id: "policy-qa-1",
    project_id: "proj-qa",
    empresa_id: "tenant-qa",
    version: 2,
    status: "VALIDATED",
    parameters: fixture.pbc,
    created_at: "2026-10-07T09:00:00Z",
    created_by: "admin-qa",
    validated_by: "admin-qa",
  };
  return {
    policies: [policy],
    workdays: [...leadDays, ll, hh, b],
    events,
    evidence,
    assessments: [],
    adjustments: [],
  };
}

describe("fixture QA: elegibilidad HH según evidencia del PBC (paso 51)", () => {
  it("sin evidencia adjunta, la HH queda pendiente y solo la LL es elegible (motivo del FAIL de la corrida)", () => {
    const result = evaluateContractClimate({ ...buildScenario(false), periodStart: "2026-10-01", periodEnd: "2026-10-06", asOf: "2026-10-07" });
    const hh = result.dates.find((d) => d.date === fixture.escenarioHistorico.HH.fecha)!;
    const ll = result.dates.find((d) => d.date === fixture.escenarioHistorico.LL.fecha)!;
    expect(ll.state).toBe("ELIGIBLE");
    expect(hh.state).toBe("PENDING");
    expect(hh.reason).toBe(fixture.esperado.sinEvidenciaHH.hhRazon);
    expect(result.eligibleDays).toBe(1);
  });

  it("con el documento adjuntado a la jornada HH, ambas son elegibles y la tolerancia absorbe el exceso (0 días de extensión)", () => {
    const result = evaluateContractClimate({ ...buildScenario(true), periodStart: "2026-10-01", periodEnd: "2026-10-06", asOf: "2026-10-07" });
    const hh = result.dates.find((d) => d.date === fixture.escenarioHistorico.HH.fecha)!;
    expect(hh.state).toBe("ELIGIBLE");
    expect(result.eligibleDays).toBe(fixture.esperado.conEvidenciaHH.elegibles as number);
    expect(result.computableDays).toBe(0);
    expect(result.groups[0].tolerance).toBe(2);
    expect(result.status).toBe("COMPLETE");
    expect(result.proposedDueDate).toBe(result.baseDueDate);
  });
});

describe("fixture QA: corte histórico del anexo climático (paso 53)", () => {
  it("un período que incluye fechas futuras al corte queda bloqueado y no inventa días", () => {
    const result = evaluateContractClimate({ ...buildScenario(true), periodStart: "2026-10-01", periodEnd: "2026-10-31", asOf: "2026-10-07" });
    expect(result.status).toBe("BLOCKED");
    expect(result.issues[0]).toBe("Elegí un período válido, hasta la fecha de corte.");
  });

  it("el anexo se calcula con el período vigente al corte histórico (01–06/10 al 07/10)", () => {
    const result = evaluateContractClimate({ ...buildScenario(true), periodStart: "2026-10-01", periodEnd: "2026-10-06", asOf: "2026-10-07" });
    expect(result.status).toBe("COMPLETE");
    expect(result.periodEnd).toBe("2026-10-06");
  });
});
