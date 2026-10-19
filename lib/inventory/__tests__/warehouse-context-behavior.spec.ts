import { expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  from(table: string) {
    let statuses: string[] | null = null;
    const rows: Record<string, unknown[]> = {
      warehouse_portal_links: [{ empresa_id:"tenant", location_id:"location",active:true,expires_at:"2099-01-01" }],
      inventory_locations: [{ id:"location",name:"Depósito",project_id:"project",location_type:"PROJECT",active:true }],
      projects: [{id:"project",name:"QA",code:"QA"}],
      authorized_orders: [{ id:"order",code:"OC",providers:{name:"QA"},authorized_order_items:[{id:"item",producto_id:"product",product:"Cemento",unit:"bolsa",quantity:10,productos:{nombre:"Cemento"}}] }],
      oc_recepcion_items: [
        {order_item_id:"item",cantidad_recibida:4,oc_recepciones:{status:"DRAFT"}},
        {order_item_id:"item",cantidad_recibida:2,oc_recepciones:{status:"CONFIRMED"}},
      ],
      inventory_stock_by_location: [{producto_id:"product",producto:"Cemento",unidad:"bolsa",quantity:3},{producto_id:"product",producto:"Cemento",unidad:"bolsa",quantity:4}],
      productos: [], budget_items: [],
    };
    const result=()=>({data:(rows[table]??[]).filter((row:any)=>table!=="oc_recepcion_items" || !statuses || statuses.includes(row.oc_recepciones.status)),error:null});
    const q:any={select:()=>q,eq:(col:string,value:string)=>{if(col==="oc_recepciones.status")statuses=[value];return q},
      in:(col:string,values:string[])=>{if(col==="oc_recepciones.status")statuses=values;return q},order:()=>q,limit:()=>q,
      maybeSingle:async()=>({data:rows[table]?.[0]??null,error:null}),then:(resolve:any)=>Promise.resolve(result()).then(resolve)};
    return q;
  },
}) }));
import { getWarehousePortalContext } from "../warehouse-portal-data";
it("D4 abandoned drafts do not reduce the order pending quantity",async()=>{
  const context=await getWarehousePortalContext("token");
  expect(context?.orders[0].items[0]).toMatchObject({ordered:10,received:2,pending:8});
});
it("#17 portal context sums every currency balance for one product",async()=>{
  const context=await getWarehousePortalContext("token");
  expect(context?.stock).toEqual([{productId:"product",productName:"Cemento",unit:"bolsa",quantity:7}]);
});
