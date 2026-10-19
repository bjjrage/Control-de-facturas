import { expect,it,vi } from "vitest";
import { sourceFunctions } from "./support/source-functions";
function find(node:any,text:string):any {
 if(!node||typeof node!=="object")return null;
 if(node.props?.onClick&&String([node.props.children].flat().join("")).includes(text))return node;
 for(const child of[node.props?.children].flat(Infinity)){const found=find(child,text);if(found)return found;}
 return null;
}
it("#34 canceling confirmation preserves a schedule version",()=>{
 const remove=vi.fn(),confirm=vi.fn(()=>false);
 vi.stubGlobal("window",{confirm});
 const {SchedulePlanEditor}=sourceFunctions("app/(internal)/projects/[id]/avance-fisico-panel.tsx",["SchedulePlanEditor"],{
  useState:(v:any)=>[v,vi.fn()],useMemo:(fn:()=>unknown)=>fn(),Button:"button",Input:"input",
 });
 const node=SchedulePlanEditor({projectId:"p",plan:{id:"s",label:"Original"},months:[],defaultMonths:1,pending:false,onDeletePlan:remove});
 find(node,"Eliminar versión").props.onClick();
 expect(remove).not.toHaveBeenCalled();expect(confirm).toHaveBeenCalled();
 confirm.mockReturnValue(true);find(node,"Eliminar versión").props.onClick();expect(remove).toHaveBeenCalledOnce();
 vi.unstubAllGlobals();
});
it("#34 canceling discard preserves the saved import",async()=>{
 const discard=vi.fn(),setSession=vi.fn();vi.stubGlobal("window",{confirm:()=>false});
 const {handleDiscard}=sourceFunctions("app/(internal)/projects/workbook-import-preview.tsx",["handleDiscard"],{
  session:{id:"import"},discardImportSession:discard,setSession,setError:vi.fn(),
 });
 await handleDiscard();expect(discard).not.toHaveBeenCalled();expect(setSession).not.toHaveBeenCalled();
 vi.unstubAllGlobals();
});
it("#34 a rejected discard keeps the current session and reports the error",async()=>{
 const setSession=vi.fn(),setError=vi.fn();vi.stubGlobal("window",{confirm:()=>true});
 const {handleDiscard}=sourceFunctions("app/(internal)/projects/workbook-import-preview.tsx",["handleDiscard"],{
  session:{id:"import"},discardImportSession:async()=>({error:"No se pudo descartar"}),setSession,setError,
 });
 await handleDiscard();expect(setSession).not.toHaveBeenCalled();expect(setError).toHaveBeenCalledWith("No se pudo descartar");
 vi.unstubAllGlobals();
});
