import { requirePlan } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getCanonicalInventorySnapshot } from "@/lib/inventory/service";
import { InventarioGlobalSection } from "./inventario-global-section";
import type { InventoryLocationAdminRow, InventoryProjectOption } from "./ubicaciones-dialog";

export default async function InventarioGlobalPage() {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const supabase = await createClient();

  const [snapshot, locationsResult, productsResult, projectResult] = await Promise.all([
    getCanonicalInventorySnapshot(supabase, profile.empresa_id),
    supabase
      .from("inventory_locations")
      .select("id, name, location_type, project_id, parent_location_id, is_primary, active")
      .eq("empresa_id", profile.empresa_id)
      .order("name"),
    supabase
      .from("productos")
      .select("id, nombre, unidad")
      .eq("empresa_id", profile.empresa_id)
      .eq("activo", true)
      .order("nombre")
      .limit(1000),
    supabase
      .from("projects")
      .select("id, name, code")
      .eq("empresa_id", profile.empresa_id)
      .order("name")
      .limit(1000),
  ]);

  const positiveLocations = snapshot.locations.filter((r) => (r.quantity as number) > 0);
  const allLocations = locationsResult.data ?? [];
  const activeLocations = allLocations.filter((location) => location.active === true);
  const projectRows = projectResult.data ?? [];
  const projectNameById = new Map<string, string>(projectRows.map((project) => [project.id as string, project.name as string]));

  const movementLocations = activeLocations.map((location) => ({
    id: location.id as string,
    name: location.name as string,
    locationType: location.location_type as "CENTRAL" | "PROJECT" | "AUXILIARY",
    projectId: (location.project_id as string | null) ?? null,
    projectName: location.project_id ? projectNameById.get(location.project_id as string) ?? null : null,
  }));
  const movementProducts = (productsResult.data ?? []).map((product) => ({
    id: product.id as string,
    name: product.nombre as string,
    unit: product.unidad as string,
  }));
  const adminLocations = allLocations.map((location): InventoryLocationAdminRow => ({
    id: location.id as string,
    name: location.name as string,
    locationType: location.location_type as "CENTRAL" | "PROJECT" | "AUXILIARY",
    projectId: (location.project_id as string | null) ?? null,
    projectName: location.project_id ? projectNameById.get(location.project_id as string) ?? null : null,
    parentLocationId: (location.parent_location_id as string | null) ?? null,
    isPrimary: location.is_primary as boolean,
    active: location.active as boolean,
  }));
  const projectOptions = projectRows.map((project): InventoryProjectOption => ({
    id: project.id as string,
    name: project.name as string,
    code: project.code as string,
  }));

  return (
    <InventarioGlobalSection
      movementAttemptStorageKey={`inventory:manual-movement:pending:${profile.empresa_id}:${profile.id}`}
      initialStockAttemptStorageKey={`inventory:initial-stock:pending:${profile.empresa_id}:${profile.id}`}
      globalRows={snapshot.global as import("./inventario-global-section").GlobalRow[]}
      locationRows={positiveLocations as import("./inventario-global-section").LocationRow[]}
      projectNameById={projectNameById}
      adminLocations={adminLocations}
      projects={projectOptions}
      movementLocations={movementLocations}
      movementProducts={movementProducts}
      movementBalances={positiveLocations.map((row) => ({
        productId: row.producto_id as string,
        locationId: row.location_id as string,
        costCurrency: (row.cost_currency as string | null) ?? null,
        quantity: Number(row.quantity),
        totalCost: row.total_cost == null ? null : Number(row.total_cost),
        costStatus: row.cost_status as "COMPUTABLE" | "REVISION_REQUERIDA",
      }))}
      movementOptionsError={locationsResult.error || productsResult.error || projectResult.error ? "No se pudieron cargar materiales, ubicaciones u obras para administrar el inventario." : null}
    />
  );
}
