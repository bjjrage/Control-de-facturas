"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Client, SalesDocument, SalesDocumentItem, SalesDocType, CurrencyCode } from "@/lib/types";
import { formatMoney } from "@/lib/format";
import { lineTotal, splitVat, SALES_DOC_TYPE_LABELS } from "@/lib/sales";

type Row = { description: string; quantity: string; unit_price: string; vat_rate: 0 | 5 | 10 };

const emptyRow: Row = { description: "", quantity: "1", unit_price: "", vat_rate: 10 };

export function SalesForm({
  clients,
  defaultClientId,
  doc,
  items,
  action,
}: {
  clients: Pick<Client, "id" | "name">[];
  defaultClientId?: string;
  doc?: SalesDocument;
  items?: SalesDocumentItem[];
  action: (formData: FormData) => Promise<{ error: string | null; id?: string }>;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [rows, setRows] = useState<Row[]>(
    items && items.length
      ? items.map((i) => ({
          description: i.description,
          quantity: String(i.quantity),
          unit_price: String(i.unit_price),
          vat_rate: i.vat_rate,
        }))
      : [{ ...emptyRow }]
  );

  const totals = useMemo(() => {
    let neto = 0;
    let iva = 0;
    let total = 0;
    for (const r of rows) {
      const q = Number(r.quantity);
      const p = Number(r.unit_price);
      if (!Number.isFinite(q) || !Number.isFinite(p) || q <= 0 || p < 0) continue;
      const lt = lineTotal(q, p);
      const s = splitVat(lt, r.vat_rate);
      neto += s.neto;
      iva += s.iva;
      total += lt;
    }
    return { neto, iva, total };
  }, [rows]);

  function setRow(i: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  return (
    <form
      className="space-y-4"
      action={async (formData: FormData) => {
        formData.set(
          "items",
          JSON.stringify(
            rows.map((r) => ({
              description: r.description.trim(),
              quantity: Number(r.quantity),
              unit_price: Number(r.unit_price),
              vat_rate: r.vat_rate,
            }))
          )
        );
        setPending(true);
        const result = await action(formData);
        setPending(false);
        if (result?.error) {
          setError(result.error);
          return;
        }
        router.push(`/ventas/${result.id}`);
      }}
    >
      {error ? (
        <div className="rounded border border-[var(--error)]/30 bg-[var(--error-bg)] px-2.5 py-1.5 text-[12px] text-[var(--error)]">
          {error}
        </div>
      ) : null}

      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="client_id">Cliente</Label>
          <Select id="client_id" name="client_id" required defaultValue={doc?.client_id ?? defaultClientId ?? ""}>
            <option value="" disabled>
              Elegí un cliente
            </option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="doc_type">Tipo de documento</Label>
          <Select id="doc_type" name="doc_type" defaultValue={(doc?.doc_type ?? "NOTA_VENTA") as SalesDocType}>
            {(Object.keys(SALES_DOC_TYPE_LABELS) as SalesDocType[]).map((t) => (
              <option key={t} value={t}>
                {SALES_DOC_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="issue_date">Fecha de emisión</Label>
          <Input
            id="issue_date"
            name="issue_date"
            type="date"
            defaultValue={doc?.issue_date ?? new Date().toISOString().slice(0, 10)}
          />
        </div>
        <div>
          <Label htmlFor="due_date">Vencimiento</Label>
          <Input id="due_date" name="due_date" type="date" defaultValue={doc?.due_date ?? ""} />
        </div>
        <div>
          <Label htmlFor="currency">Moneda</Label>
          <Select id="currency" name="currency" defaultValue={(doc?.currency ?? "PYG") as CurrencyCode}>
            {(["PYG", "USD", "EUR", "BRL", "ARS"] as CurrencyCode[]).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-[14px] font-semibold">Ítems</h2>
          <span className="text-[11px] text-[var(--muted)]">Precio unitario con IVA incluido</span>
        </div>
        <div className="space-y-2">
          {rows.map((r, i) => {
            const lt = lineTotal(Number(r.quantity) || 0, Number(r.unit_price) || 0);
            return (
              <div key={i} className="grid grid-cols-[1fr_80px_130px_90px_120px_32px] gap-2 items-end">
                <div>
                  {i === 0 ? <Label>Descripción</Label> : null}
                  <Input value={r.description} onChange={(e) => setRow(i, { description: e.target.value })} required />
                </div>
                <div>
                  {i === 0 ? <Label>Cant.</Label> : null}
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={r.quantity}
                    onChange={(e) => setRow(i, { quantity: e.target.value })}
                  />
                </div>
                <div>
                  {i === 0 ? <Label>Precio unit.</Label> : null}
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={r.unit_price}
                    onChange={(e) => setRow(i, { unit_price: e.target.value })}
                  />
                </div>
                <div>
                  {i === 0 ? <Label>IVA</Label> : null}
                  <Select
                    value={String(r.vat_rate)}
                    onChange={(e) => setRow(i, { vat_rate: Number(e.target.value) as 0 | 5 | 10 })}
                  >
                    <option value="10">10%</option>
                    <option value="5">5%</option>
                    <option value="0">Exenta</option>
                  </Select>
                </div>
                <div className="text-[13px] num pb-2 text-right">{formatMoney(lt, (doc?.currency ?? "PYG") as CurrencyCode)}</div>
                <button
                  type="button"
                  onClick={() => setRows((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev))}
                  className="h-9 text-[var(--muted)] hover:text-[var(--error)]"
                  aria-label="Quitar ítem"
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => setRows((prev) => [...prev, { ...emptyRow }])}
          className="mt-2 text-[12px] text-[var(--primary)] hover:underline"
        >
          + Agregar ítem
        </button>

        <div className="mt-4 ml-auto w-64 text-[13px] border-t border-[var(--border)] pt-3 space-y-1">
          <div className="flex justify-between text-[var(--muted)]">
            <span>Neto gravado</span>
            <span className="num">{formatMoney(totals.neto, (doc?.currency ?? "PYG") as CurrencyCode)}</span>
          </div>
          <div className="flex justify-between text-[var(--muted)]">
            <span>IVA</span>
            <span className="num">{formatMoney(totals.iva, (doc?.currency ?? "PYG") as CurrencyCode)}</span>
          </div>
          <div className="flex justify-between font-semibold text-[15px]">
            <span>Total</span>
            <span className="num">{formatMoney(totals.total, (doc?.currency ?? "PYG") as CurrencyCode)}</span>
          </div>
        </div>
      </div>

      <div>
        <Label htmlFor="notes">Observaciones</Label>
        <Textarea id="notes" name="notes" defaultValue={doc?.notes ?? ""} />
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={() => router.back()}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Guardando…" : doc ? "Guardar cambios" : "Crear borrador"}
        </Button>
      </div>
    </form>
  );
}
