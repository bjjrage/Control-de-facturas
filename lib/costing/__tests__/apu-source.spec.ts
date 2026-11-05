import { describe,expect,it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {readApuRows,sourceMaterialPrices} from "../apu-source";
import {computePartidaCosts} from "../cost-budget";

describe("complete workbook recipes",()=>{
  it("reads all 2199 BOM links even when the API caps pages at 123",async()=>{
    const source=Array.from({length:2199},(_,id)=>({id}));
    const query={select:()=>query,eq:()=>query,order:()=>query,range:async(from:number,to:number)=>({data:source.slice(from,Math.min(to+1,from+123)),count:source.length,error:null})};
    const result=await readApuRows({from:()=>query} as unknown as SupabaseClient,"budget_item_materials","id","project","company");
    expect(result.error).toBeNull();expect(result.data).toEqual(source);
  });
  it("keeps different source prices per recipe and gives actual prices priority",()=>{
    const materials=[{budgetItemId:"a",productoId:"p",cantidadPorUnidad:2,desperdicioPct:0,precioOrigen:5},{budgetItemId:"b",productoId:"p",cantidadPorUnidad:3,desperdicioPct:0,precioOrigen:7}];
    const lines={materials,labor:[],equipment:[],subcontracts:[]};
    expect(sourceMaterialPrices([{producto_id:"p",precio_unitario_origen:5},{producto_id:"p",precio_unitario_origen:7}]).get("p")).toBeNull();
    let cost=computePartidaCosts([{id:"a",quantity:4,unitPrice:30},{id:"b",quantity:1,unitPrice:30}],lines,new Map());
    expect(cost.a.costoTotal).toBe(40);expect(cost.b.costoTotal).toBe(21);
    cost=computePartidaCosts([],lines,new Map([["p",{precio:10,fuente:"FACTURA"}]]));
    expect(cost.a.costoUnitario).toBe(20);expect(cost.b.costoUnitario).toBe(30);
  });
  it("preserves an explicit zero price, but missing price remains unavailable",()=>{
    const cost=computePartidaCosts([],{materials:[{budgetItemId:"free",productoId:"p",cantidadPorUnidad:1,desperdicioPct:0,precioOrigen:0},{budgetItemId:"missing",productoId:"p",cantidadPorUnidad:1,desperdicioPct:0}],labor:[],equipment:[],subcontracts:[]},new Map());
    expect(cost.free.costoUnitario).toBe(0);expect(cost.missing.costoUnitario).toBeNull();
  });
});
