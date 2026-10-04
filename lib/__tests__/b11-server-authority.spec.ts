import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks=vi.hoisted(()=>({ user: {id:"authorized-local"} as {id:string}|null, profile: null as Record<string,unknown>|null, climate:vi.fn().mockResolvedValue({processed:0}), tender:vi.fn().mockResolvedValue({processed:0}), admin:vi.fn().mockReturnValue({}), scan:vi.fn() }));
vi.mock("react",()=>({cache:(fn:unknown)=>fn}));
vi.mock("next/navigation",()=>({redirect:(path:string)=>{throw new Error(`redirect:${path}`)},notFound:()=>{throw new Error("not-found")}}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({auth:{getUser:async()=>({data:{user:mocks.user}})},from:()=>({select:()=>({eq:()=>({single:async()=>({data:mocks.profile})})})})})}));
vi.mock("@supabase/ssr",()=>({createServerClient:()=>({auth:{getUser:async()=>({data:{user:null}})}})}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:mocks.admin}));
vi.mock("@/lib/procurement/climate-evaluation-runner",()=>({runClimateEvaluationBatch:mocks.climate}));
vi.mock("@/lib/procurement/tender-monitoring-runner",()=>({runTenderMonitoringBatch:mocks.tender}));
vi.mock("@/lib/scanner/session-service",()=>({createScanSession:mocks.scan}));
import { POST as scanPOST } from "@/app/api/scanner/session/route";
import { GET as scanGET } from "@/app/api/scanner/status/[id]/route";
import { requireProfile,requireModule,requirePlan,requireSuperAdmin } from "@/lib/auth";
import { proxy } from "@/proxy";
import { GET as climateGET } from "@/app/api/cron/climate-evaluation/route";
import { GET as tenderGET } from "@/app/api/cron/tender-monitoring/route";
function profile(overrides:Record<string,unknown>={}) {mocks.profile={id:"authorized-local",empresa_id:"local-tenant",role:"admin",active:true,is_super_admin:false,empresas:{active:true,modulo_compras:true,modulo_ventas:true,plan:"pro"},...overrides};}
afterEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks();mocks.user={id:"authorized-local"};mocks.profile=null;});
describe("B11 server authority boundaries",()=>{
 it.each([()=>requireProfile(),()=>requireModule("ventas"),()=>requirePlan("pro"),()=>requireSuperAdmin()])("inactive profile denied across shared entry points",async action=>{profile({active:false,is_super_admin:true});await expect(action()).rejects.toThrow("redirect:/suspendido");});
 it("active own profile allowed",async()=>{profile();expect((await requireProfile(["admin"])).id).toBe("authorized-local");});
 it("missing company fails closed",async()=>{profile({empresas:null});await expect(requireProfile()).rejects.toThrow("redirect:/suspendido");});
 it("active superadmin keeps existing company exception",async()=>{profile({is_super_admin:true,empresas:{active:false}});expect((await requireSuperAdmin()).is_super_admin).toBe(true);});
 it("unauthenticated request denied",async()=>{mocks.user=null;await expect(requireProfile()).rejects.toThrow("redirect:/login");});
});
describe("B11 cron proxy → existing secret authority (mocked runners)",()=>{
 it.each([["climate-evaluation",climateGET,mocks.climate],["tender-monitoring",tenderGET,mocks.tender]] as const)("%s works with authorized secret and no session",async(path,handler,runner)=>{
   vi.stubEnv("CRON_SECRET","local-test-secret");const req=new NextRequest(`https://local.invalid/api/cron/${path}`,{headers:{authorization:"Bearer local-test-secret"}});
   expect((await proxy(req)).status).toBe(200);expect((await handler(req)).status).toBe(200);expect(runner).toHaveBeenCalledOnce();
 });
 it.each([["climate-evaluation",climateGET],["tender-monitoring",tenderGET]] as const)("%s denies absent/wrong secret before privileged client",async(path,handler)=>{
   vi.stubEnv("CRON_SECRET","local-test-secret");for(const headers of [new Headers(),new Headers({authorization:"Bearer wrong"})]){const req=new NextRequest(`https://local.invalid/api/cron/${path}`,{headers});expect((await proxy(req)).status).toBe(200);expect((await handler(req)).status).toBe(401);}
   expect(mocks.admin).not.toHaveBeenCalled();
   vi.stubEnv("CRON_SECRET","");expect((await handler(new NextRequest(`https://local.invalid/api/cron/${path}`))).status).toBe(500);expect(mocks.admin).not.toHaveBeenCalled();
 });
 it.each(["/api/cron/unknown","/api/cron/climate-evaluation/extra","/api/agent/chat","/dashboard"])("%s retains session boundary",async path=>{vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL","https://local.invalid");vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY","local");expect((await proxy(new NextRequest(`https://local.invalid${path}`))).headers.get("location")).toBe("https://local.invalid/login");});
});

describe('B11 scanner privileged session boundary',()=>{
 it.each([{active:false},{empresas:{active:false}}])('inactive actor/company denied before scanner or admin work',async overrides=>{
   profile(overrides);const req=new NextRequest('https://local.invalid/api/scanner/session',{method:'POST',body:'{}'});
   expect((await scanPOST(req)).status).toBe(401);
   expect((await scanGET(new NextRequest('https://local.invalid/api/scanner/status/local'),{params:Promise.resolve({id:'local'})})).status).toBe(401);
   expect(mocks.scan).not.toHaveBeenCalled();expect(mocks.admin).not.toHaveBeenCalled();
 });
});
