import { expect, it } from "vitest";
import { postManualInventoryMovement } from "../service";
it("D5 translates an existing opening count rejection for the user",async()=>{
 const db={rpc:async()=>({data:null,error:{message:"Opening count already exists; use a reviewed adjustment for corrections"}})};
 const result=await postManualInventoryMovement(db as never,{movementType:"ADJUSTMENT",empresaId:"tenant",productoId:"product",quantity:1,unit:"un",idempotencyKey:"attempt"} as never);
 expect(result.error).toMatch(/stock inicial.*ajuste/i);expect(result.error).not.toContain("Opening count");
});
