import { afterEach,beforeEach,expect,it,vi } from "vitest";
import { NextRequest } from "next/server";
const batch=vi.hoisted(()=>vi.fn(async()=>({results:[],failures:[]})));
vi.mock("@/lib/procurement/climate-evaluation-runner",()=>({runClimateEvaluationBatch:batch}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:()=>({})}));
import { GET } from "@/app/api/cron/climate-evaluation/route";
beforeEach(()=>{vi.stubEnv("CRON_SECRET","qa-secret");vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-20T01:00:00Z"));batch.mockClear()});
afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs()});
function request(query=""){return GET(new NextRequest("http://localhost/api/cron/climate-evaluation"+query,{headers:{authorization:"Bearer qa-secret"}}));}
it("#27 cron defaults to Paraguay date around UTC midnight",async()=>{
 await request();expect(batch.mock.calls[0][1]).toMatchObject({date:"2026-10-19"});
});
it.each(["2026-10-20","2026-02-30"])("#27 rejects future or invalid calendar date %s",async date=>{
 expect((await request("?date="+date)).status).toBe(400);expect(batch).not.toHaveBeenCalled();
});
