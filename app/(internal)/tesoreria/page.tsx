import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { CuentaFinanciera, MovimientoTesoreria, Project } from "@/lib/types";

import { TesoreriaSection } from "./tesoreria-section";

export default async function TesoreriaPage() {
  await requireProfile(["administracion", "admin"]);
  const supabase = await createClient();

  const [{ data: cuentas }, { data: movimientos }, { data: proyectos }] = await Promise.all([
    supabase
      .from("cuentas_financieras")
      .select("*")
      .order("activo", { ascending: false })
      .order("nombre")
      .returns<CuentaFinanciera[]>(),
    supabase
      .from("movimientos_tesoreria")
      .select("*")
      .order("fecha", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(100)
      .returns<MovimientoTesoreria[]>(),
    supabase
      .from("projects")
      .select("id, name, code, status")
      .in("status", ["ACTIVO", "PAUSADO"])
      .order("name")
      .returns<Pick<Project, "id" | "name" | "code" | "status">[]>(),
  ]);

  return (
    <TesoreriaSection
      cuentas={cuentas ?? []}
      movimientos={movimientos ?? []}
      proyectos={proyectos ?? []}
    />
  );
}
