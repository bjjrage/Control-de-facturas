import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { AvanceFisicoPanel } from "@/app/(internal)/projects/[id]/avance-fisico-panel";

const project = { id: "fixture-project", code: "DEMO", name: "Fixture local de calendario", start_date: "2026-07-01", orden_inicio_date: "2026-07-01", plazo_dias: 120, contract_amount: 100000000, precipitation_threshold_mm: 15, weather_source: "dmh-dinac", latitude: -25.3, longitude: -57.6, execution_token: "fixture-token" };
const events = [{ id: "fixture-event", project_id: project.id, event_date: "2026-09-03", source: "DMH_DINAC", external_precipitation_mm: 18, external_threshold_exceeded: true, local_precipitation_mm: 23 }];
const evidence = [{ id: "fixture-photo", project_id: project.id, climate_event_id: "fixture-event", evidence_type: "RAIN_GAUGE_PHOTO", storage_path: "fixture/photo.png", metadata: { submitted_by_portal: true, precipitation_mm: 23 } }];
window.fixtureWrites = [];
window.fixtureWorkdays = [
  { id: "b", work_date: "2026-07-21", classification: "WORKABLE", source: "MANUAL", decision_status: "CONFIRMED" },
  { id: "ll", work_date: "2026-08-07", classification: "NON_WORKABLE_RAIN", source: "MANUAL", decision_status: "CONFIRMED" },
  { id: "hh", work_date: "2026-08-19", classification: "NON_WORKABLE_OTHER", reason_code: "TERRAIN_SATURATED", source: "MANUAL", decision_status: "CONFIRMED" },
  { id: "o", work_date: "2026-09-01", classification: "NON_WORKABLE_OTHER", reason_code: "OTHER", source: "MANUAL", decision_status: "CONFIRMED" },
  { id: "proposal", work_date: "2026-09-03", climate_event_id: "fixture-event", classification: "NON_WORKABLE_RAIN", source: "AUTOMATIC", decision_status: "PROPOSED", proposed_automatically: true },
];
function App() {
  const [, refresh] = useState(0);
  window.refreshFixture = () => refresh(value => value + 1);
  return <main className="mx-auto max-w-[1400px] p-4 space-y-3">
    <p className="text-xs text-[var(--warn)]">FIXTURE LOCAL · datos sintéticos · no es sesión autenticada ni aceptación de Production</p>
    <h1 className="text-lg">Certificar → Avance físico</h1>
    <AvanceFisicoPanel project={project} certificates={[]} weatherLogs={[]} climateEvents={events} climateWorkdays={[...window.fixtureWorkdays]} climateEvidence={evidence} schedulePlans={[]} planMonths={{}} appUrl={window.location.origin} />
  </main>;
}
createRoot(document.getElementById("root")).render(<App />);
