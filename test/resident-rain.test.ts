import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { registerResidentRain } from "@/lib/procurement/resident-rain";
import { validClimateDate } from "@/lib/procurement/climate-entry";
import { readFileSync } from "node:fs";

const token = "11111111-1111-4111-8111-111111111111";
function database() {
  const rows: Record<string, Record<string, unknown>[]> = { projects: [{ id: "project-a", status: "ACTIVO", start_date: "2026-01-01", execution_token: token, precipitation_threshold_mm: 15 }], climate_events: [], project_workday_status: [], climate_evidence: [] };
  const files = new Set<string>();
  const writes: { table: string; payload: Record<string, unknown> }[] = [];
  let uploadFail = false;
  const db = { from(table: string) {
    const filters: [string,unknown][] = []; let op = "read", payload: Record<string,unknown> = {};
    const run = () => {
      const match = rows[table].filter(row => filters.every(([key,value]) => row[key] === value));
      if (op === "insert") {
        const unique = table === "climate_events" ? "event_date" : table === "project_workday_status" ? "work_date" : "storage_path";
        if (rows[table].some(row => row.project_id === payload.project_id && row[unique] === payload[unique])) return { data: null, error: { code: "23505" } };
        const row = { id: `${table}-${rows[table].length}`, ...payload };
        rows[table].push(row); writes.push({table,payload}); return { data: row, error: null };
      }
      if (op === "update") { match.forEach(row => Object.assign(row,payload)); writes.push({table,payload}); }
      return { data: match[0] ?? null, error: null };
    };
    const q = { select() { return q; }, eq(key:string,value:unknown) { filters.push([key,value]); return q; }, insert(value:Record<string,unknown>) {op="insert";payload=value;return q;}, update(value:Record<string,unknown>) {op="update";payload=value;return q;}, single() {return Promise.resolve(run());}, maybeSingle() {return Promise.resolve(run());}, then(resolve: (v:unknown)=>unknown) { return Promise.resolve(run()).then(resolve); } };
    return q;
  }, storage: {from(bucket:string) { expect(bucket).toBe("execution-photos"); return { async upload(path:string,_bytes:Buffer,options:{upsert:boolean}) {expect(options.upsert).toBe(false);if(uploadFail)return{error:{message:"failed"}}; if(files.has(path))return{error:{message:"The resource already exists",statusCode:"409"}};files.add(path);return{error:null};} }; }} };
  return { db: db as unknown as SupabaseClient, rows, files, writes, failUpload: () => { uploadFail = true; } };
}
function form(mm="22") {
  const f = new FormData(); f.set("date","2026-09-03"); f.set("precipitation_mm",mm);
  f.set("photo",new File([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1kAAAAASUVORK5CYII=","base64")],"rain.png",{type:"image/png"}));return f;
}
describe("resident rainfall token boundary and canonical persistence", () => {
  it("rejects invalid dates, future dates and dates before project start", () => {
    expect(validClimateDate("2026-02-30")).toBe(false);
    expect(validClimateDate("2099-01-01")).toBe(false);
    expect(validClimateDate("2026-01-01","2026-02-01")).toBe(false);
  });
  it("resolves only an active project from its execution token", async () => {
    const d=database();expect((await registerResidentRain(d.db,token.replace(/^1/,"2"),form())).error).toBeTruthy();
    d.rows.projects[0].status="CERRADO";expect((await registerResidentRain(d.db,token,form())).error).toBeTruthy();expect(d.writes).toHaveLength(0);
  });
  it.each(["project_id","empresa_id","climate_event_id","workday_status_id","decision_status"])("denies browser context %s", async key => {
    const d=database(),f=form();f.set(key,"another-project");expect((await registerResidentRain(d.db,token,f)).error).toBeTruthy();expect(d.writes).toHaveLength(0);
  });
  it("requires exactly one appropriate photo and a nonnegative finite measurement", async () => {
    for(const bad of ["", "-1","NaN","Infinity","1000000"]) {const d=database();expect((await registerResidentRain(d.db,token,form(bad))).error).toBeTruthy();expect(d.files.size).toBe(0);}
    for(const kind of ["missing","duplicate","fake"]) {const d=database(),f=form(); if(kind==="missing")f.delete("photo");if(kind==="duplicate")f.append("photo",f.get("photo")!);if(kind==="fake")f.set("photo",new File(["html"],"fake.jpg",{type:"image/jpeg"}));expect((await registerResidentRain(d.db,token,f)).error).toBeTruthy();expect(d.writes).toHaveLength(0);}
  });
  it("persists local rain and immutable project/event evidence; only proposes and deduplicates retries", async () => {
    const d=database();expect(await registerResidentRain(d.db,token,form())).toEqual({error:null});expect(await registerResidentRain(d.db,token,form())).toEqual({error:null});
    expect(d.rows.climate_events).toHaveLength(1);expect(d.rows.project_workday_status).toHaveLength(1);expect(d.rows.climate_evidence).toHaveLength(1);
    expect(d.rows.climate_events[0]).toMatchObject({project_id:"project-a",local_precipitation_mm:22,local_source:"LOCAL_RAIN_GAUGE",local_threshold_exceeded:true});
    expect(d.rows.project_workday_status[0]).toMatchObject({decision_status:"PROPOSED",source:"RESIDENT",classification:"NON_WORKABLE_RAIN"});
    expect(d.rows.climate_evidence[0]).toMatchObject({project_id:"project-a",climate_event_id:d.rows.climate_events[0].id,evidence_type:"RAIN_GAUGE_PHOTO"});
    expect([...d.files][0]).toMatch(/^project-a\/climate\/resident\//);expect(d.writes.some(w=>w.payload.decision_status==="CONFIRMED")).toBe(false);
  });
  it("preserves external precipitation, thresholds and human decisions", async () => {
    const d=database();d.rows.climate_events.push({id:"event",project_id:"project-a",event_date:"2026-09-03",contract_threshold_mm:15,external_precipitation_mm:3,external_threshold_exceeded:false,threshold_exceeded:false,status:"CONFIRMED"});
    d.rows.project_workday_status.push({id:"human",project_id:"project-a",work_date:"2026-09-03",decision_status:"CONFIRMED",classification:"WORKABLE"});
    expect((await registerResidentRain(d.db,token,form())).error).toBeNull();expect(d.rows.climate_events[0]).toMatchObject({external_precipitation_mm:3,external_threshold_exceeded:false,threshold_exceeded:false,local_precipitation_mm:22,status:"CONFIRMED"});expect(d.rows.project_workday_status[0].classification).toBe("WORKABLE");
  });
  it("creates no facts if storage upload fails", async () => {const d=database();d.failUpload();expect((await registerResidentRain(d.db,token,form())).error).toBeTruthy();expect(d.writes).toHaveLength(0);});
  it("deduplicates simultaneous reports through project/date and evidence keys", async () => {
    const d=database();const results=await Promise.all([registerResidentRain(d.db,token,form()),registerResidentRain(d.db,token,form())]);
    expect(results).toEqual([{error:null},{error:null}]);expect(d.rows.climate_events).toHaveLength(1);expect(d.rows.project_workday_status).toHaveLength(1);expect(d.rows.climate_evidence).toHaveLength(1);
  });
  it("keeps internal authority and legacy read-only while exposing existing actions", () => {
    const actions=readFileSync("app/(internal)/projects/climate-actions.ts","utf8"),panel=readFileSync("app/(internal)/projects/[id]/climate-workdays-panel.tsx","utf8"),resident=readFileSync("app/avance/[token]/resident-workflows.tsx","utf8");
    expect(actions).not.toContain('.from("project_weather_log")');expect(actions).toContain('requirePlan("pro", ["administracion", "admin"])');expect(panel).toContain("createOtherWorkday(project.id, date, manualNote, manualType)");expect(panel).toContain("updateLocalPrecipitation(project.id, event.id");expect(panel).toContain("confirmWeatherWorkday(project.id");expect(panel).toContain("overrideWeatherWorkday(project.id");expect(resident).toContain("if (guard.current) return;");expect(resident).toContain("guard.current = true;");expect(resident).toContain("finally { guard.current = false");
    expect(readFileSync("app/(internal)/projects/[id]/avance-fisico-panel.tsx","utf8")).toContain("HISTÓRICO LEGACY — SOLO LECTURA");
  });
});
