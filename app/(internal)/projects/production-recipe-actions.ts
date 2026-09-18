"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePlan } from "@/lib/auth";
import type {
  ProductionRecipe,
  ProductionRecipeComponent,
} from "@/lib/types";
import { resolveImportMapping } from "@/lib/procurement/production-recipe";

export interface RecipeComponentInput {
  budgetItemId: string;
  quantityPerUnit: number;
  unit: string;
}

export interface SaveRecipeParams {
  recipeId?: string;
  projectId: string;
  code: string;
  name: string;
  productionUnit: string;
  description?: string | null;
  contractTotalQuantity?: number | null;
  sourceType?: "EXCEL" | "BIM" | "MANUAL";
  sourceFileName?: string | null;
  components: RecipeComponentInput[];
}

export interface ImportRecipeRow {
  recipeCode: string;
  recipeName: string;
  productionUnit: string;
  itemCode: string;
  quantityPerUnit: number;
  unit: string;
  /** Mapeo manual explícito de la UI (prevalece sobre itemCode). */
  budgetItemId?: string | null;
}

export interface RecipeWithComponents {
  recipe: ProductionRecipe;
  components: ProductionRecipeComponent[];
}

/**
 * Lista recetas activas del proyecto con sus componentes.
 */
export async function listProductionRecipes(
  projectId: string
): Promise<{
  data: RecipeWithComponents[] | null;
  error: string | null;
}> {
  try {
    const profile = await requirePlan("pro", ["administracion", "admin"]);
    const supabase = await createClient();

    const { data: project, error: pErr } = await supabase
      .from("projects")
      .select("id")
      .eq("id", projectId)
      .eq("empresa_id", profile.empresa_id)
      .single();
    if (pErr || !project) {
      return { data: null, error: "Proyecto no encontrado o sin permisos." };
    }

    const { data: recipes, error: rErr } = await supabase
      .from("production_recipes")
      .select("*")
      .eq("project_id", projectId)
      .eq("empresa_id", profile.empresa_id)
      .eq("active", true)
      .order("code", { ascending: true });
    if (rErr) {
      return { data: null, error: `Error al listar recetas: ${rErr.message}` };
    }
    if (!recipes || recipes.length === 0) return { data: [], error: null };

    const { data: comps, error: cErr } = await supabase
      .from("production_recipe_components")
      .select("*")
      .in(
        "recipe_id",
        (recipes as ProductionRecipe[]).map((r) => r.id)
      )
      .order("sort_order", { ascending: true });
    if (cErr) {
      return { data: null, error: `Error al listar componentes: ${cErr.message}` };
    }

    const byRecipe = new Map<string, ProductionRecipeComponent[]>();
    for (const c of (comps ?? []) as ProductionRecipeComponent[]) {
      if (!byRecipe.has(c.recipe_id)) byRecipe.set(c.recipe_id, []);
      byRecipe.get(c.recipe_id)!.push(c);
    }
    return {
      data: (recipes as ProductionRecipe[]).map((recipe) => ({
        recipe,
        components: byRecipe.get(recipe.id) ?? [],
      })),
      error: null,
    };
  } catch (err: unknown) {
    return {
      data: null,
      error: err instanceof Error ? err.message : "Error al listar recetas.",
    };
  }
}

async function assertItemsBelongToProject(
  supabase: Awaited<ReturnType<typeof createClient>>,
  empresaId: string,
  projectId: string,
  budgetItemIds: string[]
): Promise<{ ok: boolean; error?: string; items?: { id: string; unit: string | null }[] }> {
  if (budgetItemIds.length === 0) {
    return { ok: false, error: "La receta necesita al menos un componente." };
  }
  // Verificar pertenencia vía join a projects (tenant fail-closed).
  const { data, error } = await supabase
    .from("budget_items")
    .select("id, unit, project_id, projects!inner(empresa_id)")
    .in("id", budgetItemIds);
  if (error) {
    return { ok: false, error: `Error al validar partidas: ${error.message}` };
  }
  const rows = (data ?? []) as Array<{
    id: string;
    unit: string | null;
    project_id: string;
    projects: { empresa_id: string } | { empresa_id: string }[];
  }>;
  if (rows.length !== budgetItemIds.length) {
    return { ok: false, error: "Alguna partida no existe en este proyecto." };
  }
  for (const r of rows) {
    const emp = Array.isArray(r.projects) ? r.projects[0]?.empresa_id : r.projects?.empresa_id;
    if (r.project_id !== projectId || emp !== empresaId) {
      return { ok: false, error: "Alguna partida no pertenece a este proyecto/empresa." };
    }
  }
  return { ok: true, items: rows.map((r) => ({ id: r.id, unit: r.unit })) };
}

