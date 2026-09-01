import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { BulkUploadForm } from "./bulk-form";

// Reading one invoice (OpenAI vision, or PDF text) can take longer than the
// platform's default serverless timeout (10s on Vercel's Hobby plan) — this
// applies to the server actions this page's form calls.
export const maxDuration = 60;

export default async function BulkInvoicesPage() {
  await requireProfile(["administracion", "admin"]);

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <Link href="/invoices" className="text-[12px] text-[var(--muted)] hover:underline">
          ← Volver a Facturas
        </Link>
        <h1 className="text-[17px] font-semibold mt-1">Carga masiva de facturas</h1>
        <p className="text-[13px] text-[var(--muted)] mt-1">
          Juntá todas las facturas del cierre de esta semana/quincena/mes en una carpeta — foto (tipo CamScanner)
          para las de papel, PDF para las electrónicas — y soltalas todas juntas acá. El sistema lee cada una
          (por visión si es foto, por el texto real si es PDF), identifica al proveedor por RUC y la concilia
          sola contra las órdenes autorizadas pendientes cuando el monto coincide. Solo en guaraníes (PYG) — para
          otras monedas usá &quot;Nueva factura&quot; una por una.
        </p>
      </div>
      <BulkUploadForm />
    </div>
  );
}
