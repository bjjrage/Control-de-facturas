import { expect,it,vi } from "vitest";
import { sourceFunctions } from "./support/source-functions";
const base="app/(internal)/projects/";
const noop=()=>{};
it("#32 budget confirmation never silently drops invalid rows",async()=>{
 const write=vi.fn(async()=>({error:null})),setError=vi.fn();
 const {confirmImport}=sourceFunctions(base+"[id]/import-budget-dialog.tsx",["confirmImport"],{
  invalidCount:1,duplicateCodes:false,validItems:[{code:"1"}],projectId:"p",setPending:noop,setError,setOpen:noop,reset:noop,importBudgetItems:write,
 });
 await confirmImport();expect(write).not.toHaveBeenCalled();expect(setError).toHaveBeenCalledWith(expect.stringMatching(/correg/i));
});
it("#32 schedule confirmation never silently drops an unlinked row",async()=>{
 const write=vi.fn(async()=>({applied:1,failed:[]})),setError=vi.fn();
 const {confirmImport}=sourceFunctions(base+"[id]/import-cronograma-dialog.tsx",["confirmImport"],{
  interpretation:{stats:{unlinked:1},rows:[{match:{itemId:"a"},start:"2026-10-01",end:"2026-10-02",warnings:[]},{match:null,warnings:[]}]},
  updates:[{itemId:"a"}],predecessors:new Map(),setError,startTransition:async(fn:()=>unknown)=>fn(),
  applyScheduleImport:write,projectId:"p",setResult:noop,setStep:noop,router:{refresh:noop},
 });
 await confirmImport();expect(write).not.toHaveBeenCalled();expect(setError).toHaveBeenCalled();
});
it.each(["unresolved","totalMismatch"])("#32 APU needs a deliberate decision for %s",async kind=>{
 const write=vi.fn(async()=>({plantillas:1}));vi.stubGlobal("window",{confirm:()=>false});
 const {confirm}=sourceFunctions(base+"[id]/apu-planilla-import.tsx",["confirm"],{
  preview:{recipes:[{name:"APU",totalMismatch:kind==="totalMismatch",declaredTotal:12,computedTotal:10,lines:[]}],unresolved:kind==="unresolved"?[{row:2}]:[],questions:[],warnings:[]},
  setError:noop,setStage:noop,createMissing:true,hoursPerWorkday:"8",importApuPlanillaAction:write,setResult:noop,onDone:noop,
 });
 await confirm();expect(write).not.toHaveBeenCalled();vi.unstubAllGlobals();
});
it("#32 manual recipe does not silently omit an incomplete row",async()=>{
 const write=vi.fn(async()=>({data:{id:"r"}}));
 const good={budgetItemId:"a",quantity:"2",unit:"m"};
 const {handleConfirmManual}=sourceFunctions(base+"[id]/import-recipe-dialog.tsx",["handleConfirmManual"],{
  setSaveError:noop,recipeCode:"R",recipeName:"Recipe",prodUnit:"u",manualRows:[good,{budgetItemId:"b",quantity:"",unit:"m"}],
  manualValidRows:[good],setSaving:noop,saveProductionRecipe:write,projectId:"p",contractQty:"",budgetItems:[{id:"a",unit:"m"}],onImported:noop,
 });
 await handleConfirmManual();expect(write).not.toHaveBeenCalled();
});
it("#32 selecting a recipe item manually does not bypass quantity validation",()=>{
 const {matchStatus}=sourceFunctions(base+"[id]/import-recipe-dialog.tsx",["matchStatus"],{budgetItems:[{id:"a"}],byCode:new Map()});
 expect(matchStatus({manualItemId:"a",cantidad:null}).kind).toBe("error");
});
it("#32 unlinked certificate rows require explicit acknowledgement",()=>{
 let i=0;const states=[true,new File(["x"],"cert.xlsx"),{
  rows:[{sourceRow:1,quantityCurrent:1,unitPrice:10,quantityPrevious:0}],budgetItems:[],previousQuantityByBudgetItem:{},
  certificate:{warnings:[],planNeedsReview:false,number:1,periodStart:"2026-10-01",periodEnd:"2026-10-31",sheet:"Certificado"},existingImport:null,
 },{},null,false,false,false,false];
 const {ImportCertificadoDialog}=sourceFunctions(base+"[id]/import-certificado-dialog.tsx",["ImportCertificadoDialog"],{
  useState:()=>[states[i++],noop],useMemo:(fn:()=>unknown)=>fn(),Dialog:"dialog",DialogTrigger:"trigger",DialogContent:"content",
  Button:"button",InfoTooltip:"info",Upload:"upload",FileSpreadsheet:"file",AlertTriangle:"alert",Input:"input",Label:"label",Select:"select",money:String,number:String,
 });
 const node=ImportCertificadoDialog({projectId:"p",onImported:noop});
 const nodes:any[]=[];function walk(n:any){if(!n||typeof n!=="object")return;nodes.push(n);for(const c of[n.props?.children].flat(Infinity))walk(c);}walk(node);
 const button=nodes.find(n=>n.props?.onClick&&String(n.props.children).includes("Confirmar importación"));
 expect(button.props.disabled).toBe(true);
 expect(nodes.some(n=>n.type==="input"&&n.props.type==="checkbox")).toBe(true);
});
