import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { InvoiceJob, Provider } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatMoney } from "@/lib/format";
import { RevisionDialog } from "./revision-dialog";
import { retryInvoiceJob, discardInvoiceJob } from "./actions";

export default async function RevisionPage() {
  await requireProfile(["administracion", "admin"]);
  const supabase = await createClient();

  const [{ data: jobs }, { data: providers }] = await Promise.all([
    supabase
      .from("invoice_jobs")
      .select("*")
      .in("status", ["needs_review", "failed"])
      .order("created_at", { ascending: false })
      .returns<InvoiceJob[]>(),
    supabase.from("providers").select("*").eq("active", true).order("name").returns<Provider[]>(),
  ]);

  return (
    <div className="max-w-4xl space-y-4">
      <div>
        <Link href="/invoices" className="text-action text-[12px] text-[var(--muted)]">
          ← Volver a Facturas
        </Link>
        <h1 className="text-[17px] font-semibold mt-1">Revisión manual</h1>
        <p className="text-[13px] text-[var(--muted)] mt-1">
          Facturas del bulk que el sistema no pudo leer del todo (proveedor no identificado, número o monto
          ilegible, o un error al procesar). Completá los datos y creá la factura, o descartá el archivo.
        </p>
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
        <table>
          <thead>
            <tr>
              <th>Archivo</th>
              <th>Proveedor detectado</th>
              <th className="num">Total</th>
              <th>Motivo</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(jobs ?? []).map((j) => (
              <tr key={j.id}>
                <td className="font-medium">{j.file_name}</td>
                <td>{j.extracted?.provider_name ?? "-"}</td>
                <td className="num">{j.extracted?.total ? formatMoney(j.extracted.total, "PYG") : "-"}</td>
                <td className="text-[12px] text-[var(--muted)]">
                  <Badge tone={j.status === "failed" ? "error" : "warn"}>
                    {j.status === "failed" ? "Error" : "Incompleta"}
                  </Badge>{" "}
                  {j.message ?? j.error}
                  <div className="text-[11px] mt-0.5">{formatDate(j.created_at)}</div>
                </td>
                <td>
                  <div className="flex items-center justify-end gap-1">
                    <RevisionDialog
                      job={j}
                      providers={providers ?? []}
                    />
                    {j.status === "failed" ? (
                      <form
                        action={async () => {
                          "use server";
                          await retryInvoiceJob(j.id);
                        }}
                      >
                        <Button variant="ghost" className="h-6 px-2 text-[12px]" type="submit">
                          Reintentar
                        </Button>
                      </form>
                    ) : null}
                    <form
                      action={async () => {
                        "use server";
                        await discardInvoiceJob(j.id);
                      }}
                    >
                      <Button variant="ghost" className="h-6 px-2 text-[12px] text-[var(--error)]" type="submit">
                        Descartar
                      </Button>
                    </form>
                  </div>
                </td>
              </tr>
            ))}
            {(jobs ?? []).length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center text-[var(--muted)] py-6">
                  Nada para revisar. 🎉
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
