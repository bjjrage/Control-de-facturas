import {expect,it,vi} from "vitest";
const state=vi.hoisted(()=>({error:null as any,data:{result:{inserted:1,updated:0,deleted:0}} as any}));
vi.mock("@/lib/planillas/service",()=>({
 PlanillaNotFoundError:class extends Error{},
 confirmarPlanilla:async()=>{
  const {computoPresupuestoAdapter}=await import("@/lib/planillas/adapters/computo-presupuesto");
  return {alreadyConfirmed:false,result:await computoPresupuestoAdapter.aplicarCambios({rpc:async()=>state} as never,"planilla",{rows:[]},{projectId:"p"})};
 },
}));
import {POST} from "@/app/api/planillas/[id]/confirmar/route";
import {NextRequest} from "next/server";
it.each(["08006",null])("unknown planilla confirmation %s returns 503 rather than a definite 400",async code=>{
 state.data=null;state.error=code?{code,message:"private connection error"}:null;
 const result=await POST(new NextRequest("http://localhost/api/planillas/p/confirmar"),{params:Promise.resolve({id:"p"})});
 expect(result.status).toBe(503);expect(JSON.stringify(await result.json())).not.toContain("private connection");
});
