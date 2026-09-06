"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import Link from "next/link";
import { Client, CurrencyCode, SalesDocument } from "@/lib/types";
import { docSaldo, SALES_DOC_TYPE_LABELS } from "@/lib/sales";
import { formatDate, formatMoney } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { ReceiptDialog } from "@/app/(internal)/ventas/[id]/receipt-dialog";
import { CobrosSectionData } from "./section-action";

function daysDiff(dateStr: string): number {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const d = new Date(dateStr);
  d.setHours(0, 0, 0, 0);
  return Math.round((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
}

function getParam(key: string) {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get(key) ?? "";
}

export function CobrosSection({ initialData }: { initialData: CobrosSectionData }) {
  const { docs, clients } = initialData;
  const [clientFilter, setClientFilter] = useState(() => getParam("client"));
  const [statusFilter, setStatusFilter] = useState(() => getParam("status"));
  const [qFilter, setQFilter] = useState(() => getParam("q"));
  const [fromFilter, setFromFilter] = useState(() => getParam("from"));
  const [toFilter, setToFilter] = useState(() => getParam("to"));

  const filtersRef = useRef({ clientFilter, statusFilter, qFilter, fromFilter, toFilter });
  filtersRef.current = { clientFilter, statusFilter, qFilter, fromFilter, toFilter };

  function buildParams(f: typeof filtersRef.current) {
    const p = new URLSearchParams();
    if (f.clientFilter) p.set("client", f.clientFilter);
    if (f.statusFilter) p.set("status", f.statusFilter);
    if (f.qFilter) p.set("q", f.qFilter);
    if (f.fromFilter) p.set("from", f.fromFilter);
    if (f.toFilter) p.set("to", f.toFilter);
    return p.toString();
  }

  useEffect(() => {
    // Solo la sección visible puede tocar la URL (las precargadas en
    // background también montan este efecto).
    if (window.location.pathname !== "/cobros") return;
    const qs = buildParams({ clientFilter, statusFilter, qFilter, fromFilter, toFilter });
    window.history.replaceState({}, "", qs ? `/cobros?${qs}` : "/cobros");
  }, [clientFilter, statusFilter, qFilter, fromFilter, toFilter]);

  useEffect(() => {
    const handler = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== "/cobros") return;
      const p = new URLSearchParams(window.location.search);
      setClientFilter(p.get("client") ?? "");
      setStatusFilter(p.get("status") ?? "");
      setQFilter(p.get("q") ?? "");
      setFromFilter(p.get("from") ?? "");
      setToFilter(p.get("to") ?? "");
      setTimeout(() => {
        const qs = buildParams(filtersRef.current);
        window.history.replaceState({}, "", qs ? `/cobros?${qs}` : "/cobros");
      }, 0);
    };
    window.addEventListener("niupack:navigate", handler);
    return () => window.removeEventListener("niupack:navigate", handler);
  }, []);

  const today = new Date().toISOString().slice(0, 10);
  const clientById = useMemo(() => new Map(clients.map((c) => [c.id, c.name])), [clients]);

  const filtered = useMemo(() => {
    const term = qFilter.trim().toLowerCase();
    return docs.filter((d) => {
      if (clientFilter && d.client_id !== clientFilter) return false;
      if (statusFilter && d.status !== statusFilter) return false;
      if (fromFilter && d.issue_date.slice(0, 10) < fromFilter) return false;
      if (toFilter && d.issue_date.slice(0, 10) > toFilter) return false;
      if (term && !d.code.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [docs, clientFilter, statusFilter, qFilter, fromFilter, toFilter]);

  const overdueDocs = useMemo(
    () => filtered.filter((d) => d.due_date && d.due_date < today).sort((a, b) => a.due_date!.localeCompare(b.due_date!)),
    [filtered, today]
  );
  const upcomingDocs = useMemo(
    () =>
      filtered
        .filter((d) => !d.due_date || d.due_date >= today)
        .sort((a, b) => {
          if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date);
          if (a.due_date) return -1;
          if (b.due_date) return 1;
          return 0;
        }),
    [filtered, today]
  );

  const aging = useMemo(() => {
    type AgingRow = { clientId: string; clientName: string; currency: CurrencyCode; corriente: number; b130: number; b3160: number; b60plus: number };
    const agingMap = new Map<string, AgingRow>();
    for (const d of docs) {
      const saldo = docSaldo(d.total, d.cobrado_amount);
      if (saldo <= 0) continue;
      const key = `${d.client_id}|${d.currency}`;
      if (!agingMap.has(key)) {
        agingMap.set(key, { clientId: d.client_id, clientName: clientById.get(d.client_id) ?? "—", currency: d.currency, corriente: 0, b130: 0, b3160: 0, b60plus: 0 });
      }
      const row = agingMap.get(key)!;
      if (!d.due_date || d.due_date >= today) {
        row.corriente += saldo;
      } else {
        const days = daysDiff(d.due_date);
        if (days <= 30) row.b130 += saldo;
        else if (days <= 60) row.b3160 += saldo;
        else row.b60plus += saldo;
      }
    }
    return [...agingMap.values()].sort((a, b) => a.clientName.localeCompare(b.clientName));
  }, [docs, clientById, today]);

  const totalPorCobrar = filtered.reduce((sum, d) => sum + docSaldo(d.total, d.cobrado_amount), 0);

  function renderRow(d: SalesDocument) {
    const saldo = docSaldo(d.total, d.cobrado_amount);
    const overdue = d.due_date && d.due_date < today;
    const days = d.due_date ? daysDiff(d.due_date) : null;
    return (
      <tr key={d.id}>
        <td><Link href={`/ventas/${d.id}`} className="text-action font-medium">{d.code}</Link></td>
        <td>{clientById.get(d.client_id) ?? "—"}</td>
        <td>{SALES_DOC_TYPE_LABELS[d.doc_type]}</td>
        <td>{formatDate(d.issue_date)}</td>
        <td className={overdue ? "text-[var(--error)]" : ""}>
          {d.due_date ? (
            <>{formatDate(d.due_date)}{overdue && days !== null ? <span className="ml-1 text-[11px]">({days}d atraso)</span> : null}</>
          ) : "—"}
        </td>
        <td className="num">{formatMoney(d.total, d.currency)}</td>
        <td className={`num font-semibold ${overdue ? "text-[var(--error)]" : ""}`}>{formatMoney(saldo, d.currency)}</td>
        <td><Badge tone={d.status === "COBRADA_PARCIAL" ? "warn" : "neutral"}>{d.status === "COBRADA_PARCIAL" ? "Parcial" : "Emitida"}</Badge></td>
        <td>
          <ReceiptDialog docId={d.id} saldo={saldo} currency={d.currency as CurrencyCode} trigger={<Button variant="secondary">+ Cobro</Button>} />
        </td>
      </tr>
    );
  }

  const hasFilters = !!(clientFilter || statusFilter || qFilter || fromFilter || toFilter);

  return (
    <div className="max-w-6xl space-y-5">
      <div className="flex items-center justify-between mt-1">
        <div>
          <h1 className="text-[17px] font-semibold">Cobros pendientes</h1>
          <p className="text-[13px] text-[var(--muted)] mt-0.5">
            {filtered.length} documento{filtered.length !== 1 ? "s" : ""} por cobrar
            {filtered.length > 0 && filtered.every((d) => d.currency === filtered[0].currency)
              ? ` · ${formatMoney(totalPorCobrar, filtered[0].currency)} total`
              : ""}
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="cob-q">Buscar</Label>
            <Input
              id="cob-q"
              type="search"
              placeholder="Código…"
              value={qFilter}
              onChange={(e) => setQFilter((e.target as HTMLInputElement).value)}
              className="w-44"
            />
          </div>
          <div>
            <Label htmlFor="cob-client">Cliente</Label>
            <Select
              id="cob-client"
              value={clientFilter}
              onChange={(e) => setClientFilter((e.target as HTMLSelectElement).value)}
              className="w-52"
            >
              <option value="">Todos</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="cob-status">Estado</Label>
            <Select
              id="cob-status"
              value={statusFilter}
              onChange={(e) => setStatusFilter((e.target as HTMLSelectElement).value)}
              className="w-36"
            >
              <option value="">Todos</option>
              <option value="EMITIDA">Emitida</option>
              <option value="COBRADA_PARCIAL">Pago parcial</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="cob-from">Emisión desde</Label>
            <Input
              id="cob-from"
              type="date"
              value={fromFilter}
              onChange={(e) => setFromFilter((e.target as HTMLInputElement).value)}
              className="w-36"
            />
          </div>
          <div>
            <Label htmlFor="cob-to">Emisión hasta</Label>
            <Input
              id="cob-to"
              type="date"
              value={toFilter}
              onChange={(e) => setToFilter((e.target as HTMLInputElement).value)}
              className="w-36"
            />
          </div>
          {hasFilters ? (
            <button
              onClick={() => { setClientFilter(""); setStatusFilter(""); setQFilter(""); setFromFilter(""); setToFilter(""); }}
              className="text-[12px] text-[var(--muted)] pb-1.5 hover:text-[var(--foreground)]"
            >
              Limpiar
            </button>
          ) : null}
        </div>
      </div>

      {overdueDocs.length > 0 ? (
        <div>
          <h2 className="text-[14px] font-semibold text-[var(--error)] mb-2">Vencidas ({overdueDocs.length})</h2>
          <div className="rounded-lg border border-[var(--error)]/30 bg-[var(--panel)] overflow-hidden">
            <table>
              <thead><tr><th>Código</th><th>Cliente</th><th>Tipo</th><th>Emisión</th><th>Vencimiento</th><th className="num">Total</th><th className="num">Saldo</th><th>Estado</th><th></th></tr></thead>
              <tbody>{overdueDocs.map(renderRow)}</tbody>
            </table>
          </div>
        </div>
      ) : null}

      {upcomingDocs.length > 0 ? (
        <div>
          <h2 className="text-[14px] font-semibold mb-2">Por cobrar ({upcomingDocs.length})</h2>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
            <table>
              <thead><tr><th>Código</th><th>Cliente</th><th>Tipo</th><th>Emisión</th><th>Vencimiento</th><th className="num">Total</th><th className="num">Saldo</th><th>Estado</th><th></th></tr></thead>
              <tbody>{upcomingDocs.map(renderRow)}</tbody>
            </table>
          </div>
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] py-12 text-center text-[13px] text-[var(--muted)]">
          No hay documentos pendientes de cobro.
        </div>
      ) : null}

      {aging.length > 0 ? (
        <div>
          <h2 className="text-[14px] font-semibold mb-2">Antigüedad de saldos</h2>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
            <table>
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th className="num">Corriente</th>
                  <th className="num">1-30 días</th>
                  <th className="num">31-60 días</th>
                  <th className="num">+60 días</th>
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {aging.map((row) => {
                  const total = row.corriente + row.b130 + row.b3160 + row.b60plus;
                  return (
                    <tr key={`${row.clientId}|${row.currency}`}>
                      <td>
                        <Link href={`/clientes/${row.clientId}`} className="text-action">{row.clientName}</Link>
                        <span className="ml-1 text-[11px] text-[var(--muted)]">{row.currency}</span>
                      </td>
                      <td className="num">{row.corriente > 0 ? formatMoney(row.corriente, row.currency) : "—"}</td>
                      <td className={`num ${row.b130 > 0 ? "text-[var(--warn)]" : ""}`}>{row.b130 > 0 ? formatMoney(row.b130, row.currency) : "—"}</td>
                      <td className={`num ${row.b3160 > 0 ? "text-[var(--warn)]" : ""}`}>{row.b3160 > 0 ? formatMoney(row.b3160, row.currency) : "—"}</td>
                      <td className={`num ${row.b60plus > 0 ? "text-[var(--error)]" : ""}`}>{row.b60plus > 0 ? formatMoney(row.b60plus, row.currency) : "—"}</td>
                      <td className="num font-semibold">{formatMoney(total, row.currency)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
