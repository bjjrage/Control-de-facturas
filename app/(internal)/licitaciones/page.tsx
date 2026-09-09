import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Licitacion, LicitacionPerfil } from "@/lib/types";

import { LicitacionesSection } from "./licitaciones-section";

export default async function LicitacionesPage() {
  await requireProfile(["comercial", "administracion", "admin"]);
  const supabase = await createClient();

  const [{ data: licitaciones }, { data: perfil }] = await Promise.all([
    supabase
      .from("licitaciones")
      .select(
        "id, dncp_nro, titulo, comitente_nombre, categoria, monto_referencial, moneda, " +
          "fecha_entrega_ofertas, fecha_apertura, estado, estado_detalle, invitada, decision, synced_at"
      )
      .order("fecha_entrega_ofertas", { ascending: true, nullsFirst: false })
      .returns<Partial<Licitacion>[]>(),
    supabase
      .from("licitacion_perfil")
      .select("*")
      .maybeSingle<LicitacionPerfil>(),
  ]);

  return (
    <LicitacionesSection
      licitaciones={(licitaciones ?? []) as Partial<Licitacion>[]}
      perfil={perfil ?? null}
    />
  );
}
