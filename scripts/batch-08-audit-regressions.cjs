// Called by the Preview-pinned B08 suite; all corrective fixtures roll back.
const assert = require('node:assert/strict');
const { calculateWeeklyPlanRequirements } = require('../lib/procurement/weekly-plan-engine.ts');
const { computeBaselineWithDeltas } = require('../lib/procurement/weekly-plan-shared.ts');

module.exports = async function auditRegressions(c, { company, actor, provider, product, claim, pass, reject }) {
  await c.query('BEGIN');
  try {
    for (const scenario of [
      { name: 'certificate only', certificate: true, delta: false, expected: 20 },
      { name: 'certificate plus later delta', certificate: true, delta: true, expected: 15 },
      { name: 'no certificate', certificate: false, delta: true, expected: 15 },
      { name: 'ordered multi-front', certificate: true, delta: true, expected: 15, multi: true },
    ]) {
      await c.query('RESET ROLE');
      const pid = (await c.query("insert into public.projects(empresa_id,name,code,start_date) values($1,'B08 audit parity',gen_random_uuid()::text,'2026-09-01') returning id", [company])).rows[0].id;
      const b = (await c.query("insert into public.budget_items(project_id,code,description,unit,quantity,unit_price,material_requirement) values($1,'1','parity','un',100,10,'NO_MATERIAL') returning *", [pid])).rows[0];
      let cert = null;
      if (scenario.certificate) {
        cert = (await c.query("insert into public.project_certificates(project_id,numero,period_start,period_end,created_by) values($1,1,'2026-09-01','2026-09-30',$2) returning id,period_end::text", [pid, actor])).rows[0];
        await c.query("insert into public.project_certificate_items(certificate_id,budget_item_id,codigo,descripcion,unidad,qty_contractual,qty_anterior,qty_presente) values($1,$2,'1','parity','un',100,75,5)", [cert.id, b.id]);
      }
      await c.query("insert into public.execution_entries(project_id,budget_item_id,entry_date,quantity_executed,recorded_by) values($1,$2,'2026-09-29',$4,$3),($1,$2,'2026-09-30',$5,$3)", [pid, b.id, actor, scenario.certificate ? 7 : 75, scenario.certificate ? 3 : 5]);
      if (scenario.delta) await c.query("insert into public.execution_entries(project_id,budget_item_id,entry_date,quantity_executed,recorded_by) values($1,$2,'2026-10-01',5,$3)", [pid, b.id, actor]);
      const certificateItems = cert ? (await c.query('select *,qty_acumulada::float8 from public.project_certificate_items where certificate_id=$1', [cert.id])).rows : [];
      const executionEntries = (await c.query('select budget_item_id,entry_date::text,quantity_executed::float8 from public.execution_entries where project_id=$1', [pid])).rows;
      const progress = computeBaselineWithDeltas({ budgetItems: [b], baselineCertificate: cert, certificateItems, executionEntries });
      assert.equal(progress.executedQuantities[b.id], 100 - scenario.expected);
      const targets = (scenario.multi ? [12, 30] : [30]).map((input_value, i) => ({ budget_item_id: b.id, front_label: String(i), input_mode: 'QUANTITY', input_value, unit: 'un' }));
      const engine = calculateWeeklyPlanRequirements({ project_id: pid, start_date: '2026-10-05', end_date: '2026-10-11', budget_items: [b], targets, executed_quantities_by_item: progress.executedQuantities, materials_by_item: {}, stock_and_inbound: {} });
      await claim(c, 'authenticated', actor);
      const save = async () => (await c.query("select public.save_weekly_plan_atomic(NULL,$1,'2026-10-05','2026-10-11','DRAFT',NULL,$2::jsonb,NULL) r", [pid, JSON.stringify(targets)])).rows[0].r.plan_id;
      const plan = await save();
      const persisted = (await c.query('select target_quantity::float8 from public.project_weekly_plan_items where plan_id=$1 order by position', [plan])).rows.map(r => r.target_quantity);
      assert.deepEqual(persisted, engine.items.map(i => i.target_quantity));
      assert.equal(persisted.reduce((a, b) => a + b, 0), scenario.expected);
      if (scenario.multi) assert.deepEqual(persisted, [12, 3]);
      pass('engine / DB certificate capping parity: ' + scenario.name);
      assert.equal(await save(), plan);
      assert.deepEqual((await c.query('select target_quantity::float8 from public.project_weekly_plan_items where plan_id=$1 order by position', [plan])).rows.map(r => r.target_quantity), persisted);
      pass('capping retry retains identity and targets: ' + scenario.name);
    }

    await c.query('RESET ROLE');
    const pid = (await c.query("insert into public.projects(empresa_id,name,code,start_date) values($1,'B08 RFQ residual',gen_random_uuid()::text,current_date) returning id", [company])).rows[0].id;
    const b = (await c.query("insert into public.budget_items(project_id,code,description,unit,quantity,unit_price,material_requirement) values($1,'1','RFQ residual','un',100,10,'REQUIRES_BOM') returning id", [pid])).rows[0].id;
    await c.query('insert into public.budget_item_materials(empresa_id,project_id,budget_item_id,producto_id,cantidad_por_unidad_ejecutada,desperdicio_pct) values($1,$2,$3,$4,1,0)', [company,pid,b,product]);
    await claim(c,'authenticated',actor);
    const plan = (await c.query("select public.save_weekly_plan_atomic(NULL,$1,'2026-10-05','2026-10-11','DRAFT',NULL,$2::jsonb,NULL) r", [pid,JSON.stringify([{budget_item_id:b,input_mode:'QUANTITY',input_value:10,unit:'un'}])])).rows[0].r.plan_id;
    const refresh = async (qty) => {
      await claim(c,'authenticated',actor);
      const src = (await c.query('select public.weekly_plan_need_sources($1) r',[plan])).rows[0].r;
      await claim(c,'service_role',actor);
      const r = (await c.query("select public.weekly_plan_refresh_needs($1,$2,$3,'2026-10-11',$4::jsonb,'{}') r",[actor,plan,src.hash,JSON.stringify([{producto_id:product,comprar:qty}])])).rows[0].r;
      await claim(c,'authenticated',actor);return r;
    };
    const quote = async n => (await c.query("select public.weekly_plan_need_rfq($1,$2,$3,'{}','{}') r",[plan,n.snapshot_id,[n.needs[0].id]])).rows[0].r;
    let need = await refresh(10); const a = await quote(need); const needId = need.needs[0].id;
    assert.equal((await c.query('select purpose from public.rfqs where id=$1',[a.id])).rows[0].purpose,'PROCUREMENT');
    const decisionBefore = (await c.query('select * from public.weekly_plan_need_decisions where rfq_id=$1',[a.id])).rows[0];
    // A factual source edit while RFQ is open must retain its active decision.
    await c.query('update public.budget_items set unit_price=11 where id=$1',[b]);
    need = await refresh(10); assert.equal(need.needs[0].decision.rfq_id,a.id);assert.equal((await quote(need)).id,a.id);pass('open RFQ survives changed sources without duplicate procurement');
    await c.query('select public.rfq_invite($1,$2)',[a.id,[provider]]);
    const invitation=(await c.query('select id,token from public.rfq_providers where rfq_id=$1',[a.id])).rows[0];
    const item=(await c.query('select id from public.rfq_items where rfq_id=$1',[a.id])).rows[0].id;
    const attachment=(await c.query("insert into public.attachments(empresa_id,bucket,path,file_name,rfq_provider_id) values($1,'quote-pdfs',gen_random_uuid()::text,'audit-synthetic.pdf',$2) returning id",[company,invitation.id])).rows[0].id;
    await claim(c,'service_role',actor);
    const submission=(await c.query('select public.rfq_submit_version($1,$2::jsonb,$3::jsonb,$4,NULL) r',[invitation.token,JSON.stringify({budget_number:'Audit',currency:'PYG',vat_included:false,invoice_available:true,valid_until:'2099-01-01',freight:0,payment_terms:'cash'}),JSON.stringify([{rfq_item_id:item,precio_unitario:10,available_quantity:10,tax_rate:0,lead_time_days:1}]),attachment])).rows[0].r;
    await claim(c,'authenticated',actor);
    await c.query("select public.rfq_review_quote($1,'{}','{}','Reviewed synthetic evidence')",[submission.versionId]);
    const vi=(await c.query('select id from public.quote_version_items where quote_version_id=$1',[submission.versionId])).rows[0].id;
    const alloc=(await c.query("select public.rfq_save_allocation($1,$2::jsonb,'Human partial allocation',0) r",[a.id,JSON.stringify([{quote_version_item_id:vi,quantity:6}])])).rows[0].r;
    await c.query('select public.rfq_authorize_allocation($1,true)',[alloc.id]);
    const preview=(await c.query('select public.rfq_preview_orders($1) r',[alloc.id])).rows[0].r;
    await reject(()=>c.query('select public.rfq_confirm_orders($1,$2,false)',[alloc.id,preview.hash]),'RFQ order still requires human confirmation');
    const orders=(await c.query('select public.rfq_confirm_orders($1,$2,true) r',[alloc.id,preview.hash])).rows[0].r;
    assert.equal(orders.orderIds.length,1);
    assert.equal((await c.query('select public.rfq_confirm_orders($1,$2,true) r',[alloc.id,preview.hash])).rows[0].r.alreadyConfirmed,true);pass('canonical partial RFQ authorization and confirm are exactly once');
    const inbound=(await c.query("select sum(i.quantity-coalesce(rec.cantidad_recibida_total,0))::float8 q from public.authorized_orders o join public.authorized_order_items i on i.order_id=o.id left join public.oc_order_item_recibido rec on rec.order_item_id=i.id and rec.empresa_id=o.empresa_id where o.project_id=$1 and o.status='AUTORIZADO' and i.producto_id=$2 and i.expected_delivery_date<='2026-10-11'",[pid,product])).rows[0].q;assert.equal(inbound,6);
    need=await refresh(10-inbound);assert.equal(need.needs[0].id,needId);assert.equal(need.needs[0].quantity,4);assert.equal(need.needs[0].decision,null);pass('partial RFQ OC releases positive residual pointer with same need identity');
    assert.deepEqual((await c.query('select * from public.weekly_plan_need_decisions where id=$1',[decisionBefore.id])).rows[0],decisionBefore);
    assert.ok(need.history.some(d=>d.id===decisionBefore.id&&d.rfq_id===a.id));
    assert.deepEqual((await c.query('select rfq_id,rfq_allocation_id from public.authorized_orders where id=$1',[orders.orderIds[0]])).rows[0],{rfq_id:a.id,rfq_allocation_id:alloc.id});
    assert.equal(Number((await c.query('select quantity from public.authorized_order_items where order_id=$1',[orders.orderIds[0]])).rows[0].quantity),6);
    assert.equal(Number((await c.query('select cantidad from public.rfq_items where id=$1',[item])).rows[0].cantidad),10);pass('old decision RFQ quantities and OC provenance remain immutable');
    assert.equal((await c.query('select count(*) n from public.rfqs where project_id=$1',[pid])).rows[0].n,'1');pass('residual refresh creates no automatic RFQ');
    const next=await quote(need);assert.notEqual(next.id,a.id);
    const nextFacts=(await c.query('select r.purpose,i.cantidad::float8 from public.rfqs r join public.rfq_items i on i.rfq_id=r.id where r.id=$1',[next.id])).rows[0];assert.deepEqual(nextFacts,{purpose:'PROCUREMENT',cantidad:4});pass('new human COTIZAR creates PROCUREMENT RFQ for current residual 4');
    assert.equal((await c.query('select count(*) n from public.rfq_providers where rfq_id=$1',[next.id])).rows[0].n,'0');assert.equal((await c.query('select count(*) n from public.rfq_allocations where rfq_id=$1',[next.id])).rows[0].n,'0');assert.equal((await c.query('select count(*) n from public.authorized_orders where project_id=$1',[pid])).rows[0].n,'1');pass('new residual decision has no automatic supplier allocation award or OC');
    await c.query("update public.rfqs set status='CANCELADO' where id=$1",[next.id]);need=await refresh(4);assert.equal(need.needs[0].decision,null);assert.ok(need.history.some(d=>d.rfq_id===next.id));pass('explicitly cancelled RFQ without OC releases pointer even with identical physical sources');
    const terminalNext=await quote(need);await c.query("update public.rfqs set expires_at=now()-interval '1 hour' where id=$1",[terminalNext.id]);need=await refresh(4);assert.equal(need.needs[0].decision,null);pass('canonical expired RFQ without OC releases pointer and retains history');
  } finally { await c.query('ROLLBACK'); }
};
