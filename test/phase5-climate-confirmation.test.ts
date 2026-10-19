import {expect,it} from "vitest";
import {sourceFunctions} from "./support/source-functions";
it("#26 an external weather refresh cannot overwrite a confirmation made after its read",async()=>{
 const event:any={id:"event",status:"PROPOSED",source:"DMH"};
 const db={from:()=>({update:(patch:any)=>({eq:()=>({select:()=>({single:async()=>{
  event.status="CONFIRMED";Object.assign(event,patch);return {data:event,error:null};
 }})})})})};
 const {persistEvent}=sourceFunctions("lib/procurement/climate-workdays.ts",[
  "exceedsContractThreshold","externalClimateMeasurementPatch","eventPatch","externalMeasurementChanged","persistEvent",
 ]);
 await persistEvent(db,{id:"p"},{date:"2026-10-01",precipitation_mm:25,source:"DMH"},15,{...event});
 expect(event.status).toBe("CONFIRMED");
});
