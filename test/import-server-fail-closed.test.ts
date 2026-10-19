import { expect,it,vi } from "vitest";
import { sourceFunctions } from "./support/source-functions";
import { validateScheduleDates } from "../lib/projects/schedule";
import { normalizeInventoryImportText,findUniqueExactInventoryMatch } from "../lib/inventory/initial-stock-import";
import { matchLaborRate } from "../lib/procurement/apu-templates";
function fixture(){
 const writes:any[]=[];
 function query(table:string){
  let rows:any=table==="projects"?{id:"p"}:table==="budget_items"?[{id:"a",sort_order:0}]:[];
  const q:any={};for(const name of["select","eq","order","limit","in","like"])q[name]=()=>q;
  q.single=q.maybeSingle=()=>Promise.resolve({data:rows,error:null});
  for(const name of["insert","upsert","update"])q[name]=(value:any)=>{writes.push({table,name,value});if(name==="insert")rows=value.map((r:any,i:number)=>({...r,id:"id"+i}));return q;};
  q.then=(resolve:any)=>Promise.resolve({data:rows,error:null}).then(resolve);return q;
 }
 return {writes,deps:{requirePlan:async()=>({id:"u",empresa_id:"e"}),createClient:async()=>({from:query}),refreshAfterSave:vi.fn(),revalidatePath:vi.fn(),validateScheduleDates,
  normalizeInventoryImportText,findUniqueExactInventoryMatch,matchLaborRate,PLANILLA_APU_PREFIX:"APU:",HOUR_UNIT:/^(h|horas)$/i,WORKDAY_UNIT:/^(jornal|dia)$/i}};
}
const base="app/(internal)/projects/";
it("#32 budget action rejects the whole invalid payload before inserting",async()=>{
 const {writes,deps}=fixture(),{importBudgetItems}=sourceFunctions(base+"actions.ts",["importBudgetItems"],deps);
 const item={code:"1",description:"Valid",quantity:1,unit_price:2,start_date:null,end_date:null};
 const result=await importBudgetItems("p",[item,{...item,code:""}]);
 expect(writes).toEqual([]);expect(result.error).toBeTruthy();
});
it("#32 schedule action validates all rows before changing any dates",async()=>{
 const {writes,deps}=fixture(),{applyScheduleImport}=sourceFunctions(base+"actions.ts",["applyScheduleImport"],deps);
 const result=await applyScheduleImport("p",[{itemId:"a",start_date:"2026-10-01",end_date:"2026-10-02",depends_on:null},
 {itemId:"foreign",start_date:"2026-10-01",end_date:"2026-10-02",depends_on:null}]);
 expect(writes).toEqual([]);expect(result.applied).toBe(0);expect(result.failed.length).toBeGreaterThan(0);
});
it("#32 APU rejects an invalid line before creating products or templates",async()=>{
 const {writes,deps}=fixture(),{importApuPlanillaAction}=sourceFunctions(base+"[id]/apu-templates-actions.ts",["importApuPlanillaAction"],deps);
 const result=await importApuPlanillaAction({createMissingProducts:true,recipes:[{name:"Recipe",code:"r",unit:"u",lines:[
 {tipo:"MATERIAL",descripcion:"New material",unidad:"m",cantidad:1,precio:10,desperdicioPct:0},
 {tipo:"SUBCONTRATO",descripcion:"Bad line",unidad:"u",cantidad:0,precio:10,desperdicioPct:0}]}]});
 expect(writes).toEqual([]);expect(result.error).toBeTruthy();
});
it("#32 recipe parser blocks ambiguous quantities and preserves decimals",()=>{
 const {parsePyNumber}=sourceFunctions(base+"[id]/import-recipe-dialog.tsx",["parsePyNumber"]);
 expect(parsePyNumber("2.5")).toBe(2.5);expect(parsePyNumber("1.234")).toBeNull();
});
it("#32 valid budget and schedule inputs still save without dropping rows",async()=>{
 const budget=fixture(),{importBudgetItems}=sourceFunctions(base+"actions.ts",["importBudgetItems"],budget.deps);
 const result=await importBudgetItems("p",[{code:"1",description:"Valid",quantity:2.5,unit_price:10,start_date:null,end_date:null}]);
 expect(result.error).toBeNull();expect(result.inserted).toBe(1);
 const schedule=fixture(),{applyScheduleImport}=sourceFunctions(base+"actions.ts",["applyScheduleImport"],schedule.deps);
 expect((await applyScheduleImport("p",[{itemId:"a",start_date:"2026-10-01",end_date:"2026-10-02",depends_on:null}])).applied).toBe(1);
});
it("#32 valid APU creates the planned product and uses its actual id",async()=>{
 const {writes,deps}=fixture(),{importApuPlanillaAction}=sourceFunctions(base+"[id]/apu-templates-actions.ts",["importApuPlanillaAction"],deps);
 const result=await importApuPlanillaAction({createMissingProducts:true,recipes:[{name:"Recipe",code:"r",unit:"u",lines:[
 {tipo:"MATERIAL",descripcion:"New material",unidad:"m",cantidad:2.5,precio:10,desperdicioPct:0}]}]});
 expect(result.error).toBeNull();expect(result.lineas).toBe(1);
 expect(writes.find(w=>w.table==="apu_template_materials").value[0].producto_id).toBe("id0");
});
