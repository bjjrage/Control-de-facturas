import type { SupabaseClient } from "@supabase/supabase-js";
import { readApuRows } from "@/lib/costing/apu-source";
import type { LinkedRecipe } from "./linked-recipes";

/** Read back every operational link, including its original price. Duplicate
 * lines of one resource are intentionally consolidated with a weighted price. */
export async function verifyLinkedRecipePersistence(db: SupabaseClient, projectId: string, empresaId: string, recipes: LinkedRecipe[]) {
  const tables = ["budget_items","budget_item_materials","budget_item_labor","budget_item_equipment","budget_item_subcontracts"];
  const columns = ["id,code,description,unit,unit_price", "id,budget_item_id,producto_id,cantidad_por_unidad_ejecutada,desperdicio_pct,precio_unitario_origen,productos(nombre,unidad,sku)", "id,budget_item_id,rol,horas_por_unidad_ejecutada,costo_hora", "id,budget_item_id,tipo_equipo,horas_por_unidad_ejecutada,costo_hora", "id,budget_item_id,descripcion,precio_por_unidad"];
  const results = await Promise.all(tables.map((t,i)=>readApuRows(db,t,columns[i],projectId,i ? empresaId : undefined)));
  const errors: string[] = [];
  results.forEach((r,i)=>{if(r.error) errors.push(`${tables[i]}: ${r.error.message}`);});
  if (errors.length) return { errors, counts: {} };
  const [budget,materials,labor,equipment,transport] = results.map(r=>r.data!);
  const ids = new Map(budget.map(b=>[b.id,b.code]));
  const near = (a: number,b: number)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=Math.max(1e-7,Math.abs(b)*1e-10);
  const actual = new Map<string,{quantity:number; amount:number}>();
  const key = (code: string,kind: string,label: string,unit: string)=>JSON.stringify([code,kind,label.trim().toLowerCase(),unit.trim().toLowerCase()]);
  for (const [index,rows] of [materials,labor,equipment,transport].entries()) for (const row of rows) {
    const code = ids.get(row.budget_item_id);
    const p = Array.isArray(row.productos) ? row.productos[0] : row.productos;
    const kind = ["MATERIAL","LABOR","EQUIPMENT","TRANSPORT"][index];
    const label = index===0 ? p?.nombre : index===1 ? row.rol : index===2 ? row.tipo_equipo : String(row.descripcion).replace(/^Transporte · /,"");
    const quantity = Number(index===0 ? row.cantidad_por_unidad_ejecutada : index===3 ? 1 : row.horas_por_unidad_ejecutada);
    const price = Number(index===0 ? row.precio_unitario_origen : index===3 ? row.precio_por_unidad : row.costo_hora);
    const k = key(code,kind,label ?? "",index===0 ? p?.unidad ?? "" : index===3 ? "servicio por unidad" : "h");
    if (actual.has(k) || !code || row.desperdicio_pct > 0 || (index===0 && row.precio_unitario_origen == null)) errors.push(`Vínculo operativo duplicado o sin precio/unidad de origen: ${code}/${label}.`);
    actual.set(k,{quantity,amount:quantity*price});
  }
  const expected = new Map<string,{quantity:number;amount:number}>();
  for (const recipe of recipes) {
    const item = budget.find(b=>b.code===recipe.budgetCode);
    if (!item || item.unit!==recipe.unit || item.description!==recipe.description || !near(Number(item.unit_price),recipe.adoptedPrice)) errors.push(`Identidad de partida ${recipe.budgetCode} no coincide con la receta.`);
    for (const line of recipe.lines) {
      const k=key(recipe.budgetCode,line.kind,line.description,line.unit), prev=expected.get(k)??{quantity:0,amount:0};
      prev.quantity+=line.quantity;prev.amount+=line.quantity*line.price;expected.set(k,prev);
    }
  }
  for (const [k,e] of expected) { const a=actual.get(k);if(!a || !near(a.quantity,e.quantity) || !near(a.amount,e.amount)) errors.push(`Consumo o precio de origen diferente: ${k}.`); }
  for (const k of actual.keys()) if (!expected.has(k)) errors.push(`Recurso operativo fuera de las recetas verificadas: ${k}.`);
  if (budget.length!==recipes.length) errors.push("La cantidad de partidas no coincide con las recetas verificadas.");
  return { errors, counts: { recipes:recipes.length,materials:materials.length,labor:labor.length,equipment:equipment.length,transport:transport.length } };
}
