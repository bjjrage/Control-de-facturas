import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BudgetItem } from '@/lib/types';
import { computeProgressForecast } from '@/lib/procurement/progress-forecast-engine';
import { deriveClimateForecastMetrics } from '@/lib/procurement/climate-metrics';
import { scheduleLeafBudgetItems } from '@/lib/projects/schedule';
import { fetchWeatherForecastRange } from '@/lib/procurement/weather-client';
const mocks=vi.hoisted(()=>({client:vi.fn(),auth:vi.fn(),admin:vi.fn(),weather:vi.fn(),prices:vi.fn()}));
vi.mock('@/lib/supabase/server',()=>({createClient:mocks.client}));
vi.mock('@/lib/supabase/admin',()=>({createAdminClient:mocks.admin}));
vi.mock('@/lib/auth',()=>({requirePlan:mocks.auth}));
vi.mock('next/cache',()=>({revalidatePath:vi.fn()}));
vi.mock('@/lib/costing/project-prices',()=>({resolveProjectMaterialPrices:mocks.prices}));
// Keep weather client real: provider boundary is exercised by a stubbed fetch.
import { runProgressForecastAction } from '@/app/(internal)/projects/progress-forecast-actions';
const item={id:'item',project_id:'project',parent_id:null,code:'1',description:'Wall',unit:'m2',quantity:70,unit_price:10,subtotal:700,start_date:'2026-10-03',end_date:'2026-10-09',depends_on:null,sort_order:1} as BudgetItem;
const days=Array.from({length:7},(_,i)=>({date:`2026-10-${String(3+i).padStart(2,'0')}`,precipitation_sum_mm:0,precipitation_hours:0,precipitation_probability_max:0,wind_gusts_max_kmh:0,weather_code:0}));
function input(){return {project_id:'project',horizon_days:7,start_date:'2026-10-03',budget_items:[item],executed_quantities_by_item:{},materials_by_item:{},stock_and_inbound:{},operational_assessments:{},forecasts:days,llm_used:false};}
function database(failureTable?:string, rpcError?:string){
 const calls:any[]=[]; const rows:Record<string,any>={projects:{id:'project',latitude:0,longitude:0,start_date:'2026-10-03'},budget_items:[item]};
 const db={calls, rpc:vi.fn(async()=>({data:rpcError?null:'run',error:rpcError?{message:rpcError}:null})),from(table:string){let chain:any;chain=new Proxy({}, {get(_t,method:string){if(method==='then') return Promise.resolve({data:rows[table]??[],error:table===failureTable?{message:'broken '+table}:null}).then.bind(Promise.resolve({data:rows[table]??[],error:table===failureTable?{message:'broken '+table}:null}));return (...args:any[])=>{calls.push({table,method,args});return chain;};}});return chain;}};return db;
}
beforeEach(()=>{vi.restoreAllMocks();mocks.auth.mockResolvedValue({id:'actor',empresa_id:'company',active:true,empresa_active:true});mocks.admin.mockReturnValue({});mocks.prices.mockResolvedValue(new Map());vi.stubGlobal('fetch',vi.fn(async()=>{throw new Error('provider unavailable')}));});
describe('Batch07 planning boundaries',()=>{
 it('uses canonical hierarchy, not dot-like codes, when actual parents exist',()=>{expect(scheduleLeafBudgetItems([{id:'a',parent_id:null,code:'x'},{id:'b',parent_id:'a',code:'different'},{id:'c',parent_id:null,code:'different.child'}]).map(x=>x.id)).toEqual(['b','c']);});
 it('does not double count a parent in projections',()=>{const v=input();v.budget_items=[{...item,id:'parent',code:'P'}, {...item,parent_id:'parent'}];expect(computeProgressForecast(v).items.map(x=>x.budget_item_id)).toEqual(['item']);});
 it('partial weather covers only real days',()=>{const v=input();v.forecasts=days.slice(0,2);expect(computeProgressForecast(v).items[0].projected_quantity).toBe(20);});
 it('absent weather produces no assumed sunny production',()=>{const v=input();v.forecasts=[];expect(computeProgressForecast(v).items[0].projected_quantity).toBe(0);});
 it('ignores duplicate/out-of-window forecast days',()=>{const v=input();v.forecasts=[days[0],days[0],{...days[0],date:'2027-01-01'}];expect(computeProgressForecast(v).items[0].projected_quantity).toBe(10);});
 it('unknown predecessor blocks projection',()=>{const v=input();v.budget_items=[{...item,depends_on:'missing'}];expect(computeProgressForecast(v).items[0].projected_quantity).toBe(0);});
 it('no execution before scheduled start',()=>{const v=input();v.budget_items=[{...item,start_date:'2026-10-10',end_date:'2026-10-16'}];expect(computeProgressForecast(v).items[0].projected_quantity).toBe(0);});
 it('inclusive horizon ends on day seven',()=>{expect(computeProgressForecast(input()).end_date).toBe('2026-10-09');});
 it('climate metrics exclude pre-project, future, proposed and duplicate dates',()=>{const result=deriveClimateForecastMetrics({projectStartDate:'2026-10-01',asOfDate:'2026-10-03',budgetItems:[],workdays:['2026-09-30','2026-10-02','2026-10-02','2026-10-04'].map(work_date=>({work_date,classification:'NON_WORKABLE_RAIN',decision_status:'CONFIRMED'}))});expect(result.rain_lost_days).toBe(1);expect(result.effective_available_days).toBe(2);});
 it('rejects invalid calendar days',async()=>{await expect(fetchWeatherForecastRange(0,0,'2026-02-30','2026-03-01')).rejects.toThrow('inválida');});
 it('does not replace missing provider rainfall with zero',async()=>{vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({daily:{time:[new Date().toISOString().slice(0,10)],precipitation_hours:[0],precipitation_probability_max:[0],wind_gusts_10m_max:[0],weathercode:[0]}})})));const day=new Date().toISOString().slice(0,10);await expect(fetchWeatherForecastRange(0,0,day,day)).rejects.toThrow('incompleto');});
 it.each([NaN,Infinity,6,91,7.5])('rejects invalid horizon %s',async(horizonDays)=>{const db=database();mocks.client.mockResolvedValue(db);expect((await runProgressForecastAction({projectId:'project',horizonDays})).error).toContain('Horizonte');expect(db.rpc).not.toHaveBeenCalled();});
 it('keeps zero coordinates, never updates project, and persists atomically',async()=>{const db=database();mocks.client.mockResolvedValue(db);const r=await runProgressForecastAction({projectId:'project',horizonDays:7});expect(r.error).toBeNull();expect(r.data?.id).toBe('run');expect(db.rpc).toHaveBeenCalledWith('execution_save_forecast',expect.any(Object));expect(db.calls.some(c=>['insert','update'].includes(c.method))).toBe(false);expect(db.calls.some(c=>c.table==='execution_entries'&&c.method==='eq'&&c.args[0]==='empresa_id')).toBe(false);});
 it('a failed stock read is not zero availability',async()=>{const db=database('inventory_stock_by_project');mocks.client.mockResolvedValue(db);expect((await runProgressForecastAction({projectId:'project',horizonDays:7})).error).toContain('broken');expect(db.rpc).not.toHaveBeenCalled();});
 it('persistence failure returns error, never success',async()=>{const db=database(undefined,'atomic save rejected');mocks.client.mockResolvedValue(db);expect((await runProgressForecastAction({projectId:'project',horizonDays:7})).error).toContain('atomic save rejected');});
});
