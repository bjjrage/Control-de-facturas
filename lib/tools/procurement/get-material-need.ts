// lib/tools/procurement/get-material-need.ts
// READ tool LEVEL 0 — Checks material needs for a project by comparing
// project budget items against current stock availability.
// No duplica lógica de negocio: usa item-matching + stock existente con scoping tenant.
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentToolContext } from "@/lib/agent/context";
import { registerTool } from "@/lib/agent/registry";
import { matchTenderItem } from "@/lib/procurement/item-matching";
import { GetStockAvailabilityInputSchema } from "@/lib/tools/stock/get-stock-availability";

export const GetMaterialNeedInputSchema = z.object({
  project_id: z.string().uuid({ message: "project_id debe ser UUID valido" }),
  material_descriptions: z.array(z.string()).min(1, "al menos un material requerido"),
});

export type GetMaterialNeedInput = z.infer<typeof GetMaterialNeedInputSchema>;

export interface GetMaterialNeedOutput {
  project_id: string;
  materials_requested: Array<{
    description: string;
    required: number;
    net_available: number; // stock disponible - reservado
    shortage: number; //.required - available (0 if sufficient)
    unit: string | null;
    matched_catalog_item: { id: string; nombre: string; similarity: number } | null;
  }>;
  summary: {
    total_materials: number;
    sufficient: number; // all materials have net_available >= 0
    insufficient: number; // some materials have shortage > 0
    total_shortage: number;
  };
}

async function handler(
  ctx: AgentToolContext,
  input: GetMaterialNeedInput,
  deps: { db: SupabaseClient }
): Promise<GetMaterialNeedOutput> {
  const { db } = deps;
  const empresaId = ctx.empresaId;

  // 1. Obtener contexto del proyecto (budget_items + execution_entries)
  const { data: project, error: projErr } = await db
    .from("projects")
    .select("id, empresa_id, name, code")
    .eq("id", input.project_id)
    .eq("empresa_id", empresaId)
    .single();

  if (projErr || !project) {
    throw new Error(`Proyecto no encontrado o no pertenece a tu empresa (id=${input.project_id})`);
  }

  // 2. Obtener budget_items del proyecto
  const { data: budgetItems, error: budgetErr } = await db
    .from("budget_items")
    .select("id, quantity, unit_price, subtotal, descripcion")
    .eq("project_id", input.project_id);

  if (budgetErr) throw new Error(`Error leyendo presupuesto del proyecto: ${budgetErr.message}`);

  const budgetItemsArray = (budgetItems ?? []) as Array<{
    id: string;
    quantity: number | null;
    unit_price: number | null;
    subtotal: number | null;
    descripcion: string | null;
  }>;

  // 3. Obtener catálogo de productos de la empresa una sola vez
  const { data: catalog, error: catErr } = await db
    .from("productos")
    .select("id, nombre, unidad, stock_actual, activo")
    .eq("empresa_id", empresaId)
    .in("activo", [true]); // solo activos

  const catalogItems = ((catalog ?? []) as Array<{
    id: string;
    nombre: string;
    unidad: string | null;
    stock_actual: number;
  }>).map((c) => ({
    // El motor de matching (CatalogItem) pide descripcion/unidad no nulas:
    // se derivan de nombre/unidad sin cambiar la fuente ni el flujo.
    ...c,
    descripcion: c.nombre,
    unidad: c.unidad ?? "",
  }));

  // 4. Para cada material solicitado, verificar stock disponible
  const materialsRequested = input.material_descriptions.map((desc) => {
    if (catErr) {
      // Si falla el catálogo, retornar resultado conservador
      return {
        description: desc,
        required: 0,
        net_available: 0,
        shortage: 0,
        unit: null,
        matched_catalog_item: null,
      };
    }

    // Usar matchTenderItem para encontrar el mejor match en catálogo
    const bestMatch = catalogItems.length > 0
      ? matchTenderItem(desc, "unidad desconocida", catalogItems)
      : { bestMatch: null, candidateMatches: [] };

    const matchedItem = bestMatch.bestMatch
      ? {
          id: bestMatch.bestMatch.item.id,
          // El item devuelto es la misma referencia adaptada de arriba
          // (con nombre preservado por spread); el cast solo lo expresa.
          nombre: (bestMatch.bestMatch.item as typeof catalogItems[number]).nombre,
          similarity: bestMatch.bestMatch.similarityScore,
        }
      : null;

    // Buscar stock de ese material en catálogo
    const catalogItem = catalogItems.find((p) => p.id === matchedItem?.id);
    const stockDisponible = catalogItem ? catalogItem.stock_actual : 0;
    const unidad = catalogItem ? catalogItem.unidad : null;

    // El "required" viene del budget_item si existe, o es desconocido
    const budgetItem = budgetItemsArray.find((bi) =>
      bi.descripcion && bi.descripcion.toLowerCase().includes(desc.toLowerCase())
    );

    const required = budgetItem?.quantity ?? null;
    const netAvailable = stockDisponible; // stock actual simple (sin reserved complicado en este batch)
    const shortage = required && required > 0 && stockDisponible < required
      ? required - stockDisponible
      : 0;

    return {
      description: desc,
      required: required ?? 0, // 0 = desconocido/no especificado
      net_available: netAvailable,
      shortage: Math.max(0, shortage),
      unit: unidad,
      matched_catalog_item: matchedItem,
    };
  });

  // 4. Resumen
  const sufficient = materialsRequested.filter((m) => m.shortage === 0).length;
  const insufficient = materialsRequested.filter((m) => m.shortage > 0).length;
  const totalShortage = materialsRequested.reduce((sum, m) => sum + m.shortage, 0);

  return {
    project_id: input.project_id,
    materials_requested: materialsRequested,
    summary: {
      total_materials: materialsRequested.length,
      sufficient,
      insufficient,
      total_shortage: totalShortage,
    },
  };
}

// Auto-registro (side-effect al importar). Risk 0 = READ, roles internos.
registerTool<GetMaterialNeedInput, GetMaterialNeedOutput>({
  name: "get_material_need",
  description:
    "Verifica necesidades de material para un proyecto: compara lo solicitado en el presupuesto contra stock actual en catálogo. Retorna required, net_available y shortage por material. Usar cuando el usuario pregunta '¿tenemos suficiente de X para esta obra?' o 'cuánto necesitamos de Y?.",
  inputSchema: GetMaterialNeedInputSchema,
  riskLevel: 0,
  requiredRoles: null, // cualquier rol interno puede leer necesidades
  handler,
});

// Export para tests / uso directo sin registry
export const getMaterialNeedTool = { handler, inputSchema: GetMaterialNeedInputSchema };