import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

describe("Canonical climate workflow in the historical Libro", () => {
  const tabs = read("app/(internal)/projects/[id]/project-tabs-client.tsx");
  const avance = read("app/(internal)/projects/[id]/avance-fisico-panel.tsx");
  const panel = read("app/(internal)/projects/[id]/climate-workdays-panel.tsx");
  const evaluator = read("lib/procurement/climate-workdays.ts");
  const actions = read("app/(internal)/projects/climate-actions.ts");
  const historical = read("app/(internal)/projects/historical-weather-actions.ts");

  it("passes canonical events, workdays, and evidence into the Avance físico Libro", () => {
    expect(tabs).toContain("climateEvents={climateEvents}");
    expect(tabs).toContain("climateWorkdays={climateWorkdays}");
    expect(tabs).toContain("climateEvidence={climateEvidence}");
    expect(avance).toContain("<ClimateWorkdaysPanel");
    expect(avance).toContain("events={climateEvents}");
    expect(avance).toContain("workdays={climateWorkdays}");
    expect(avance).toContain("evidence={climateEvidence}");
    expect(panel).toContain("rows.map((workday)");
  });

  it("keeps an automatic proposal pending until an explicit human action", () => {
    expect(evaluator).toContain('decision_status: "PROPOSED"');
    expect(evaluator).toContain("proposed_automatically: true");
    expect(panel).toContain('workday.decision_status === "PROPOSED"');
    expect(panel).toContain("Propuesta automática");
    expect(panel).toContain("Confirmar");
    expect(panel).toContain("Corregir / Override");
    expect(actions).toContain("export async function confirmWeatherWorkday(");
    expect(actions).toContain('decision_status: "CONFIRMED"');
  });

  it("uses the existing audited confirm and override actions", () => {
    expect(panel).toContain("confirmWeatherWorkday(project.id, workday.id)");
    expect(panel).toContain("overrideWeatherWorkday(project.id, workday.id");
    expect(actions).toContain("export async function overrideWeatherWorkday(");
    expect(actions).toContain('status: "OVERRIDDEN"');
    expect(actions).toContain('source: "MANUAL"');
  });

  it("keeps project_weather_log visible only as a non-authoritative legacy history", () => {
    expect(avance).toContain('data-testid="legacy-project-weather-log"');
    expect(avance).toContain("LEGACY");
    expect(avance).toContain("project_weather_log");
    expect(avance).not.toContain("setWeatherDay");
    expect(avance).not.toContain("onClick={() => cycle(dateStr)}");
    expect(avance).not.toContain("usar-como-ll");
    expect(avance).not.toContain("<ClimateWorkdaysPanel project={project} events={[]}");
  });

  it("labels Open-Meteo as supporting evidence and keeps its action read-only", () => {
    expect(avance).toContain("Open-Meteo aporta clima observado como evidencia de apoyo");
    expect(avance).toContain("No crea ni confirma jornadas contractuales");
    expect(historical).toContain("fetchHistoricalWeatherRange");
    expect(historical).not.toContain(".insert(");
    expect(historical).not.toContain(".update(");
    expect(historical).not.toContain(".upsert(");
    expect(historical).not.toContain(".delete(");
  });

  it("keeps coordinate validation visible and fail-closed", () => {
    expect(panel).toContain("isValidProjectCoords");
    expect(panel).toContain("latitud y longitud");
    expect(panel).toContain("!isValidProjectCoords(project.latitude,project.longitude)");
    expect(historical).toContain("MISSING_PROJECT_LOCATION_MSG");
    expect(historical).toContain("isValidProjectCoords(project.latitude");
  });

  it("does not query future dates as historical weather or allow future Libro evaluation", () => {
    expect(panel).toContain("max={historicalOnly ? today : undefined}");
    expect(panel).toContain("historicalOnly && date > today");
    expect(avance).toContain("monthEnd > today ? today : monthEnd");
    expect(avance).toContain("if (start > today) return");
  });
});
