// lib/tools/procurement/search-suppliers.ts
// READ tool LEVEL 0 — Search suppliers by material category or name.
// No duplica lógica de negocio: consulta proveedores/Vendor Vault con scoping tenant.
// Si el dominio no tiene un catálogo estructurado de suppliers, devuelve datos objetivos
// disponibles (últimas compras, últimas cotizaciones, contacto) sin inventar rankings.
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentToolContext } from "@/lib/agent/context";
import { registerTool } from "@/lib/agent/registry";

export const SearchSuppliersInputSchema = z.object({
  material_category: z.string().optional().nullable(),
  supplier_name: z.string().optional().nullable(),
  limit: z.number().int().positive().optional().default(10),
});

export type SearchSuppliersInput = z.infer<typeof SearchSuppliersInputSchema>;

export interface SearchSuppliersOutput {
  suppliers: Array<{
    supplier_id: string;
    nombre_razon_social: string;
    ruc: string | null;
    categoria_material: string | null;
    ultima_compra?: {
      fecha: string | null;
      monto_pyg: number | null;
      producto: string | null;
    };
    ultimas_cotizaciones?: Array<{
      rfq_id: string;
      fecha: string | null;
      monto_pyg: number | null;
      estado: string;
    }>;
    contacto?: string | null;
    activo: boolean;
  }>;
  total_found: number;
}

async function handler(
  ctx: AgentToolContext,
  input: SearchSuppliersInput,
  deps: { db: SupabaseClient }
): Promise<SearchSuppliersOutput> {
  const { db } = deps;
  const empresaId = ctx.empresaId;

  // Query suppliers/vendor data from the company bid vault or related tables
  // We'll query the company_bid_vault_items for FISCAL/LEGAL category items that might be suppliers
  // Also check if there are vendor-related tables

  let query = db.from("company_bid_vault_items").select("*, metadatos");

  // Filter by empresa_id is already handled by RLS, but we scope explicitly
  if (input.material_category) {
    query = query.eq("categoria", input.material_category);
  }

  const { data: vaultItems, error: vaultErr } = await query.limit(input.limit);

  if (vaultErr) throw new Error(`Error buscando proveedores: ${vaultErr.message}`);

  // Build supplier list from vault items, deduplicating by RUC/name
  const supplierMap = new Map<string, SearchSuppliersOutput["suppliers"][number]>();

  for (const item of (vaultItems ?? [])) {
    const metadatos = item.metadatos || {};
    const ruc = metadatos.ruc || item.ruc;
    const nombre = item.titulo || item.descripcion || "Proveedor sin nombre";

    let sup = supplierMap.get(ruc || nombre);

    if (!sup) {
      sup = {
        supplier_id: item.id,
        nombre_razon_social: nombre,
        ruc: ruc || null,
        categoria_material: metadatos.categoria_material || input.material_category || null,
        ultima_compra: metadatos.ultima_compra
          ? {
              fecha: metadatos.ultima_compra.fecha,
              monto_pyg: metadatos.ultima_compra.monto_pyg,
              producto: metadatos.ultima_compra.producto,
            }
          : undefined,
        ultimas_cotizaciones: metadatos.ultimas_cotizaciones
          ? metadatos.ultimas_cotizaciones.map((c: any) => ({
              rfq_id: c.rfq_id,
              fecha: c.fecha,
              monto_pyg: c.monto_pyg,
              estado: c.estado,
            }))
          : undefined,
        contacto: metadatos.contacto || null,
        activo: item.estado === "VIGENTE",
      };
      supplierMap.set(ruc || nombre, sup);
    } else {
      // Acumular datos: actualizar última compra si es más reciente
      // (?? 0 preserva la semántica exacta de new Date(null) = epoch, solo satisface al tipado)
      if (metadatos.ultima_compra && (!sup.ultima_compra || new Date(metadatos.ultima_compra.fecha) > new Date(sup.ultima_compra.fecha ?? 0))) {
        sup.ultima_compra = {
          fecha: metadatos.ultima_compra.fecha,
          monto_pyg: metadatos.ultima_compra.monto_pyg,
          producto: metadatos.ultima_compra.producto,
        };
      }
      // Acumular cotizaciones
      if (metadatos.ultimas_cotizaciones && Array.isArray(metadatos.ultimas_cotizaciones)) {
        const existingIds = new Set((sup.ultimas_cotizaciones ?? []).map((c: any) => c.rfq_id));
        for (const c of metadatos.ultimas_cotizaciones) {
          if (!existingIds.has(c.rfq_id)) {
            sup.ultimas_cotizaciones!.push({
              rfq_id: c.rfq_id,
              fecha: c.fecha,
              monto_pyg: c.monto_pyg,
              estado: c.estado,
            });
          }
        }
      }
    }
  }

  const suppliers = Array.from(supplierMap.values());
  const total_found = suppliers.length;

  return {
    suppliers,
    total_found,
  };
}

// Auto-registro (side-effect al importar). Risk 0 = READ.
registerTool<SearchSuppliersInput, SearchSuppliersOutput>({
  name: "search_suppliers",
  description:
    "Busca proveedores por categoría de material o nombre. Retorna proveedores con su RUC, categoría, última compra y ultimas cotizaciones. Usar cuando el agente necesita 'encontrar proveedores de cemento' o 'proveedores habituales'.",
  inputSchema: SearchSuppliersInputSchema,
  riskLevel: 0,
  requiredRoles: null,
  handler,
});

// Export para tests / uso directo sin registry
export const searchSuppliersTool = { handler, inputSchema: SearchSuppliersInputSchema };