/**
 * Crea o reemplaza una receta manual con sus componentes.
 * Solo guarda cantidades por unidad + referencia a partidas (sin precios).
 */
export async function saveProductionRecipe(
  params: SaveRecipeParams
): Promise<{ data: ProductionRecipe | null; error: string | null }> {
  try {
    const profile = await requirePlan("pro", ["administracion", "admin"]);
    const empresaId = profile.empresa_id;
    const supabase = await createClient();
    const {
      recipeId,
      projectId,
      code,
      name,
      productionUnit,
      description,
      contractTotalQuantity,
      sourceType = "MANUAL",
      sourceFileName,
      components,
    } = params;

    if (!projectId) return { data: null, error: "Proyecto requerido." };
    if (!code?.trim() || !name?.trim() || !productionUnit?.trim()) {
      return { data: null, error: "Código, nombre y unidad de producción requeridos." };
    }
    const cleanComponents = (components ?? []).filter(
      (c) => c.budgetItemId && Number(c.quantityPerUnit) > 0
    );
    if (cleanComponents.length === 0) {
      return { data: null, error: "La receta necesita al menos un componente con cantidad > 0." };
    }
    // Sin duplicados por partida (una partida, una cantidad por receta).
    const seen = new Set<string>();
    for (const c of cleanComponents) {
      if (seen.has(c.budgetItemId)) {
        return { data: null, error: "Partida duplicada en la receta." };
      }
      seen.add(c.budgetItemId);
    }

    const { data: project, error: pErr } = await supabase
      .from("projects")
      .select("id")
      .eq("id", projectId)
      .eq("empresa_id", empresaId)
      .single();
    if (pErr || !project) {
      return { data: null, error: "Proyecto no encontrado o sin permisos." };
    }

    const check = await assertItemsBelongToProject(
      supabase,
      empresaId,
      projectId,
      cleanComponents.map((c) => c.budgetItemId)
    );
    if (!check.ok) return { data: null, error: check.error! };

    let savedId = recipeId || null;
    if (savedId) {
      const { data: existing } = await supabase
        .from("production_recipes")
        .select("id")
        .eq("id", savedId)
        .eq("project_id", projectId)
        .eq("empresa_id", empresaId)
        .single();
      if (!existing) {
        return { data: null, error: "Receta no encontrada o sin permisos." };
      }
      const { error: uErr } = await supabase
        .from("production_recipes")
        .update({
          code: code.trim(),
          name: name.trim(),
          production_unit: productionUnit.trim(),
          description: description?.trim() || null,
          contract_total_quantity:
            contractTotalQuantity !== undefined && contractTotalQuantity !== null
              ? Number(contractTotalQuantity)
              : null,
          source_type: sourceType,
          source_file_name: sourceFileName || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", savedId);
      if (uErr) return { data: null, error: `Error al guardar receta: ${uErr.message}` };
      await supabase.from("production_recipe_components").delete().eq("recipe_id", savedId);
    } else {
      const { data: inserted, error: iErr } = await supabase
        .from("production_recipes")
        .insert({
          empresa_id: empresaId,
          project_id: projectId,
          code: code.trim(),
          name: name.trim(),
          production_unit: productionUnit.trim(),
          description: description?.trim() || null,
          contract_total_quantity:
            contractTotalQuantity !== undefined && contractTotalQuantity !== null
              ? Number(contractTotalQuantity)
              : null,
          source_type: sourceType,
          source_file_name: sourceFileName || null,
          active: true,
          created_by: profile.id,
        })
        .select("id")
        .single();
      if (iErr || !inserted) {
        return { data: null, error: `Error al crear receta: ${iErr?.message || "desconocido"}` };
      }
      savedId = (inserted as { id: string }).id;
    }

    const rows = cleanComponents.map((c, idx) => ({
      recipe_id: savedId as string,
      budget_item_id: c.budgetItemId,
      quantity_per_production_unit: Number(c.quantityPerUnit),
      unit: c.unit?.trim() || "unid",
      sort_order: idx,
    }));
    const { error: cErr } = await supabase
      .from("production_recipe_components")
      .insert(rows);
    if (cErr) return { data: null, error: `Error al guardar componentes: ${cErr.message}` };

    const { data: saved } = await supabase
      .from("production_recipes")
      .select("*")
      .eq("id", savedId)
      .single();
    return { data: (saved as ProductionRecipe) ?? null, error: null };
  } catch (err: unknown) {
    return {
      data: null,
      error: err instanceof Error ? err.message : "Error al guardar receta.",
    };
  }
}

/**
 * Importación Excel → receta estructurada.
 * Mapeo por CÓDIGO EXACTO de partida (prioridad); sin fuzzy, sin inserts
 * silenciosos: filas desconocidas/ambiguas se devuelven como errores y
 * BLOQUEAN la importación hasta corregirse.
 */
export async function importProductionRecipe(params: {
  projectId: string;
  code: string;
  name: string;
  productionUnit: string;
  description?: string | null;
  contractTotalQuantity?: number | null;
  sourceFileName?: string | null;
  rows: ImportRecipeRow[];
}): Promise<{
  data: ProductionRecipe | null;
  error: string | null;
  rowErrors?: { row: number; reason: string }[];
}> {
  try {
    const profile = await requirePlan("pro", ["administracion", "admin"]);
    const empresaId = profile.empresa_id;
    const supabase = await createClient();
    const { projectId, code, name, productionUnit, rows } = params;

    const { data: project, error: pErr } = await supabase
      .from("projects")
      .select("id")
      .eq("id", projectId)
      .eq("empresa_id", empresaId)
      .single();
    if (pErr || !project) {
      return { data: null, error: "Proyecto no encontrado o sin permisos." };
    }

    // Catálogo de códigos del proyecto (exactos).
    const { data: items, error: bErr } = await supabase
      .from("budget_items")
      .select("id, code, unit")
      .eq("project_id", projectId);
    if (bErr) {
      return { data: null, error: `Error al leer partidas: ${bErr.message}` };
    }
    // P0: mapeo centralizado (el fix manual de la UI llega vía budgetItemId).
    const catalog = ((items ?? []) as Array<{ id: string; code: string; unit: string | null }>).map(
      (it) => ({ id: it.id, code: it.code, unit: it.unit })
    );
    const resolved = resolveImportMapping(
      (rows ?? []).map((r) => ({
        itemCode: r.itemCode,
        quantityPerUnit: r.quantityPerUnit,
        unit: r.unit,
        budgetItemId: r.budgetItemId ?? null,
      })),
      catalog
    );
    const rowErrors = resolved.errors;
    const mapped = resolved.mapped.map((m) => ({
      budgetItemId: m.budgetItemId,
      qty: m.quantityPerUnit,
      unit: m.unit,
    }));
    if (rowErrors.length > 0 || mapped.length === 0) {
      return {
        data: null,
        error:
          mapped.length === 0
            ? "Sin filas válidas para importar."
            : `${rowErrors.length} filas con error (ver detalle).`,
        rowErrors,
      };
    }

    return {
      ...(await saveProductionRecipe({
        projectId,
        code,
        name,
        productionUnit,
        description: params.description,
        contractTotalQuantity: params.contractTotalQuantity,
        sourceType: "EXCEL",
        sourceFileName: params.sourceFileName,
        components: mapped.map((m) => ({
          budgetItemId: m.budgetItemId,
          quantityPerUnit: m.qty,
          unit: m.unit,
        })),
      })),
      rowErrors,
    };
  } catch (err: unknown) {
    return {
      data: null,
      error: err instanceof Error ? err.message : "Error al importar receta.",
    };
  }
}
