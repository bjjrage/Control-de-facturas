import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { libroCode, libroDayFacts, libroDecision, libroMonths } from "@/lib/procurement/climate-calendar";
import { ClimateLibroCalendar } from "@/app/(internal)/projects/[id]/climate-libro-calendar";
import type { ClimateEvent, ClimateEvidence, Project, ProjectWorkdayStatus } from "@/lib/types";

const project = { id: "project", start_date: "2026-09-01", plazo_dias: 30 } as Project;
const event = { id: "event", event_date: "2026-09-03", source: "DMH_DINAC", external_precipitation_mm: 18, external_threshold_exceeded: true, local_precipitation_mm: 23 } as ClimateEvent;
const proposed = { id: "day", work_date: "2026-09-03", climate_event_id: "event", classification: "NON_WORKABLE_RAIN", decision_status: "PROPOSED", proposed_automatically: true } as ProjectWorkdayStatus;
const photo: ClimateEvidence = { id: "photo", empresa_id: "company", project_id: "project", climate_event_id: "event", workday_status_id: null, evidence_type: "RAIN_GAUGE_PHOTO", storage_bucket: "execution-photos", storage_path: "project/climate/photo.png", file_name: "photo.png", mime_type: "image/png", size_bytes: 100, captured_at: null, uploaded_by: null, metadata: { submitted_by_portal: true, precipitation_mm: 23 }, created_at: "2026-09-03T00:00:00Z" };
describe("canonical administrative calendar projection", () => {
  it.each([
    ["B", "WORKABLE", null], ["LL", "NON_WORKABLE_RAIN", null],
    ["HH", "NON_WORKABLE_OTHER", "TERRAIN_SATURATED"], ["O", "NON_WORKABLE_OTHER", "OTHER"],
  ] as const)("maps %s to existing canonical enums only", (code, classification, reasonCode) => {
    expect(libroDecision(code)).toEqual({ classification, reasonCode });
    expect(libroCode({ ...proposed, classification, reason_code: reasonCode })).toBe(code);
  });
  it("keeps a meteorological proposal separate from the final human state", () => {
    const facts = libroDayFacts("2026-09-03", [event], [proposed], [photo]);
    expect(facts.final).toBeNull(); expect(facts.proposal).toBe("LL");
    expect(facts.residentPhotos).toEqual([photo]); expect(proposed.decision_status).toBe("PROPOSED");
  });
  it("preserves a final B independently of rainy external and resident evidence", () => {
    const day = { ...proposed, decision_status: "CONFIRMED" as const, classification: "WORKABLE" as const };
    const facts = libroDayFacts("2026-09-03", [event], [day], [photo]);
    expect(facts.final).toBe("B"); expect(facts.proposal).toBeNull(); expect(facts.observations[0].external_precipitation_mm).toBe(18); expect(facts.residentPhotos[0].metadata?.precipitation_mm).toBe(23);
  });
  it("places resident evidence on its event date rather than unrelated calendar days", () => {
    expect(libroDayFacts("2026-09-04", [event], [proposed], [photo]).residentPhotos).toEqual([]);
    expect(libroDayFacts("2026-09-03", [event], [], [photo]).residentPhotos).toEqual([photo]);
  });
  it("keeps existing canonical dates outside the original period reachable", () => {
    expect(libroMonths(project, ["2027-02-03"], "2026-10-05")).toContainEqual({ year: 2027, month: 1 });
  });
  it("renders every monthly day with independent proposal and resident evidence, without auto-confirm calls", () => {
    const onConfirm = vi.fn(), onSave = vi.fn();
    const html = renderToStaticMarkup(createElement(ClimateLibroCalendar, { project, events: [event], workdays: [proposed], evidence: [photo], pending: false, onSelectDate: vi.fn(), onSave, onConfirm, onPhoto: vi.fn() }));
    expect(html).toContain("Septiembre 2026"); expect(html).toContain('aria-label="Día 2026-09-30"');
    expect(html).toContain("Sugerencia LL"); expect(html).toContain("DMH 18 mm"); expect(html).toContain("23 mm · Residente");
    expect(html).toContain("Guardar cambios"); expect(html).toContain("Descartar cambios");
    expect(onConfirm).not.toHaveBeenCalled(); expect(onSave).not.toHaveBeenCalled();
  });
  it("keeps calendar first, advanced editing secondary, legacy collapsed and the existing resident link", () => {
    const panel = readFileSync("app/(internal)/projects/[id]/climate-workdays-panel.tsx", "utf8");
    const avance = readFileSync("app/(internal)/projects/[id]/avance-fisico-panel.tsx", "utf8");
    const link = readFileSync("app/(internal)/projects/[id]/execution-link-dialog.tsx", "utf8");
    expect(panel.indexOf("<ClimateLibroCalendar")).toBeLessThan(panel.indexOf("<details"));
    expect(panel).not.toContain("Entrada manual · fecha"); expect(panel).toContain('token={project.execution_token}');
    expect(avance).toContain("<details"); expect(avance).not.toContain("<details open");
    expect(link).toContain("/avance/${token}"); expect(link).toContain("Copiar link");
    expect(panel).toContain("confirmWeatherWorkday(project.id, workday.id)");
  });
});
