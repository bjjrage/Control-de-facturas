import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Empresa } from "@/lib/types";
import { EmpresaForm } from "./empresa-form";
import { TemplateEditor } from "./template-editor";

export default async function ConfiguracionPage() {
  const profile = await requireProfile(["admin"]);
  const supabase = await createClient();

  const { data: empresa } = await supabase
    .from("empresas")
    .select("*")
    .eq("id", profile.empresa_id)
    .single<Empresa>();

  if (!empresa) return <p className="text-[13px] text-[var(--muted)]">No se encontró la empresa.</p>;

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-[17px] font-semibold">Configuración</h1>

      <EmpresaForm empresa={empresa} />

      <div className="space-y-2">
        <h2 className="text-[15px] font-semibold">Plantillas de documentos</h2>
        <p className="text-[13px] text-[var(--muted)]">
          Subí una foto o captura de tu formato actual de cada documento.
          La IA va a generar el HTML que lo reproduce y lo vas a poder previsualizar antes de guardar.
          Una vez guardado, todos los documentos imprimibles usarán ese diseño en vez del genérico.
        </p>
      </div>

      <TemplateEditor
        docType="PROFORMA"
        label="Plantilla Proforma"
        empresaId={empresa.id}
        hasTemplate={!!empresa.template_proforma}
      />
      <TemplateEditor
        docType="REMISION"
        label="Plantilla Remisión"
        empresaId={empresa.id}
        hasTemplate={!!empresa.template_remision}
      />
      <TemplateEditor
        docType="FACTURA"
        label="Plantilla Factura"
        empresaId={empresa.id}
        hasTemplate={!!empresa.template_factura}
      />
    </div>
  );
}
