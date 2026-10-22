import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fixture, E, V, V2 } from './db-fixture';

describe('RFQ selection metadata uses comparable basket totals', () => {
  let db: PGlite;
  const call = async (name: string, args: unknown[]) => {
    const r = await db.query<{result: Record<string, unknown>}>(`SELECT public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) AS result`, args);
    return r.rows[0].result;
  };
  beforeAll(async () => {
    db = await fixture();
    await db.exec(readFileSync('supabase/migrations/20261022023248_beta_rfq_order_selection_metadata.sql','utf8'));
  },60000);
  afterAll(async()=>{await db?.close();});
  async function order(options: {selectedPrice:number; selectedFreight:number; otherPrice:number; otherFreight:number; otherCurrency?:string; otherAvailable?:number}) {
    const r = await call('rfq_create',[JSON.stringify({purpose:'PROCUREMENT',product:'Beta metadata'}),JSON.stringify([{descripcion:'A',cantidad:10,unidad:'un'}]),[V,V2]]);
    const rfq = r.id as string;
    const item = (await db.query<{id:string}>('SELECT id FROM public.rfq_items WHERE rfq_id=$1',[rfq])).rows[0].id;
    const links = (await db.query<{id:string;token:string;provider_id:string}>('SELECT id,token,provider_id FROM public.rfq_providers WHERE rfq_id=$1',[rfq])).rows;
    let chosen = '';
    for(const link of links){
      const selected=link.provider_id===V;
      const attachment=(await db.query<{id:string}>(`INSERT INTO public.attachments(empresa_id,bucket,path,file_name,rfq_provider_id) VALUES($1,'quote-pdfs',gen_random_uuid()::text,'original.pdf',$2) RETURNING id`,[E,link.id])).rows[0].id;
      const q=await call('rfq_submit_version',[link.token,JSON.stringify({budget_number:'BETA',currency:selected?'PYG':options.otherCurrency??'PYG',vat_included:false,invoice_available:true,valid_until:'2099-01-01T00:00:00Z',freight:selected?options.selectedFreight:options.otherFreight,payment_terms:'30 days'}),JSON.stringify([{rfq_item_id:item,precio_unitario:selected?options.selectedPrice:options.otherPrice,available_quantity:selected?10:options.otherAvailable??10,tax_rate:10,lead_time_days:5}]),attachment,null]);
      await call('rfq_review_quote',[q.versionId,'{}','{}','Revisado contra documento original']);
      if(selected) chosen=(await db.query<{id:string}>('SELECT id FROM public.quote_version_items WHERE quote_version_id=$1',[q.versionId])).rows[0].id;
    }
    const a=await call('rfq_save_allocation',[rfq,JSON.stringify([{quote_version_item_id:chosen,quantity:10}]),'Precio conveniente',0]);
    await call('rfq_authorize_allocation',[a.id,true]);
    const preview=await call('rfq_preview_orders',[a.id]);
    const confirmed=await call('rfq_confirm_orders',[a.id,preview.hash,true]);
    expect(confirmed.orderIds).toHaveLength(1);
    return (await db.query<{is_cheapest:boolean;selection_reason:string|null;selection_reason_detail:string}>(`SELECT is_cheapest,selection_reason,selection_reason_detail FROM public.authorized_orders WHERE rfq_id=$1`,[rfq])).rows[0];
  }
  it('marks lowest total and retains the human justification',async()=>{
    expect(await order({selectedPrice:90,selectedFreight:20,otherPrice:100,otherFreight:20})).toEqual({is_cheapest:true,selection_reason:null,selection_reason_detail:'Precio conveniente'});
  });
  it('does not mark cheaper unit price if freight makes the basket more expensive',async()=>{
    expect((await order({selectedPrice:90,selectedFreight:500,otherPrice:100,otherFreight:0})).is_cheapest).toBe(false);
  });
  it('ignores an offer in another currency',async()=>{
    expect((await order({selectedPrice:100,selectedFreight:20,otherPrice:1,otherFreight:0,otherCurrency:'USD'})).is_cheapest).toBe(true);
  });
  it('ignores an offer that cannot supply the basket quantity',async()=>{
    expect((await order({selectedPrice:100,selectedFreight:20,otherPrice:1,otherFreight:0,otherAvailable:1})).is_cheapest).toBe(true);
  });
});
