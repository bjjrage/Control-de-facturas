"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import Link from "next/link";
import { SalesDocument, SalesDocType, Client } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Label, Select } from "@/components/ui/input";
import { formatDate, formatMoney } from "@/lib/format";
import { docSaldo, isOverdue, SALES_DOC_STATUS_LABELS, SALES_STATUS_ORDER } from "@/lib/sales";
import { getSalesListData, SalesListData } from "./sales-list-section-action";

type StatusTone = "ok" | "warn" | "neutral";
const STATUS_TONE: Record<string, StatusTone> = {
  EMITIDA: "warn",
  COBRADA_PARCIAL: "warn",
  BORRADOR: "neutral",
  COBRADA: "ok",
  ANULADA: "neutral",
};

function sumByCurrency(docs: SalesDocument[], field: "total" | "saldo") {
  const m = new Map<string, number>();
  for (const d of docs) {
    const v = field === "total" ? d.total : docSaldo(d.total, d.cobrado_amount);
    m.set(d.currency, (m.get(d.currency) ?? 0) + v);
  }
  return [...m.entries()];
}

const MONTH_NAMES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
function monthLabel(m: string | null) {
  if (!m) return "Todas";
  const [year, mon] = m.split("-");
  return `${MONTH_NAMES[parseInt(mon) - 1]} ${year}`;
}
function prevMonth(m: string) {
  const d = new Date(m + "-01"); d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 7);
}
function nextMonth(m: string) {
  const d = new Date(m + "-01"); d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 7);
}

