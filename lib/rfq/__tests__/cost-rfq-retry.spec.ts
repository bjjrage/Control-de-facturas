import {afterAll,beforeAll,expect,it,vi} from "vitest";
import {fixture,E,U,V} from "./db-fixture";
import {createCanonicalRfq} from "../service";
import {sourceFunctions} from "../../../test/support/source-functions";
import type {PGlite} from "@electric-sql/pglite";
import {readFileSync} from "node:fs";
const project="50000000-0000-4000-8000-000000000001",product="40000000-0000-4000-8000-000000000001";
let db:PGlite;
beforeAll(async()=>{
 db=await fixture();
 await db.exec(`UPDATE public.empresas SET plan='pro' WHERE id='${E}';
 INSERT INTO public.projects(id,empresa_id,name,code) VALUES('${project}','${E}','QA','QA');
 INSERT INTO public.productos(id,empresa_id,nombre,unidad) VALUES('${product}','${E}','Cemento','unidad');`);
 // Empty before the fix: the behavior test still runs against real rfq_create.
 const sql=readFileSync("supabase/migrations/20261019165649_cost_rfq_retry_idempotency.sql","utf8");
 if(sql.trim())await db.exec(sql);
},60000);
afterAll(async()=>{await db?.close()});
function action(){
 const client:any={
  rpc:async(name:string,args:any)=>{
   try{const result=await db.query<{result:any}>(`SELECT public.${name}($1::jsonb,$2::jsonb,$3::uuid[]) AS result`,[JSON.stringify(args.p_header),JSON.stringify(args.p_items),args.p_provider_ids]);
    return {data:result.rows[0].result,error:null};}catch(e:any){return {data:null,error:{message:e.message}}}
  },
  from(table:string){
   const data=table==="projects"?{id:project,name:"QA"}:table==="categorias_producto"?[{id:"cat",nombre:"Materiales"}]:
    table==="provider_categorias"?[{categoria_id:"cat",provider_id:V,providers:{active:true}}]:
    table==="productos"?[{id:product,nombre:"Cemento",unidad:"unidad",categoria_id:"cat"}]:[];
   const q:any={select:()=>q,eq:()=>q,in:()=>q,maybeSingle:async()=>({data,error:null}),then:(resolve:any)=>Promise.resolve({data,error:null}).then(resolve)};return q;
  },
 };
 return sourceFunctions("app/(internal)/projects/[id]/costeo-actions.ts",["createCostRfqsFromProject"],{
  requirePlan:async()=>({id:U,empresa_id:E}),createClient:async()=>client,createAdminClient:()=>client,
  DEFAULT_RFQ_WINDOW_HOURS:72,explodeMaterialNeeds:()=>[{productoId:product}],
  groupNeedsByRubro:()=>({sinRubro:[],rubros:[{categoriaId:"cat",items:[{productoId:product,nombre:"Cemento",cantidad:2,unidad:"unidad"}]}]}),
  createCanonicalRfq,revalidatePath:vi.fn(),
 }).createCostRfqsFromProject;
}
it("#25 repeating the real cost action returns the same RFQ rather than creating another",async()=>{
 const run=action(),a=await run(project),b=await run(project);
 expect(a.error).toBeNull();expect(b.error).toBeNull();expect(b.data.creadas[0].rfqId).toBe(a.data.creadas[0].rfqId);
 expect((await db.query<{n:number}>("SELECT count(*)::int n FROM public.rfqs")).rows[0].n).toBe(1);
},60000);
it("#25 changing the payload creates a distinct request and foreign projects are denied",async()=>{
 const header={purpose:"COST_DISCOVERY",project_id:project,product:"Materiales",deduplicate_cost_request:true};
 const changed=await createCanonicalRfq({rpc:async(name:string,args:any)=>{
  const r=await db.query<{result:any}>(`SELECT public.${name}($1::jsonb,$2::jsonb,$3::uuid[]) result`,[JSON.stringify(args.p_header),JSON.stringify(args.p_items),args.p_provider_ids]);
  return {data:r.rows[0].result,error:null};
 }} as never,header,[{producto_id:product,descripcion:"Cemento",cantidad:3,unidad:"unidad"}],[V]);
 expect(changed.reused).toBe(false);
 await expect(db.query("SELECT public.rfq_create_cost_once($1::jsonb,$2::jsonb,$3::uuid[])",[
  JSON.stringify({...header,project_id:"50000000-0000-4000-8000-000000000099"}),JSON.stringify([{descripcion:"X",cantidad:1,unidad:"un"}]),[V],
 ])).rejects.toThrow(/Obra/);
});
it("#25 RPC permissions are restricted and search_path is fixed",async()=>{
 const row=(await db.query<any>(`SELECT prosecdef,proconfig,
 has_function_privilege('anon',oid,'EXECUTE') anon,
 has_function_privilege('authenticated',oid,'EXECUTE') authenticated,
 has_function_privilege('service_role',oid,'EXECUTE') service
 FROM pg_proc WHERE proname='rfq_create_cost_once'`)).rows[0];
 expect(row).toMatchObject({prosecdef:false,anon:false,authenticated:true,service:false});
 expect(row.proconfig).toContain('search_path=""');
});
