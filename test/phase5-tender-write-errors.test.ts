import {beforeEach,expect,it,vi} from "vitest";
const state=vi.hoisted(()=>({fail:"licitacion_items",audit:vi.fn(),refresh:vi.fn(),ingest:vi.fn(async()=>({data:"process",error:null})),tenantRpc:vi.fn(async()=>({data:null,error:{message:"permission denied for function ingestar_proceso_ocds_global"}}))}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:()=>({rpc:state.ingest})}));
vi.mock("@/lib/auth",()=>({requireProfile:async()=>({id:"u",empresa_id:"e"})}));
vi.mock("next/cache",()=>({revalidatePath:state.refresh}));
vi.mock("@/lib/audit",()=>({logAudit:state.audit}));
vi.mock("@/lib/dncp/client",()=>({normalizarNro:(s:string)=>s,fetchRecord:async()=>({}),DncpNotFoundError:class extends Error{}}));
vi.mock("@/lib/dncp/parse",()=>({parseCompiledRelease:()=>({cabecera:{},notificados:[],lotes:[],items:[{descripcion:"Item"}],oferentes:[],documentos:[]})}));
vi.mock("@/lib/procurement/offer-extractor",()=>({extraerOfertasDeTexto:()=>[{estado_oferta:"GANADORA",requiere_revision_humana:false,oferente_normalizado:{ruc_clean:"123",dv:"1",nombre_canonico:"Proveedor"},monto_ofertado:100}]}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({
 rpc:state.tenantRpc,
 from(table:string){
  let mode="read",columns="";const finish=()=>({data:table==="licitaciones"&&(mode==="write"||columns==="*")?{id:"lic"}:null,error:mode==="write"&&state.fail===table?{message:"db write failed"}:null});
  const q:any={select:(c:string)=>{columns=c;return q},eq:()=>q};for(const m of["insert","upsert","delete"])q[m]=()=>{mode="write";return q};
  q.single=q.maybeSingle=async()=>finish();q.then=(resolve:any)=>Promise.resolve(finish()).then(resolve);return q;
 }
})}));
import {importarLicitacion,extraerOfertasDeActa} from "@/app/(internal)/licitaciones/actions";
beforeEach(()=>{state.fail="licitacion_items";state.audit.mockClear();state.refresh.mockClear();state.ingest.mockClear();state.tenantRpc.mockClear()});
it("#39 DNCP import reports failed child persistence instead of success",async()=>{
 const result=await importarLicitacion("123");
 expect(result.error).toMatch(/incompleta|guardar|sincronizar/i);
 expect(state.ingest).toHaveBeenCalledWith("ingestar_proceso_ocds_global",{p_cr:{},p_fuente:"DNCP_OCDS"});
 expect(state.tenantRpc).not.toHaveBeenCalled();
 expect(state.audit.mock.calls.some(c=>c[1]?.action==="licitacion_importada")).toBe(false);
});
it("#39 extracted bids report a failed persistence instead of counting it as saved",async()=>{
 state.fail="licitacion_oferentes";const result=await extraerOfertasDeActa("lic","Texto de prueba");
 expect(result.error).toBeTruthy();expect(result.ofertasExtraidas).toBeUndefined();
 expect(state.audit.mock.calls.some(c=>c[1]?.action==="tender.bids_extracted_from_acta")).toBe(false);
});
