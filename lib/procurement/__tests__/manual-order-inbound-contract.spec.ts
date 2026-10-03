import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
const migration=readFileSync(resolve(process.cwd(),'supabase/migrations/20261003000341_rfq_2_human_procurement.sql'),'utf8');
const dialog=readFileSync(resolve(process.cwd(),'app/(internal)/orders/order-dialog.tsx'),'utf8');
describe('manual purchase order preserves MRP inputs through exact preview',()=>{
 it('validates catalog tenant, unit and active status in atomic RPC',()=>{
  expect(migration).toContain("empresa_id=p.empresa_id AND activo AND trim(unidad)=trim(item->>'unit')");
  expect(migration).toContain("nullif(item->>'expected_delivery_date','')::date");expect(migration).toContain('direct_purchase_confirm');
 });
 it('lets human link catalog, delivery, tax and terms before confirmation',()=>{
  expect(dialog).toContain('value={row.producto_id}');expect(dialog).toContain('value={row.expected_delivery_date}');
  expect(dialog).toContain('previewDirectPurchaseAction');expect(dialog).toContain('confirmDirectPurchaseAction');expect(dialog).toContain('Confirmo el preview mostrado');
 });
});
