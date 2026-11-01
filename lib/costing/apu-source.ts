import type { SupabaseClient } from "@supabase/supabase-js";

/** Read every recipe row. API limits are transport limits, not BOM limits. */
export async function readApuRows(db: SupabaseClient, table: string, columns: string, projectId: string, empresaId?: string) {
  // Dynamic projections include different nested catalog joins.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any[] = [];
  let total: number | null = null;
  for (;;) {
    let query = db.from(table).select(columns, { count: "exact" }).eq("project_id", projectId);
    if (empresaId) query = query.eq("empresa_id", empresaId);
    const page = await query.order("id").range(data.length, data.length + 499);
    if (page.error) return { data: null, error: page.error };
    if (page.count === null || (total !== null && total !== page.count)) return { data: null, error: { message: "La receta cambió durante la lectura; actualizá la vista." } };
    total = page.count;
    data.push(...(page.data ?? []));
    if (data.length === total) return { data, error: null };
    if (!page.data?.length || data.length > total) return { data: null, error: { message: "No se pudo leer el APU completo." } };
  }
}

/** Only a unique source price can be displayed as a product-level reference.
 * Different recipe prices remain on their individual lines. */
export function sourceMaterialPrices(rows: { producto_id: string; precio_unitario_origen: unknown }[]) {
  const prices = new Map<string, number | null>();
  for (const row of rows) {
    const price = row.precio_unitario_origen == null ? null : Number(row.precio_unitario_origen);
    if (price === null || !Number.isFinite(price) || price < 0) continue;
    const previous = prices.get(row.producto_id);
    prices.set(row.producto_id, previous === undefined ? price : previous !== null && Math.abs(previous-price) <= Math.max(1e-8, price*1e-10) ? previous : null);
  }
  return prices;
}
