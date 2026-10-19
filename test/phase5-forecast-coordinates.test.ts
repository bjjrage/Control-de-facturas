import { expect,it,vi } from "vitest";
import { sourceFunctions } from "./support/source-functions";
const base="app/(internal)/";
function find(n:any,predicate:(n:any)=>boolean):any{
 if(!n||typeof n!=="object")return null;if(predicate(n))return n;
 for(const c of[n.props?.children].flat(Infinity)){const found=find(c,predicate);if(found)return found;}return null;
}
it("#36 empty forecast coordinates are rejected before requesting a forecast",async()=>{
 const action=vi.fn(async()=>({data:{},error:null})),setErrorMsg=vi.fn();let pending:Promise<unknown>|undefined;
 const {handleRunForecast}=sourceFunctions(base+"projects/[id]/progress-forecast-section.tsx",["handleRunForecast"],{
  latitude:"",longitude:"",setErrorMsg,setShowLocationModal:vi.fn(),project:{id:"p"},activeDays:7,setForecastResult:vi.fn(),
  startTransition:(fn:()=>Promise<unknown>)=>{pending=fn()},runProgressForecastAction:action,
 });
 handleRunForecast();await pending;expect(action).not.toHaveBeenCalled();expect(setErrorMsg).toHaveBeenCalledWith(expect.stringMatching(/coordenadas/i));
});

