import { expect,it,vi } from "vitest";
import { sourceFunctions } from "./support/source-functions";
const file="app/(internal)/projects/[id]/certificados-table.tsx";
const {QtyInput,LiqRow}=sourceFunctions(file,["QtyInput","LiqRow"]);
it.each(["quantity","deduction"])("#33 clearing a %s does not persist zero",async kind=>{
 const save=vi.fn().mockResolvedValue(true);const node=kind==="quantity"?QtyInput({value:10,label:"Presente",onSave:save}):LiqRow({label:"Retención",value:10,editable:true,onSave:save});
 const input=kind==="quantity"?node:[node.props.children].flat().find((n:any)=>n?.type==="input");
 await input.props.onBlur({target:{value:""},currentTarget:{value:""}});expect(save).not.toHaveBeenCalled();
 await input.props.onBlur({target:{value:"0"},currentTarget:{value:"0"}});expect(save).toHaveBeenCalledWith(0);
});
it("#33 reports a rejected unit progress save and does not refresh as if saved",async()=>{
 const setters:any[]=[],refresh=vi.fn(),pending:Promise<unknown>[]=[];
 const {UnitAvanceSection}=sourceFunctions(file,["UnitAvanceSection"],{
  useRouter:()=>({refresh}),useState:(initial:any)=>{const setter=vi.fn();setters.push(setter);return[typeof initial==="function"?initial():initial,setter]},
  useTransition:()=>[false,(fn:()=>Promise<unknown>)=>pending.push(fn())],Button:"button",
  upsertCertificateUnitProgress:async()=>({error:"No se pudo guardar el avance"}),
 });
 const node=UnitAvanceSection({certificateId:"cert",units:[{id:"u",nombre:"Unidad"}],progress:[],editable:true,pending:false,onAutoFill:vi.fn()});
 function find(n:any):any{if(!n||typeof n!=="object")return null;if(n.type==="input")return n;for(const c of[n.props?.children].flat(Infinity)){const x=find(c);if(x)return x;}return null;}
 find(node).props.onBlur({target:{value:"20"}});await Promise.all(pending);
 expect(refresh).not.toHaveBeenCalled();expect(setters.some(setter=>setter.mock.calls.some((args:any[])=>String(args[0]).includes("No se pudo guardar")))).toBe(true);
});

it("restores the quantity field when the server rejects over-certification",async()=>{const save=vi.fn().mockResolvedValue(false),input={value:"105"};const node=QtyInput({value:10,label:"Presente",onSave:save});await node.props.onBlur({target:input,currentTarget:input});expect(save).toHaveBeenCalledWith(105);expect(input.value).toBe("10");});
