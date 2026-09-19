"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { FileText, Upload, Search, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { Invoice, InvoiceStatus, Provider } from "@/lib/types";
import { Button, buttonClassName } from "@/components/ui/button";
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

function getParam(key: string) {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get(key) ?? "";
}

export function InvoicesSection({ initialData }: { initialData: InvoicesSectionData }) {
  const [invoices, setInvoices] = useState(initialData.invoices);
  const [reviewCount, setReviewCount] = useState(initialData.reviewCount);
  const [month, setMonth] = useState<string | null>(initialData.month);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState(() => getParam("q"));
  const [providerId, setProviderId] = useState(() => getParam("provider"));
  const [status, setStatus] = useState(() => getParam("status"));
  const { providers, isAdmin } = initialData;

  // Esta sección queda montada (keep-alive) mientras el usuario navega a otras
  // secciones del AppShell. Cuando vuelve, el AppShell trae `initialData`
  // fresco del servidor, pero como el componente nunca se desmonta el
  // useState de arriba no lo vuelve a leer — sin este efecto se seguía
  // viendo la factura en su estado viejo (ej. "conciliada" después de
  // marcarla como apta para pago en otra pantalla).
  useEffect(() => {
    setInvoices(initialData.invoices);
    setReviewCount(initialData.reviewCount);
  }, [initialData]);

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
    // Solo la sección visible puede tocar la URL (las precargadas en
    // background también montan este efecto).
    if (window.location.pathname !== "/invoices") return;
    const qs = buildParams({ month, q, providerId, status });
    window.history.replaceState({}, "", qs ? `/invoices?${qs}` : "/invoices");
  }, [month, q, providerId, status]);

  // Cuando el AppShell hace pushState("/invoices"), restaura los params.
  useEffect(() => {
    const handler = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== "/invoices") return;
      const p = new URLSearchParams(window.location.search);
      setQ(p.get("q") ?? "");
      setProviderId(p.get("provider") ?? "");
      setStatus(p.get("status") ?? "");
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
    <div className="max-w-none space-y-4">
      <div className="flex items-end justify-between gap-4 pt-1">
        <div>
          <div className="erp-kicker mb-2">Compras</div>
          <h1 className="erp-page-title">Facturas de compra</h1>
          <p className="erp-subtitle mt-1">Controlá conciliación, revisión y pagos sin salir de la misma superficie de trabajo.</p>
        </div>
        <div className="flex gap-2">
          {reviewCount > 0 ? (
            <Link
              href="/invoices/revision"
              className={buttonClassName({ variant: "secondary", size: "sm" })}
            >
              Revisión ({reviewCount})
            </Link>
          ) : null}
          <Link
            href="/invoices/bulk"
            className={buttonClassName({ variant: "neutral", size: "sm" })}
          >
            <Upload size={14} /> Carga masiva
          </Link>
          <InvoiceDialog
            providers={providers.filter((p) => p.active)}
            trigger={<Button>+ Nueva factura</Button>}
          />
        </div>
      </div>

      <div className="erp-toolbar rounded-2xl p-3.5 space-y-3">
        <div>
          <Label htmlFor="inv-q">Buscar</Label>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)] pointer-events-none" />
          <Input
            id="inv-q"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ej: 001-001-2019"
            className="w-80 pl-8"
          />
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label>Mes</Label>
            <div className="flex items-center gap-1 h-9">
              <button
                onClick={() => month && loadMonth(prevMonth(month))}
                disabled={!month || loading}
                className="h-9 w-8 rounded-lg border border-white/[0.08] bg-white/[0.025] hover:bg-white/[0.06] disabled:opacity-40 text-[var(--muted)] transition-colors"
              >
                ‹
              </button>
              <span className="px-2 min-w-[130px] text-center text-[13px]">
                {loading ? "Cargando…" : monthLabel(month)}
              </span>
              <button
                onClick={() => month && loadMonth(nextMonth(month))}
                disabled={!month || loading}
                className="h-9 w-8 rounded-lg border border-white/[0.08] bg-white/[0.025] hover:bg-white/[0.06] disabled:opacity-40 text-[var(--muted)] transition-colors"
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
        <div className="erp-surface rounded-2xl text-center text-[var(--muted)] py-12 text-[13px]">
          {month
            ? `No hay facturas con fecha en ${monthLabel(month)}.`
            : "No hay facturas para estos filtros."}
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.status} className="space-y-2">
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
            <div className="erp-table-shell mb-4">
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
                        <div className="flex items-center gap-2.5">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#6b93ff]/20 bg-[#4f7df5]/10 text-[#8fb0ff]">
                            <FileText size={14} />
                          </span>
                          <div className="min-w-0">
                            <Link href={`/invoices/${i.id}`} className="text-action font-medium text-[#eef4ff]">
                              {i.invoice_number}
                            </Link>
                            <div className="text-[10px] text-[#6f829f] mt-0.5">Documento de compra</div>
                          </div>
                        </div>
                      </td>
                      <td className="text-[#c9d5e8]">{providerById.get(i.provider_id) ?? "-"}</td>
                      <td>{formatDate(i.invoice_date)}</td>
                      <td className="num">{formatMoney(i.total, i.currency)}</td>
                      {isAdmin ? (
                        <td>
                          <DeleteInvoiceButton
                            invoiceId={i.id}
                            compact
                            onDeleted={() => {
                              setInvoices((prev) => prev.filter((x) => x.id !== i.id));
                              loadMonth(month);
                            }}
                          />
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}
    </div>
  );
}
