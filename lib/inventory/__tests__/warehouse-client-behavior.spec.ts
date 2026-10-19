import { beforeEach, expect, it, vi } from "vitest";
const hooks=vi.hoisted(()=>({tab:"consumption",index:0,refs:[] as Array<{current:any}>,setters:[] as ReturnType<typeof vi.fn>[]}));
vi.mock("react",async importOriginal=>{
 const actual=await importOriginal<typeof import("react")>();
 return {...actual,useState:(initial:any)=>{
   const i=hooks.index++,setter=vi.fn();hooks.setters[i]=setter;
   return [i===0?hooks.tab:i===7?"1":i===8?"budget":initial,setter];
 },useRef:(initial:any)=>{const ref={current:initial};hooks.refs.push(ref);return ref;}};
});
import { WarehousePortalClient } from "@/app/warehouse/[token]/warehouse-portal-client";
const context:any={token:"token",locationName:"QA",projectName:"QA",projectCode:"QA",orders:[],
 stock:[{productId:"product",productName:"Cemento",unit:"bolsa",quantity:10}],allProducts:[{id:"product",name:"Cemento",unit:"bolsa"}],budgetItems:[{id:"budget",code:"1",description:"QA",unit:"bolsa"}]};
function findForm(node:any):any{
 if(!node||typeof node!=="object")return null;
 if(node.type==="form")return node;
 for(const child of [node.props?.children].flat(Infinity)){const found=findForm(child);if(found)return found;}
 return null;
}
let values:Map<string,string>;
beforeEach(()=>{
 hooks.tab="consumption";hooks.index=0;hooks.refs=[];hooks.setters=[];values=new Map();
 vi.stubGlobal("localStorage",{getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>values.set(k,v),removeItem:(k:string)=>values.delete(k)});
 const Original=globalThis.FormData;
 // The handler receives the form's values; no DOM shim or helper substitution.
 vi.stubGlobal("FormData",class extends Original{constructor(_form?:unknown){super();}});
});
async function submit(){const form=findForm(WarehousePortalClient({context}));const reset=vi.fn();await form.props.onSubmit({preventDefault:vi.fn(),currentTarget:{},target:{reset}});return reset;}
it("D6 keeps the consumption key after a 503 so retry cannot post twice",async()=>{
 vi.stubGlobal("fetch",vi.fn().mockResolvedValue({ok:false,status:503,json:async()=>({error:"Respuesta incierta"})}));
 await submit();expect(values.get("warehouse-consumption:token")).toBeTruthy();expect(hooks.refs[1].current).not.toBeNull();
});
it("#13 clears a rejected 400 but retains an unknown network result",async()=>{
 vi.stubGlobal("fetch",vi.fn().mockResolvedValue({ok:false,status:400,json:async()=>({error:"Falta partida"})}));
 await submit();expect(values.has("warehouse-consumption:token")).toBe(false);
 hooks.index=0;hooks.refs=[];vi.stubGlobal("fetch",vi.fn().mockRejectedValue(new Error("connection lost")));
 await submit();expect(values.has("warehouse-consumption:token")).toBe(true);
});
it("#14 does not reset a submission form or show success for HTTP 207",async()=>{
 hooks.tab="submission";vi.stubGlobal("fetch",vi.fn().mockResolvedValue({ok:true,status:207,json:async()=>({ok:true,partial:true,uploaded:1,total:2})}));
 const reset=await submit();expect(reset).not.toHaveBeenCalled();
 expect(hooks.setters[16]).not.toHaveBeenCalledWith(expect.any(String));
 expect(hooks.setters[15]).toHaveBeenCalledWith(expect.stringMatching(/parcial/i));
});
