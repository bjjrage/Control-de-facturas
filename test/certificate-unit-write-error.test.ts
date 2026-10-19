import {expect,it,vi} from "vitest";
import {sourceFunctions} from "./support/source-functions";
it("#33 reports a rejected unit-progress write instead of success",async()=>{
 const upsert=vi.fn(async()=>({error:{message:"database rejected progress"}}));const refresh=vi.fn();
 const {upsertCertificateUnitProgress}=sourceFunctions("app/(internal)/projects/certificado-actions.ts",["upsertCertificateUnitProgress"],{
  requirePlan:async()=>({empresa_id:"e"}),createClient:async()=>({from:()=>({upsert})}),
  loadOwnedCertificate:async()=>({status:"BORRADOR",project_id:"p"}),revalidatePath:refresh,
 });
 const result=await upsertCertificateUnitProgress("c",[{unit_id:"u",pct_avance:25}]);
 expect(result.error).toContain("guardar el avance");expect(refresh).not.toHaveBeenCalled();
});
it("#33 rejects non-finite percentages before writing any row",async()=>{
 const upsert=vi.fn();const {upsertCertificateUnitProgress}=sourceFunctions("app/(internal)/projects/certificado-actions.ts",["upsertCertificateUnitProgress"],{
  requirePlan:async()=>({empresa_id:"e"}),createClient:async()=>({from:()=>({upsert})}),
  loadOwnedCertificate:async()=>({status:"BORRADOR",project_id:"p"}),revalidatePath:vi.fn(),
 });
 const r=await upsertCertificateUnitProgress("c",[{unit_id:"u",pct_avance:NaN}]);
 expect(r.error).toBeTruthy();expect(upsert).not.toHaveBeenCalled();
});
