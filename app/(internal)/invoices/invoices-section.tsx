"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import Link from "next/link";
import { Invoice, InvoiceStatus, Provider } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/badge";
import { formatDate, formatMoney } from "@/lib/format";
import { InvoiceDialog } from "./invoice-dialog";
import { DeleteInvoiceButton } from "./[id]/delete-button";
import { getInvoicesData, InvoicesSectionData } from "./section-action";

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

const MONTH_NAMES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

function monthLabel(m: string | null) {
  if (!m) return "Todas";
  const [year, mon] = m.split("-");
  return `${MONTH_NAMES[parseInt(mon) - 1]} ${year}`;
}

function prevMonth(m: string): string {
  const d = new Date(m + "-01");
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 7);
}

function nextMonth(m: string): string {
  const d = new Date(m + "-01");
  d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 7);
}

export function InvoicesSection({ initialData }: { initialData: InvoicesSectionData }) {
  const [invoices, setInvoices] = useState(initialData.invoices);
  const [reviewCount, setReviewCount] = useState(initialData.reviewCount);
  const [month, setMonth] = useState<string | null>(initialData.month);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [providerId, setProviderId] = useState("");
  const [status, setStatus] = useState("");
  const { providers, isAdmin } = initialData;

  // Ref para que el handler de niupack:navigate lea siempre el estado actual.
  const filtersRef = useRef({ month, q, providerId, status });
  filtersRef.current = { month, q, providerId, status };

  function buildParams(f: typeof filtersRef.current) {
    const p = new URLSearchParams();
    if (f.month === null) p.set("month", "all");
    else if (f.month) p.set("month", f.month);
    if (f.q) p.set("q", f.q);
    if (f.providerId) p.set("provider", f.providerId);
    if (f.status) p.set("status", f.status);
    return p.toString();
  }

  // Refleja filtros en la URL sin crear entradas de historial.
  useEffect(() => {
    const qs = buildParams({ month, q, providerId, status });
    window.history.replaceState({}, "", qs ? `/invoices?${qs}` : "/invoices");
  }, [month, q, providerId, status]);

  // Cuando el AppShell hace pushState("/invoices"), restaura los params.
  useEffect(() => {
    const handler = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== "/invoices") return;
      setTimeout(() => {
        const qs = buildParams(filtersRef.current);
        window.history.replaceState({}, "", qs ? `/invoices?${qs}` : "/invoices");
      }, 0);
    };
    window.addEventListener("niupack:navigate", handler);
    return () => window.removeEventListener("niupack:navigate", handler);
  }, []);

  const providerById = useMemo(
    () => new Map(providers.map((p) => [p.id, p.name])),
    [providers]
  );

  async function loadMonth(newMonth: string | null) {
    setLoading(true);
    setMonth(newMonth);
    const data = await getInvoicesData(newMonth ?? "all");
    setInvoices(data.invoices);
    setReviewCount(data.reviewCount);
    setLoading(false);
  }

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return invoices.filter((i) => {
      if (providerId && i.provider_id !== providerId) return false;
      if (status && i.status !== status) return false;
      if (term && !i.invoice_number.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [invoices, q, providerId, status]);

  const groups = STATUS_ORDER.map((s) => ({
    status: s,
    invoices: filtered.filter((i) => i.status === s),
  })).filter((g) => g.invoices.length > 0);

  return (
    <div className="max-w-5xl space-y-5">
      <div className="flex items-center justify-between mt-1">
        <h1 className="text-[17px] font-semibold">Facturas</h1>
        <div className="flex gap-2">
          {reviewCount > 0 ? (
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
          <InvoiceDialog
            providers={providers.filter((p) => p.active)}
            trigger={<Button>Nueva factura</Button>}
          />
        </div>
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3 space-y-3">
        <div>
          <Label htmlFor="inv-q">Buscar por N° de factura</Label>
          <Input
            id="inv-q"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ej: 001-001-2019"
            className="w-64"
          />
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label>Mes</Label>
            <div className="flex items-center gap-1 h-9">
              <button
                onClick={() => month && loadMonth(prevMonth(month))}
                disabled={!month || loading}
                className="h-9 w-8 rounded border border-[var(--border)] hover:bg-[var(--hover)] disabled:opacity-40 text-[var(--muted)]"
              >
                ‹
              </button>
              <span className="px-2 min-w-[130px] text-center text-[13px]">
                {loading ? "Cargando…" : monthLabel(month)}
              </span>
              <button
                onClick={() => month && loadMonth(nextMonth(month))}
                disabled={!month || loading}
                className="h-9 w-8 rounded border border-[var(--border)] hover:bg-[var(--hover)] disabled:opacity-40 text-[var(--muted)]"
              >
                ›
              </button>
              {month ? (
                <button
                  onClick={() => loadMonth(null)}
                  className="ml-1 text-[12px] text-[var(--muted)] hover:text-[var(--foreground)]"
                >
                  Ver todas
                </button>
              ) : (
                <button
                  onClick={() => loadMonth(new Date().toISOString().slice(0, 7))}
                  className="ml-1 text-[12px] text-[var(--muted)] hover:text-[var(--foreground)]"
                >
                  Mes actual
                </button>
              )}
            </div>
          </div>
          <div>
            <Label htmlFor="inv-provider">Proveedor</Label>
            <Select
              id="inv-provider"
              value={providerId}
              onChange={(e) => setProviderId((e.target as HTMLSelectElement).value)}
              className="w-52"
            >
              <option value="">Todos</option>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="inv-status">Estado</Label>
            <Select
              id="inv-status"
              value={status}
              onChange={(e) => setStatus((e.target as HTMLSelectElement).value)}
              className="w-52"
            >
              <option value="">Todos</option>
              {STATUS_ORDER.map((s) => (
                <option key={s} value={s}>{STATUS_LABELS[s]}</option>
              ))}
            </Select>
          </div>
          {(q || providerId || status) ? (
            <button
              onClick={() => { setQ(""); setProviderId(""); setStatus(""); }}
              className="text-[12px] text-[var(--muted)] pb-1.5 hover:text-[var(--foreground)]"
            >
              Limpiar filtros
            </button>
          ) : null}
          <a
            href={`/invoices/export?month=${month ?? "all"}`}
            className="text-[12px] text-[var(--muted)] pb-1.5 ml-auto hover:text-[var(--foreground)]"
          >
            Exportar CSV (contabilidad)
          </a>
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] text-center text-[var(--muted)] py-10 text-[13px]">
          {month
            ? `No hay facturas con fecha en ${monthLabel(month)}.`
            : "No hay facturas para estos filtros."}
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
              <div className="text-[12px] text-[var(--muted)]">
                {sumByCurrency(g.invoices)
                  .map(([currency, total]) =>
                    formatMoney(total, currency as Invoice["currency"])
                  )
                  .join(" · ")}
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
                    {isAdmin ? <th></th> : null}
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
                      {isAdmin ? (
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
