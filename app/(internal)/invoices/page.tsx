import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Invoice, InvoiceStatus, Provider } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/badge";
import { formatDate, formatMoney } from "@/lib/format";
import { currentMonth, monthRange } from "@/lib/month-range";
import { InvoiceDialog } from "./invoice-dialog";
import { MonthFilter } from "./month-filter";
import { ReconcileButton } from "./reconcile-button";
import { DeleteInvoiceButton } from "./[id]/delete-button";
import { BackButton } from "@/components/ui/back-button";
import { LinkOrderDialog } from "./link-order-dialog";

// The "Nueva factura" dialog on this page reads photos/PDFs via OpenAI/pdf-parse,
// which can outlast the platform's default serverless timeout (10s on Vercel's
// Hobby plan).
export const maxDuration = 60;

// Orden de prioridad para la gestión mensual: lo que necesita acción primero,
// lo ya resuelto al final.
const STATUS_ORDER: InvoiceStatus[] = [
  "REQUIERE_REVISION",
  "PENDIENTE",
  "MATCH",
  "APROBADO_EXCEPCION",
  "APTO_PARA_PAGO",
  "PAGADO",
];

const STATUS_LABELS: Record<InvoiceStatus, string> = {
  REQUIERE_REVISION: "Requieren revisión",
  PENDIENTE: "Pendientes de vincular",
  MATCH: "Conciliadas (listas para aprobar pago)",
  APROBADO_EXCEPCION: "Aprobadas por excepción",
  APTO_PARA_PAGO: "Aptas para pago",
  PAGADO: "Pagadas",
};

function sumByCurrency(invoices: Invoice[]) {
  const sums = new Map<string, number>();
  for (const inv of invoices) sums.set(inv.currency, (sums.get(inv.currency) ?? 0) + inv.total);
  return [...sums.entries()];
}

