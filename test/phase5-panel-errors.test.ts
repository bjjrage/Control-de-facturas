import { expect,it,vi } from "vitest";
import { sourceFunctions } from "./support/source-functions";
const base="app/(internal)/";
function find(n:any,predicate:(n:any)=>boolean):any{
 if(!n||typeof n!=="object")return null;if(predicate(n))return n;
 for(const c of[n.props?.children].flat(Infinity)){const found=find(c,predicate);if(found)return found;}return null;
}
it.each(["list","delete"])("#35 APU %s errors reach the visible error state",async kind=>{
 const setError=vi.fn();vi.stubGlobal("window",{confirm:()=>true});
 const {refresh,handleDelete}=sourceFunctions(base+"projects/[id]/apu-templates-section.tsx",["refresh","handleDelete"],{
  setLoading:vi.fn(),setTemplates:vi.fn(),setError,
  listApuTemplatesAction:async()=>({data:null,error:"No se pudo listar"}),
  deleteApuTemplateAction:async()=>({error:"No se pudo borrar"}),
 });
 if(kind==="list"){await refresh();await Promise.resolve();}else await handleDelete("id","APU");
 expect(setError).toHaveBeenCalledWith(kind==="list"?"No se pudo listar":"No se pudo borrar");vi.unstubAllGlobals();
});
it("#35 labor payment errors remain visible while the dialog is closed",()=>{
 let index=0;const values=[null,false,"SEMANAL","","","No se pudo borrar",false];
 const {LaborPaymentsPanel}=sourceFunctions(base+"projects/[id]/labor-payments-panel.tsx",["LaborPaymentsPanel","MODALIDADES","MODALIDAD_LABEL"],{
  useState:()=>[values[index++],vi.fn()],useCallback:(fn:any)=>fn,useEffect:vi.fn(),useRouter:()=>({refresh:vi.fn()}),
  InfoTooltip:"info",Button:"button",
 });
 const tree=LaborPaymentsPanel({projectId:"p",budgetItems:[]});
 expect(find(tree,n=>n.props?.role==="alert"&&String(n.props.children).includes("No se pudo borrar"))).toBeTruthy();
});

