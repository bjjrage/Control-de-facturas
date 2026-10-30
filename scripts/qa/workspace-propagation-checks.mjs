import assert from 'node:assert/strict';

const near=(actual,expected,label)=>assert(Math.abs(actual-expected)<=Math.max(1e-5,Math.abs(expected)*1e-12),`${label}: ${actual} != ${expected}`);
const num=value=>value.toLocaleString('es-PY',{maximumFractionDigits:6});

export async function setupPropagationChecks({db,api,page,projectId,material,original,origin,errors,mode}){
  const anonymous=await fetch(`${origin}/api/projects/${projectId}/operational-projection`,{redirect:'manual'});assert.notEqual(anonymous.status,200);
  const absent=await api('/api/projects/00000000-0000-0000-0000-000000000000/operational-projection');assert.equal(absent.status,404);
  async function read(){const result=await api(`/api/projects/${projectId}/operational-projection`);assert.equal(result.status,200,JSON.stringify(result.body));return result.body;}
  const initial=await read(), item=initial.items.find(item=>item.rowId===original._rowId);
  console.log(JSON.stringify({propagation:'baseline-read',mode}));
  assert(item);assert.equal(initial.issues.length,0);assert(initial.cost>0);assert(original.quantity>0);assert(item.cost>0);
  const {data:project,error:pe}=await db.from('projects').select('budget_total,contract_amount').eq('id',projectId).single();if(pe)throw pe;
  const {data:plans,error:ple}=await db.from('project_schedule_plans').select('id,label,is_active').eq('project_id',projectId).order('id');if(ple)throw ple;
  const planIds=plans.map(plan=>plan.id);
  async function months(){if(!planIds.length)return [];const {data,error}=await db.from('project_schedule_plan_months').select('id,plan_id,month_index,programado_pct,ejecutado_pct_documento').in('plan_id',planIds).order('id');if(error)throw error;return data;}
  const baselineMonths=await months();
  const initialUnitCost=item.cost/original.quantity;
  const sourceSum=item.schedule.monthlyValues.reduce((sum,month)=>sum+month.value,0);
  const weight=month=>(item.schedule.monthlyValues.find(value=>value.month===month)?.value??0)/sourceSum;
  const baselineNeed=(month,key)=>initial.months.find(value=>value.month===month)?.materials.find(value=>value.key===key)?.quantity??0;
  let checks=0;const evidence=[];
  async function verify(quantity,consumption,{ui=false,draftSubtotal}={}){
    const current=await read();
    const costDeltaUnit=(consumption-material.cantidad_por_unidad_ejecutada)*(1+material.desperdicio_pct/100)*material.precio_unitario_origen;
    const expectedCost=initial.cost-item.cost+quantity*(initialUnitCost+costDeltaUnit);
    const {data:savedItem,error:itemError}=await db.from('budget_items').select('quantity,subtotal').eq('id',original._rowId).single();if(itemError)throw itemError;assert.equal(savedItem.quantity,quantity);
    if(draftSubtotal!==undefined)near(draftSubtotal,savedItem.subtotal,'Univer subtotal / PostgreSQL subtotal');
    const expectedSale=initial.sale-item.sale+savedItem.subtotal;
    near(current.sale,expectedSale,'project selling budget');near(current.cost,expectedCost,'project APU cost');
    const live=current.items.find(value=>value.rowId===original._rowId);assert.equal(live.quantity,quantity);assert.deepEqual(live.schedule,item.schedule);
    near(live.cost,quantity*(initialUnitCost+costDeltaUnit),'item APU cost');
    const {data:saved,error}=await db.from('projects').select('budget_total,contract_amount').eq('id',projectId).single();if(error)throw error;
    near(saved.budget_total,expectedSale,'persisted project budget');assert.equal(saved.contract_amount,project.contract_amount);
    const needDelta=(quantity*consumption-original.quantity*material.cantidad_por_unidad_ejecutada)*(1+material.desperdicio_pct/100);
    for(const month of current.months){
      const base=initial.months.find(value=>value.month===month.month);
      near(month.sale,base.sale+(expectedSale-initial.sale)*weight(month.month),'monthly selling amount');
      near(month.cost,base.cost+(expectedCost-initial.cost)*weight(month.month),'monthly APU amount');
      near(month.materials.find(value=>value.key===material.producto_id)?.quantity??0,baselineNeed(month.month,material.producto_id)+needDelta*weight(month.month),'monthly material need');
    }
    near(current.months.reduce((sum,month)=>sum+month.sale,0),current.sale,'monthly sale reconciliation');
    near(current.months.reduce((sum,month)=>sum+month.cost,0),current.cost,'monthly cost reconciliation');
    assert.deepEqual(await months(),baselineMonths,'Approved/documentary schedule must remain intact');
    checks++;
    console.log(JSON.stringify({propagation:'amounts-and-months-verified',mode,quantity,consumption}));
    if(ui){
      const erp=await page.context().newPage();erp.setDefaultTimeout(60000);erp.on('pageerror',error=>errors.push(error.message));
      try{
        await erp.goto(page.url(),{waitUntil:'networkidle',timeout:180000});
        await erp.getByRole('tab',{name:'Cronograma',exact:true}).click();
        await erp.locator('[data-projection-sale]').getByText(num(expectedSale),{exact:true}).waitFor();
        const first=current.months.find(month=>weight(month.month)>0);assert(first);
        assert.equal(await erp.locator(`[data-month-sale="${first.month}"]`).textContent(),num(first.sale));
        assert.equal(await erp.locator(`[data-month-cost="${first.month}"]`).textContent(),num(first.cost));
        await erp.screenshot({path:`audit-artifacts/workbook-linked-import/${mode}-propagation-workspace.png`});
        await erp.getByRole('tab',{name:'Materiales',exact:true}).click();
        const totalNeed=current.months.reduce((sum,month)=>sum+(month.materials.find(value=>value.key===material.producto_id)?.quantity??0),0);
        assert.equal(await erp.locator(`[data-material-need="${material.producto_id}"]`).textContent(),num(totalNeed));
        console.log(JSON.stringify({propagation:'workspace-materials-verified',mode}));
        await erp.goto(`${origin}/projects/${projectId}?tab=costeo`,{waitUntil:'networkidle',timeout:180000});
        const totals=erp.locator('[data-erp-cost-total]');await totals.waitFor();
        near(Number(await totals.getAttribute('data-erp-cost-total')),expectedCost,'Costeo cost');
        near(Number(await totals.getAttribute('data-erp-sale-total')),expectedSale,'Costeo selling budget');
        near(Number(await erp.locator(`[data-erp-material="${material.producto_id}"]`).getAttribute('data-erp-need')),totalNeed,'Costeo material needs');
        console.log(JSON.stringify({propagation:'erp-costing-verified',mode}));
        await erp.goto(`${origin}/projects/${projectId}?tab=informes`,{waitUntil:'networkidle',timeout:180000});
        await erp.getByRole('region',{name:'Planificación operativa del ERP'}).waitFor();
        await erp.locator('[data-projection-cost]').getByText(num(expectedCost),{exact:true}).waitFor();
        assert.equal(await erp.locator('[data-projection-sale]').textContent(),num(expectedSale));
        console.log(JSON.stringify({propagation:'erp-reports-verified',mode}));
      }finally{await erp.close();}
    }
    const state={quantity,consumption,sale:current.sale,cost:current.cost,monthlyMaterialNeed:current.months.map(month=>({month:month.month,quantity:month.materials.find(value=>value.key===material.producto_id)?.quantity??0}))};evidence.push(state);return state;
  }
  async function restored(){await verify(original.quantity,material.cantidad_por_unidad_ejecutada);return {propagationChecks:checks,projectionEvidence:evidence,sourceSchedulePreserved:true,contractAmountPreserved:true};}
  return {verify,restored};
}