type Filters = {
  month?: string;
  q?: string;
  provider?: string;
  status?: string;
};

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<Filters> }) {
  const profile = await requireProfile(["administracion", "admin"]);
  const supabase = await createClient();
  const { month: monthParam, q, provider: providerId, status } = await searchParams;
  const month = monthParam === "all" ? null : monthParam || currentMonth();

  const { data: providers } = await supabase.from("providers").select("*").order("name").returns<Provider[]>();
  const providerById = new Map((providers ?? []).map((p) => [p.id, p.name]));

  let query = supabase.from("invoices").select("*").order("invoice_date", { ascending: false });
  if (month) {
    const { start, end } = monthRange(month);
    query = query.gte("invoice_date", start).lt("invoice_date", end);
  }
  if (q?.trim()) query = query.ilike("invoice_number", `%${q.trim().replace(/[%,]/g, "")}%`);
  if (providerId) query = query.eq("provider_id", providerId);
  if (status) query = query.eq("status", status);

  const [{ data: invoices }, { count: reviewCount }] = await Promise.all([
    query.returns<Invoice[]>(),
    supabase.from("invoice_jobs").select("id", { count: "exact", head: true }).in("status", ["needs_review", "failed"]),
  ]);

  // Si el mes elegido no tiene nada, avisamos cuántas facturas hay fuera de ese
  // mes: el filtro va por fecha de factura, así que lo recién cargado "desaparece"
  // si la factura es de otro mes.
  let outsideMonthCount = 0;
  if (month && (invoices ?? []).length === 0) {
    let outside = supabase.from("invoices").select("id", { count: "exact", head: true });
    if (q?.trim()) outside = outside.ilike("invoice_number", `%${q.trim().replace(/[%,]/g, "")}%`);
    if (providerId) outside = outside.eq("provider_id", providerId);
    if (status) outside = outside.eq("status", status);
    const { count } = await outside;
    outsideMonthCount = count ?? 0;
  }
  const hasExtraFilters = !!(q || providerId || status);

  function withParams(overrides: Partial<Filters>) {
    const params = new URLSearchParams();
    const merged = { month: monthParam, q, provider: providerId, status, ...overrides };
    for (const [key, value] of Object.entries(merged)) {
      if (value) params.set(key, value);
    }
    const qs = params.toString();
    return qs ? `/invoices?${qs}` : "/invoices";
  }

  const groups = STATUS_ORDER.map((s) => ({
    status: s,
    invoices: (invoices ?? []).filter((i) => i.status === s),
  })).filter((g) => g.invoices.length > 0);

  return (
    <div className="max-w-5xl space-y-5">
      <BackButton />
      <div className="flex items-center justify-between mt-1">
        <h1 className="text-[17px] font-semibold">Facturas</h1>
        <div className="flex gap-2">
          {reviewCount && reviewCount > 0 ? (
            <Link
              href="/invoices/revision"
              className="inline-flex items-center justify-center gap-1.5 rounded-md border px-3 h-8 text-[13px] font-medium transition-colors bg-[var(--warn-bg)] text-[var(--warn)] border-transparent hover:opacity-80"
            >
              Revisión ({reviewCount})
            </Link>
          ) : null}
          <Link
            href="/invoices/bulk"
            className="inline-flex items-center justify-center gap-1.5 rounded-md border px-3 h-8 text-[13px] font-medium transition-colors bg-[var(--panel)] text-[var(--foreground)] hover:bg-[var(--hover)] border-[var(--border)]"
          >
            Carga masiva
          </Link>
          <InvoiceDialog providers={(providers ?? []).filter((p) => p.active)} trigger={<Button>Nueva factura</Button>} />
        </div>
      </div>

      <form className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3 space-y-3" method="get">
        <div>
          <Label htmlFor="q">Buscar por N° de factura</Label>
          <Input id="q" name="q" defaultValue={q ?? ""} placeholder="ej: 001-001-2019" className="w-64" />
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <MonthFilter month={month} />
          <div>
            <Label htmlFor="provider">Proveedor</Label>
            <Select id="provider" name="provider" defaultValue={providerId ?? ""} className="w-52">
              <option value="">Todos</option>
              {(providers ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="status">Estado</Label>
            <Select id="status" name="status" defaultValue={status ?? ""} className="w-52">
              <option value="">Todos</option>
              {STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
          </div>
          <Button type="submit" variant="secondary">
            Filtrar
          </Button>
          {hasExtraFilters ? (
            <Link
              href={withParams({ q: undefined, provider: undefined, status: undefined })}
              className="text-action text-[12px] text-[var(--muted)] pb-1.5"
            >
              Limpiar proveedor/estado/búsqueda
            </Link>
          ) : null}
          <a
            href={`/invoices/export?month=${month ?? "all"}`}
            className="text-action text-[12px] text-[var(--muted)] pb-1.5 ml-auto"
          >
            Exportar CSV (contabilidad)
          </a>
        </div>
      </form>

      {groups.length === 0 ? (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] text-center text-[var(--muted)] py-10 text-[13px]">
          {month ? `No hay facturas con fecha en ${month}.` : "No hay facturas para estos filtros."}
          {outsideMonthCount > 0 ? (
            <div className="mt-2">
              Hay {outsideMonthCount} factura{outsideMonthCount === 1 ? "" : "s"} en otros meses.{" "}
              <Link href={withParams({ month: "all" })} className="text-action text-[var(--primary)]">
                Ver todas
              </Link>
            </div>
          ) : null}
        </div>
      ) : (
        groups.map((g) => (
          <div key={g.status}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <StatusBadge status={g.status} />
                <h2 className="text-[13px] font-semibold">{STATUS_LABELS[g.status]}</h2>
                <span className="text-[12px] text-[var(--muted)]">({g.invoices.length})</span>
              </div>
              <div className="flex items-center gap-3">
                {g.status === "PENDIENTE" ? <ReconcileButton /> : null}
                <div className="text-[12px] text-[var(--muted)]">
                  {sumByCurrency(g.invoices)
                    .map(([currency, total]) => formatMoney(total, currency as Invoice["currency"]))
                    .join(" · ")}
                </div>
              </div>
            </div>
            <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden mb-4">
              <table>
                <thead>
                  <tr>
                    <th>N° factura</th>
                    <th>Proveedor</th>
                    <th>Fecha</th>
                    <th className="num">Total</th>
                    {g.status === "PENDIENTE" ? <th></th> : null}
                    {profile.role === "admin" ? <th></th> : null}
                  </tr>
                </thead>
                <tbody>
                  {g.invoices.map((i) => (
                    <tr key={i.id}>
                      <td>
                        <Link href={`/invoices/${i.id}`} className="text-action font-medium">
                          {i.invoice_number}
                        </Link>
                      </td>
                      <td>{providerById.get(i.provider_id) ?? "-"}</td>
                      <td>{formatDate(i.invoice_date)}</td>
                      <td className="num">{formatMoney(i.total, i.currency)}</td>
                      {g.status === "PENDIENTE" ? (
                        <td>
                          <LinkOrderDialog
                            invoiceId={i.id}
                            trigger={
                              <button className="text-action text-[12px] text-[var(--primary)]">
                                Vincular OC →
                              </button>
                            }
                          />
                        </td>
                      ) : null}
                      {profile.role === "admin" ? (
                        <td>
                          <DeleteInvoiceButton invoiceId={i.id} compact />
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
