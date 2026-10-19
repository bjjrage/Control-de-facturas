import { expect,it,vi } from "vitest";
import { sourceFunctions } from "./support/source-functions";
const base="app/(internal)/";
function find(n:any,predicate:(n:any)=>boolean):any{
 if(!n||typeof n!=="object")return null;if(predicate(n))return n;
 for(const c of[n.props?.children].flat(Infinity)){const found=find(c,predicate);if(found)return found;}return null;
}
it.each(["list","delete"])("#35 APU %s errors reach the visible error state",async kind=>{
 const setError=vi.fn(),setDeleting=vi.fn();
 const {refresh,handleDelete}=sourceFunctions(base+"projects/[id]/apu-templates-section.tsx",["refresh","handleDelete"],{
  setLoading:vi.fn(),setTemplates:vi.fn(),setError,
  deleting:{id:"id",nombre:"APU"},deletePending:false,setDeletePending:vi.fn(),setDeleting,
  listApuTemplatesAction:async()=>({data:null,error:"No se pudo listar"}),
  deleteApuTemplateAction:async()=>({error:"No se pudo borrar"}),
 });
 if(kind==="list"){await refresh();await Promise.resolve();}else await handleDelete();
 expect(setError).toHaveBeenCalledWith(kind==="list"?"No se pudo listar":"No se pudo borrar");
 expect(setDeleting).not.toHaveBeenCalled();
});
it("U1 keeps the APU confirmation open when deletion throws and unlocks retry",async()=>{
 const setError=vi.fn(),setDeletePending=vi.fn(),setDeleting=vi.fn(),refresh=vi.fn();
 const {handleDelete}=sourceFunctions(base+"projects/[id]/apu-templates-section.tsx",["handleDelete"],{
  deleting:{id:"id",nombre:"APU"},deletePending:false,setDeletePending,setDeleting,setError,refresh,
  deleteApuTemplateAction:async()=>{throw new Error("network");},
 });
 await handleDelete();
 expect(setError).toHaveBeenCalledWith("No se pudo borrar la plantilla. Reintentá.");
 expect(setDeleting).not.toHaveBeenCalled();expect(refresh).not.toHaveBeenCalled();
 expect(setDeletePending).toHaveBeenLastCalledWith(false);
});
it("U1 cannot delete before choosing a template or while a request is pending",async()=>{
 for(const state of [{deleting:null,deletePending:false},{deleting:{id:"id"},deletePending:true}]){
  const remove=vi.fn();
  const {handleDelete}=sourceFunctions(base+"projects/[id]/apu-templates-section.tsx",["handleDelete"],{...state,deleteApuTemplateAction:remove});
  await handleDelete();expect(remove).not.toHaveBeenCalled();
 }
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

