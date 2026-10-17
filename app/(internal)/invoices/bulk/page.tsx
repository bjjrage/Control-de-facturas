import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { BulkUploadForm } from "./bulk-form";

export default async function BulkInvoicesPage() {
  const profile = await requireProfile(["administracion", "admin"]);

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <Link href="/invoices" className="text-action text-[12px] text-[var(--muted)]">
          ← Volver a Facturas
        </Link>
        <h1 className="text-[17px] font-semibold mt-1">Carga masiva de facturas<InfoTooltip className="ml-1" label="Carga masiva de facturas" content="Subí fotos de facturas en papel o PDF. Se procesan en segundo plano, se identifica al proveedor por RUC y se concilian con órdenes cuando coincide el monto. Lo ilegible queda en Revisión manual. Solo admite PYG." /></h1>
      </div>
      <BulkUploadForm empresaId={profile.empresa_id} userId={profile.id} />
    </div>
  );
}
