import { requirePlan } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getCanonicalInventorySnapshot } from "@/lib/inventory/service";
import { InventarioGlobalSection } from "./inventario-global-section";

export default async function InventarioGlobalPage() {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const supabase = await createClient();

  const { global, locations } = await getCanonicalInventorySnapshot(supabase, profile.empresa_id);

  const positiveLocations = locations.filter((r) => (r.quantity as number) > 0);
  const projectIds = [
    ...new Set(positiveLocations.map((r) => r.project_id as string | null).filter((id): id is string => !!id)),
  ];
  const projectNameById = new Map<string, string>();
  if (projectIds.length > 0) {
    const { data: projects } = await supabase.from("projects").select("id, name").in("id", projectIds);
    for (const p of projects ?? []) projectNameById.set(p.id as string, p.name as string);
  }

  return (
    <InventarioGlobalSection
      globalRows={global as import("./inventario-global-section").GlobalRow[]}
      locationRows={positiveLocations as import("./inventario-global-section").LocationRow[]}
      projectNameById={projectNameById}
    />
  );
}
