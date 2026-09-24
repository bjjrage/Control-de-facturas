import { requirePlan } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getCanonicalInventorySnapshot } from "@/lib/inventory/service";
import { InventarioGlobalSection } from "./inventario-global-section";

export default async function InventarioGlobalPage() {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const supabase = await createClient();

  const [snapshot, locationsResult, productsResult] = await Promise.all([
    getCanonicalInventorySnapshot(supabase, profile.empresa_id),
    supabase
      .from("inventory_locations")
      .select("id, name, location_type, project_id")
      .eq("empresa_id", profile.empresa_id)
      .eq("active", true)
      .order("name"),
    supabase
      .from("productos")
      .select("id, nombre, unidad")
      .eq("empresa_id", profile.empresa_id)
      .eq("activo", true)
      .order("nombre")
      .limit(1000),
  ]);

  const positiveLocations = snapshot.locations.filter((r) => (r.quantity as number) > 0);
  const activeLocations = locationsResult.data ?? [];
  const projectIds = [
    ...new Set([
      ...positiveLocations.map((r) => r.project_id as string | null),
      ...activeLocations.map((r) => r.project_id as string | null),
    ].filter((id): id is string => !!id)),
  ];
  const projectNameById = new Map<string, string>();
  if (projectIds.length > 0) {
    const { data: projects } = await supabase
      .from("projects")
      .select("id, name")
      .eq("empresa_id", profile.empresa_id)
      .in("id", projectIds);
    for (const p of projects ?? []) projectNameById.set(p.id as string, p.name as string);
  }

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

  return (
    <InventarioGlobalSection
      movementAttemptStorageKey={`inventory:manual-movement:pending:${profile.empresa_id}:${profile.id}`}
      globalRows={snapshot.global as import("./inventario-global-section").GlobalRow[]}
      locationRows={positiveLocations as import("./inventario-global-section").LocationRow[]}
      projectNameById={projectNameById}
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
      movementOptionsError={locationsResult.error || productsResult.error ? "No se pudieron cargar los productos o ubicaciones para movimientos." : null}
    />
  );
}
