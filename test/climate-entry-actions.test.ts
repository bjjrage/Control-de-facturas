import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ rows: {} as Record<string, Record<string,unknown>[]>, writes: [] as { table:string; payload:Record<string,unknown> }[] }));
vi.mock("@/lib/auth", () => ({ requirePlan: vi.fn(async () => ({ id:"actor",empresa_id:"tenant" })) }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(async () => {}) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from(table:string) {
  const filters:[string,unknown][]=[]; let mode="read",payload:Record<string,unknown>={};
  const execute=()=>{
    const found=state.rows[table].filter(r=>filters.every(([key,v])=>r[key]===v));
    if(mode==="insert"){const row={id:`${table}-new`,...payload};state.rows[table].push(row);state.writes.push({table,payload});return{data:row,error:null};}
    if(mode==="update"){found.forEach(r=>Object.assign(r,payload));state.writes.push({table,payload});}
    return{data:found[0]??null,error:null};
  };
  const q={select(){return q;},eq(key:string,value:unknown){filters.push([key,value]);return q;},insert(p:Record<string,unknown>){mode="insert";payload=p;return q;},update(p:Record<string,unknown>){mode="update";payload=p;return q;},single(){return Promise.resolve(execute());},maybeSingle(){return Promise.resolve(execute());},then(resolve:(v:unknown)=>unknown){return Promise.resolve(execute()).then(resolve);}};return q;
} }) }));
import { createOtherWorkday, updateLocalPrecipitation } from "@/app/(internal)/projects/climate-actions";
import { libroDecision } from "@/lib/procurement/climate-calendar";

beforeEach(()=>{state.rows={projects:[{id:"project-a",empresa_id:"tenant",start_date:"2026-01-01",precipitation_threshold_mm:15}],project_workday_status:[],climate_events:[]};state.writes=[];});
describe("authenticated existing climate actions",()=>{
  it.each(["B", "LL", "HH", "O"] as const)("persists calendar %s as an explicit canonical human decision", async code => {
    const decision = libroDecision(code);
    expect(await createOtherWorkday("project-a", "2026-09-03", "", decision.classification, decision.reasonCode)).toEqual({ error: null });
    expect(state.rows.project_workday_status[0]).toMatchObject({ classification: decision.classification, reason_code: decision.reasonCode, decision_status: "CONFIRMED", confirmed_by: "actor", source: "MANUAL" });
    expect(state.writes.some(write => write.table === "project_weather_log")).toBe(false);
  });
  it.each(["WORKABLE","NON_WORKABLE_RAIN","NON_WORKABLE_OTHER"] as const)("records manual %s only in the canonical model",async classification=>{
    expect(await createOtherWorkday("project-a","2026-09-03","Manual review",classification)).toEqual({error:null});
    expect(state.rows.project_workday_status[0]).toMatchObject({classification,source:"MANUAL",decision_status:"CONFIRMED",confirmed_by:"actor"});
    if(classification==="NON_WORKABLE_RAIN")expect(state.rows.project_workday_status[0].climate_event_id).toBe(state.rows.climate_events[0].id);
    expect(state.writes.every(w=>["climate_events","project_workday_status"].includes(w.table))).toBe(true);
  });
  it("denies a foreign project before any mutation",async()=>{expect((await createOtherWorkday("other-project","2026-09-03","note")).error).toBeTruthy();expect(state.writes).toHaveLength(0);});
  it("does not replace an existing human confirmation",async()=>{
    state.rows.project_workday_status.push({id:"human",project_id:"project-a",work_date:"2026-09-03",decision_status:"CONFIRMED",classification:"WORKABLE"});
    expect((await createOtherWorkday("project-a","2026-09-03","note","NON_WORKABLE_RAIN")).error).toBeTruthy();expect(state.writes).toHaveLength(0);
  });
  it("saves local rainfall through updateLocalPrecipitation without replacing external facts",async()=>{
    state.rows.climate_events.push({id:"event",project_id:"project-a",event_date:"2026-09-03",external_precipitation_mm:3,external_threshold_exceeded:false,threshold_exceeded:false,contract_threshold_mm:15});
    expect(await updateLocalPrecipitation("project-a","event",22)).toEqual({error:null});
    expect(state.rows.climate_events[0]).toMatchObject({external_precipitation_mm:3,external_threshold_exceeded:false,threshold_exceeded:false,local_precipitation_mm:22,local_threshold_exceeded:true,local_source:"LOCAL_RAIN_GAUGE"});
    expect((await updateLocalPrecipitation("project-a","foreign-event",10)).error).toBeTruthy();
  });
});
