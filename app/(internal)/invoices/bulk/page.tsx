import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { BulkUploadForm } from "./bulk-form";

export default async function BulkInvoicesPage() {
  const profile = await requireProfile(["administracion", "admin"]);

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <Link href="/invoices" className="text-[12px] text-[var(--muted)] hover:underline">
          ← Volver a Facturas
        </Link>
        <h1 className="text-[17px] font-semibold mt-1">Carga masiva de facturas</h1>
        <p className="text-[13px] text-[var(--muted)] mt-1">
          Juntá todas las facturas del cierre en una carpeta — foto (tipo CamScanner) para las de papel, PDF para
          las electrónicas — y soltalas todas juntas acá. Se suben y se procesan en segundo plano: el sistema lee
          cada una, identifica al proveedor por RUC y la concilia sola contra las órdenes con saldo cuando el monto
          coincide. Las que no puede leer del todo quedan en{" "}
          <Link href="/invoices/revision" className="text-[var(--primary)] hover:underline">
            revisión manual
          </Link>
          . Solo en guaraníes (PYG) — para otras monedas usá &quot;Nueva factura&quot; una por una.
        </p>
      </div>
      <BulkUploadForm empresaId={profile.empresa_id} userId={profile.id} />
    </div>
  );
}
