// lib/tools/procurement/compare-quotations.ts
// READ tool LEVEL 0 — Compare quotations from different suppliers for the same RFQ items.
// Aprovecha el Item Matching Engine (GATE 7) y los datos estructurados de rfq_responses.
// No toma decisiones comerciales automáticas: retorna datos estructurados para que el LLM resuma.
// INVARIANTE: UNKNOWN != 0 — si falta precio o coverage, no convertirse en cero silenciosamente.
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentToolContext } from "@/lib/agent/context";
import { registerTool } from "@/lib/agent/registry";
import { getRfqResponsesTool } from "@/lib/tools/procurement/get-rfq-responses";
import { GetStockAvailabilityInputSchema } from "@/lib/tools/stock/get-stock-availability";

export const CompareQuotationsInputSchema = z.object({
  rfq_id: z.string().uuid({ message: "rfq_id debe ser UUID valido" }),
});

export type CompareQuotationsInput = z.infer<typeof CompareQuotationsInputSchema>;

export interface QuotationComparisonItem {
  item_description: string;
  unit: string | null;
  required_qty: number | null;
  supplier_offs: Array<{
    supplier_nombre: string;
    supplier_ruc: string | null;
    price_pyg: number | null;
    currency: string | null;
    coverage: number | null; // qué items de este cubrió (0.0 - 1.0)
    valid_until?: string | null;
  }>;
  coverage: number | null; // promedio de cobertura across suppliers (0.0 - 1.0, UNKNOWN si no hay datos)
  missing_items: Array<{
    item_description: string;
    reason: string; // "no_hay_oferta", "precio_desconocido", etc.
  }>;
}

export interface CompareQuotationsOutput {
  rfq_id: string;
  items_comparison: Array<QuotationComparisonItem>;
  overall_summary: {
    total_items: number;
    items_with_price: number;
    items_with_coverage: number;
    suppliers_quoted: number;
    price_range: { min: number | null; max: number | null };
    // UNKNOWN means we cannot determine - never 0 silently
    has_unknowns: boolean;
  };
}

