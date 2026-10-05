import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { projectLocationPatch, isValidProjectCoords } from "../lib/projects/location-fields";
const read=(p:string)=>readFileSync(p,"utf8");
describe("Optional project location configuration",()=>{
  const form=(lat?:string,lon?:string)=>{const f=new FormData();if(lat!==undefined)f.set("latitude",lat);if(lon!==undefined)f.set("longitude",lon);return f;};
  it("preserves stored coordinates when the caller omits both fields",()=>expect(projectLocationPatch(form())).toEqual({patch:{},error:null}));
  it("clears only when both submitted fields are empty",()=>expect(projectLocationPatch(form("",""))).toEqual({patch:{latitude:null,longitude:null},error:null}));
  it.each([["-25.28","-57.64"],["0","0"],["90","180"],["-90","-180"]])("accepts decimal coordinates %s/%s",(lat,lon)=>expect(projectLocationPatch(form(lat,lon))).toEqual({patch:{latitude:Number(lat),longitude:Number(lon)},error:null}));
  it.each([["91","0"],["0","181"],["NaN","0"],["Infinity","0"],["25",undefined],["","30"],["",undefined],[undefined,""]])("denies partial or invalid coordinates %s/%s",(lat,lon)=>{const r=projectLocationPatch(form(lat,lon));expect(r.error).toBeTruthy();expect(r.patch).toEqual({});});
  it("keeps the existing validity boundary for absent coordinates",()=>{expect(isValidProjectCoords(null,null)).toBe(false);expect(isValidProjectCoords(0,0)).toBe(true);});
  it("uses the authorized company scoped existing project update",()=>{const s=read("app/(internal)/projects/actions.ts").split("export async function updateProject(")[1].split("export async function clearProjectSchedule")[0];expect(s).toContain('requirePlan("pro", ["administracion", "admin"])');expect(s).toContain('.eq("empresa_id", empresaId)');expect(s).toContain('...coordinates.patch');expect(s.indexOf('if (coordinates.error)')).toBeLessThan(s.indexOf('.update('));});
});
describe("Recovered surfaces preserve explicit action boundaries",()=>{
  it("historical precipitation opens review and does not persist the suggestion",()=>{const s=read("app/(internal)/projects/[id]/avance-fisico-panel.tsx");expect(s).toContain('setEditorDate(dateStr); setEditorCode("LL"); setEditorOpen(true)');expect(s).not.toContain('onClick={() => persist(dateStr, "LL")}');expect(s).toContain('await setWeatherDay(project.id, dateStr, code)');});
  it("preserves PREBID handlers and presentation gating",()=>{const s=read("app/(internal)/licitaciones/[id]/prebid/workspace.tsx");for(const action of ['saveWorkspaceBudgetItemAction(context','saveWorkspaceApuLineAction(context','createWorkspaceDiscoveryAction(context','adoptWorkspacePriceAction(context','savePrebidSettingsAction(context.id,settings)','!data.costs.complete||!data.hash'])expect(s).toContain(action);expect(s).toContain('max-w-xl');expect(s).toContain('Materiales');expect(s).not.toContain('bg-transparent w-full');});
  it("restores nested width limits and opaque native option colors",()=>{const css=read("app/globals.css");expect(css).toContain('.erp-workspace > :where(');expect(css).not.toContain('.erp-workspace :where(');expect(css).toContain('select option, select optgroup');});
  it("keeps self destination KPIs informational and real document links",()=>{const s=read("lib/dashboard/tender-kpis.ts");expect(s.match(/informational: true/g)).toHaveLength(6);expect(s.match(/href: "\/licitaciones\/documentos"/g)).toHaveLength(2);});
  it("personnel editing uses canonical dialogs",()=>{for(const f of ['add-labor-entry-form','labor-payments-panel','certificate-staff-section'])expect(read(`app/(internal)/projects/[id]/${f}.tsx`)).toContain('DialogContent title=');});
  it("exposes existing weather data without changing engines",()=>{const s=read("app/(internal)/projects/[id]/weekly-plan-section.tsx");expect(s).toContain('weather_adjusted_capacity');expect(s).toContain('weather_gap_quantity');expect(s).toContain('weather_adjusted_material_consumption_value');expect(s).toContain('Las cantidades objetivo permanecen iguales');});
});