export function SalesListSection({
  initialData,
  docType,
  basePath,
  title,
  newLabel,
}: {
  initialData: SalesListData;
  docType: SalesDocType;
  basePath: string;
  title: string;
  newLabel: string;
}) {
  const [docs, setDocs] = useState(initialData.docs);
  const [month, setMonth] = useState<string | null>(initialData.month);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [clientId, setClientId] = useState("");
  const [status, setStatus] = useState("");
  const { clients } = initialData;

  const filtersRef = useRef({ month, q, clientId, status });
  filtersRef.current = { month, q, clientId, status };

  function buildParams(f: typeof filtersRef.current) {
    const p = new URLSearchParams();
    if (f.month === null) p.set("month", "all");
    else if (f.month) p.set("month", f.month);
    if (f.q) p.set("q", f.q);
    if (f.clientId) p.set("client", f.clientId);
    if (f.status) p.set("status", f.status);
    return p.toString();
  }

  useEffect(() => {
    // Solo la sección visible puede tocar la URL (las precargadas en
    // background también montan este efecto).
    if (window.location.pathname !== basePath) return;
    const qs = buildParams({ month, q, clientId, status });
    window.history.replaceState({}, "", qs ? `${basePath}?${qs}` : basePath);
  }, [month, q, clientId, status, basePath]);

  useEffect(() => {
    const handler = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== basePath) return;
      setTimeout(() => {
        const qs = buildParams(filtersRef.current);
        window.history.replaceState({}, "", qs ? `${basePath}?${qs}` : basePath);
      }, 0);
    };
    window.addEventListener("niupack:navigate", handler);
    return () => window.removeEventListener("niupack:navigate", handler);
  }, [basePath]);

  async function loadMonth(newMonth: string | null) {
    setLoading(true);
    setMonth(newMonth);
    const data = await getSalesListData(docType, newMonth ?? "all");
    setDocs(data.docs);
    setLoading(false);
  }

  const clientById = useMemo(
    () => new Map(clients.map((c) => [c.id, c.name])),
    [clients]
  );

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return docs.filter((d) => {
      if (clientId && d.client_id !== clientId) return false;
      if (status && d.status !== status) return false;
      if (term && !d.code.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [docs, q, clientId, status]);

  const groups = SALES_STATUS_ORDER.map((s) => ({
    status: s,
    docs: filtered.filter((d) => d.status === s),
  })).filter((g) => g.docs.length > 0);

  return (
    <div className="max-w-5xl space-y-5">
      <div className="flex items-center justify-between mt-1">
        <h1 className="text-[17px] font-semibold">{title}</h1>
        <div className="flex gap-2">
          <Link
            href="/ventas/export"
            className="inline-flex items-center justify-center rounded-md border px-3 h-8 text-[13px] font-medium bg-[var(--panel)] hover:bg-[var(--hover)] border-[var(--border)]"
          >
            Exportar CSV
          </Link>
          <Link href={`${basePath}/nueva`}>
            <Button>{newLabel}</Button>
          </Link>
        </div>
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3 space-y-3">
        <div>
          <Label htmlFor={`${basePath}-q`}>Buscar por código</Label>
          <Input
            id={`${basePath}-q`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ej: V-00007"
            className="w-48"
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
              >‹</button>
              <span className="px-2 min-w-[130px] text-center text-[13px]">
                {loading ? "Cargando…" : monthLabel(month)}
              </span>
              <button
                onClick={() => month && loadMonth(nextMonth(month))}
                disabled={!month || loading}
                className="h-9 w-8 rounded border border-[var(--border)] hover:bg-[var(--hover)] disabled:opacity-40 text-[var(--muted)]"
              >›</button>
              {month ? (
                <button onClick={() => loadMonth(null)} className="ml-1 text-[12px] text-[var(--muted)] hover:text-[var(--foreground)]">
                  Ver todas
                </button>
              ) : (
                <button onClick={() => loadMonth(new Date().toISOString().slice(0, 7))} className="ml-1 text-[12px] text-[var(--muted)] hover:text-[var(--foreground)]">
                  Mes actual
                </button>
              )}
            </div>
          </div>
          <div>
            <Label htmlFor={`${basePath}-client`}>Cliente</Label>
            <Select
              id={`${basePath}-client`}
              value={clientId}
              onChange={(e) => setClientId((e.target as HTMLSelectElement).value)}
              className="w-52"
            >
              <option value="">Todos</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor={`${basePath}-status`}>Estado</Label>
            <Select
              id={`${basePath}-status`}
              value={status}
              onChange={(e) => setStatus((e.target as HTMLSelectElement).value)}
              className="w-48"
            >
              <option value="">Todos</option>
              {SALES_STATUS_ORDER.map((s) => (
                <option key={s} value={s}>{SALES_DOC_STATUS_LABELS[s]}</option>
              ))}
            </Select>
          </div>
          {(q || clientId || status) ? (
            <button
              onClick={() => { setQ(""); setClientId(""); setStatus(""); }}
              className="text-[12px] text-[var(--muted)] pb-1.5 hover:text-[var(--foreground)]"
            >
              Limpiar filtros
            </button>
          ) : null}
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] text-center text-[var(--muted)] py-10 text-[13px]">
          {month ? `No hay ${title.toLowerCase()} con fecha en ${monthLabel(month)}.` : `No hay ${title.toLowerCase()} para estos filtros.`}
        </div>
      ) : (
        groups.map((g) => (
          <div key={g.status}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Badge tone={STATUS_TONE[g.status] as StatusTone}>{SALES_DOC_STATUS_LABELS[g.status]}</Badge>
                <span className="text-[12px] text-[var(--muted)]">({g.docs.length})</span>
              </div>
              <div className="text-[12px] text-[var(--muted)]">
                {(g.status === "EMITIDA" || g.status === "COBRADA_PARCIAL"
                  ? sumByCurrency(g.docs, "saldo")
                  : sumByCurrency(g.docs, "total")
                ).map(([c, v]) => formatMoney(v, c as SalesDocument["currency"])).join(" · ")}
                {g.status === "EMITIDA" || g.status === "COBRADA_PARCIAL" ? " por cobrar" : ""}
              </div>
            </div>
            <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden mb-4">
              <table>
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>Cliente</th>
                    <th>Emisión</th>
                    <th>Vencimiento</th>
                    <th className="num">Total</th>
                    <th className="num">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {g.docs.map((d) => {
                    const saldo = docSaldo(d.total, d.cobrado_amount);
                    return (
                      <tr key={d.id}>
                        <td>
                          <Link href={`/ventas/${d.id}`} className="text-action font-medium">
                            {d.code}
                          </Link>
                        </td>
                        <td>{clientById.get(d.client_id) ?? "-"}</td>
                        <td>{formatDate(d.issue_date)}</td>
                        <td className={isOverdue(d.due_date, d.status) ? "text-[var(--error)]" : ""}>
                          {d.due_date ? formatDate(d.due_date) : "-"}
                        </td>
                        <td className="num">{formatMoney(d.total, d.currency)}</td>
                        <td className="num">{formatMoney(saldo, d.currency)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