async function handler(
  ctx: AgentToolContext,
  input: CompareQuotationsInput,
  deps: { db: SupabaseClient }
): Promise<CompareQuotationsOutput> {
  const { db } = deps;
  const empresaId = ctx.empresaId;

  // 1. Obtener respuestas de la RFQ
  const { data: responses, error: respErr } = await db
    .from("rfq_responses")
    .select(`
      id,
      supplier_id,
      precio_oferta_pyg,
      moneda,
      validez_hasta,
      observaciones,
      fecha_respuesta,
      estado,
      rfq_items!inner(id, descripcion, cantidad, unidad, precio_unitario, cubre_item)
    `)
    .eq("rfq_id", input.rfq_id);

  if (respErr) throw new Error(`Error leyendo respuestas RFQ: ${respErr.message}`);

  // 2. Obtener items originales de la RFQ para tener el baseline
  const { data: rfqItems, error: itemsErr } = await db
    .from("rfq_items")
    .select("id, descripcion, cantidad, unidad")
    .eq("rfq_id", input.rfq_id);

  if (itemsErr) throw new Error(`Error leyendo items RFQ: ${itemsErr.message}`);

  const originalItems = (rfqItems ?? []) as Array<{
    id: string;
    descripcion: string;
    cantidad: number | null;
    unidad: string | null;
  }>;

  // 3. Organizar respuestas por item
  // Primero, obtener todas las descripciones de items originales
  const allItemDescriptions = new Set(originalItems.map((i) => i.descripcion));

  // Agrupar respuestas por item
  const itemResponseMap = new Map<string, Array<{
    supplier_nombre: string;
    supplier_ruc: string | null;
    price_pyg: number | null;
    currency: string | null;
    coverage: number | null;
    valid_until: string | null;
  }>>();

  // Inicializar mapa con items originales
  for (const item of originalItems) {
    itemResponseMap.set(item.descripcion, []);
  }

  // Llenar con respuestas
  for (const r of (responses ?? [])) {
    const supplierResp = r.suppliers ? { nombre: r.suppliers.nombre, ruc: r.suppliers.ruc } : { nombre: "Desconocido", ruc: null };
    
    // Buscar qué item cubre esta respuesta
    const coveredItems = (r.rfq_items ?? []).filter((ir: any) => ir.cubre_item);
    
    for (const ci of coveredItems) {
      const itemDesc = ci.descripcion;
      const existing = itemResponseMap.get(itemDesc) ?? [];
      existing.push({
        supplier_nombre: supplierResp.nombre,
        supplier_ruc: supplierResp.ruc,
        price_pyg: ci.precio_unitario ?? r.precio_oferta_pyg,
        currency: r.moneda,
        coverage: ci.cubre_item ? 1.0 : null, // this item was covered
        valid_until: r.validez_hasta,
      });
      if (!existing.some((e) => e.supplier_nombre === supplierResp.nombre)) {
        itemResponseMap.set(itemDesc, existing);
      }
    }
  }

  // 4. Build comparison items
  const itemsComparison = Array.from(itemResponseMap.entries()).map(([item_description, offs]) => {
    const requiredQty = originalItems.find((i) => i.descripcion === item_description)?.cantidad ?? null;
    
    // Calcular cobertura general para este item
    const coverageValues = offs.map((o) => o.coverage).filter((c): c is number => c !== null);
    const overallCoverage = coverageValues.length > 0
      ? Number((coverageValues.reduce((a, b) => a + b, 0) / coverageValues.length).toFixed(3))
      : null;

    // Identificar items faltantes (originales que no tienen cobertura)
    const missingItems: Array<{
      item_description: string;
      reason: string;
    }> = [];

    // Check against original items
    const originalItem = originalItems.find((i) => i.descripcion === item_description);
    if (!originalItem) {
      missingItems.push({
        item_description,
        reason: "item_no_original_rfq",
      });
    } else if (offs.length === 0) {
      missingItems.push({
        item_description,
        reason: "no_hay_oferta",
      });
    } else if (offs.some((o) => o.price_pyg === null || o.price_pyg === undefined)) {
      missingItems.push({
        item_description,
        reason: "precio_desconocido",
      });
    }

    return {
      item_description,
      unit: originalItem?.unidad ?? null,
      required_qty: requiredQty,
      supplier_offs: offs,
      coverage: overallCoverage,
      missing_items: missingItems,
    } as QuotationComparisonItem;
  });

  // 5. Overall summary
  const totalItems = originalItems.length;
  const itemsWithPrice = itemsComparison.filter((ic) => ic.supplier_offs.length > 0).length;
  const itemsWithCoverage = itemsComparison.filter((ic) => ic.coverage !== null).length;
  const suppliersQuoted = new Set(
    itemsComparison.flatMap((ic) => ic.supplier_offs.map((o) => o.supplier_nombre))
  ).size;
  
  const prices = itemsComparison.flatMap((ic) =>
    ic.supplier_offs.filter((o) => o.price_pyg !== null && o.price_pyg !== undefined)
  );
  const priceRange = {
    min: prices.length > 0 ? Math.min(...prices) : null,
    max: prices.length > 0 ? Math.max(...prices) : null,
  };

  // has_unknowns: true si algun item tiene coverage UNKNOWN (null) o missing_items
  const has_unknowns = itemsComparison.some((ic) =>
    ic.coverage === null || ic.missing_items.length > 0
  );

  return {
    rfq_id: input.rfq_id,
    items_comparison: itemsComparison,
    overall_summary: {
      total_items: totalItems,
      items_with_price: itemsWithPrice,
      items_with_coverage: itemsWithCoverage,
      suppliers_quoted: suppliersQuoted,
      price_range,
      has_unknowns,
    },
  };
}

// Auto-registro (side-effect al importar). Risk 0 = READ, usa item-matching engine interno.
registerTool<CompareQuotationsInput, CompareQuotationsOutput>({
  name: "compare_quotations",
  description:
    "Compara cotizaciones de diferentes proveedores para los items de una RFQ. Retorna análisis por item con precios, cobertura y items faltantes. NO declara ganador automáticamente — el LLM puede resumir 'A es más barato, B entrega antes' pero la decisión es humana. Usar cuando el agente necesita 'comparar las propuestas de la RFQ'.",
  inputSchema: CompareQuotationsInputSchema,
  riskLevel: 0,
  requiredRoles: null,
  handler,
});

// Export para tests / uso directo sin registry
export const compareQuotationsTool = { handler, inputSchema: CompareQuotationsInputSchema };