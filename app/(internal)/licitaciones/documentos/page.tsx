import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { EmpresaDocumento } from "@/lib/types";

import { DocumentosSection } from "./documentos-section";

export default async function DocumentosEmpresaPage() {
  await requireProfile(["comercial", "administracion", "admin"]);
  const supabase = await createClient();

  const { data: docs } = await supabase
    .from("empresa_documentos")
    .select("*")
    .order("fecha_vencimiento", { ascending: true, nullsFirst: false })
    .returns<EmpresaDocumento[]>();

  return <DocumentosSection documentos={docs ?? []} />;
}
