import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PaymentOrder, Provider } from "@/lib/types";
import { BackButton } from "@/components/ui/back-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label, Select } from "@/components/ui/input";
import { formatDate, formatMoney } from "@/lib/format";

type Filters = { status?: string; provider?: string };

const STATUS_TONE = { EMITIDA: "warn", EJECUTADA: "ok" } as const;
const STATUS_LABELS = { EMITIDA: "Emitida", EJECUTADA: "Ejecutada" };

export default async function PagosPage({ searchParams }: { searchParams: Promise<Filters> }) {
  await requireProfile(["administracion", "admin"]);
  const supabase = await createClient();
  const { status, provider: providerId } = await searchParams;

  const [{ data: ops }, { data: providers }, { data: opInvoiceRows }] = await Promise.all([
    supabase.from("payment_orders").select("*").order("created_at", { ascending: false }).returns<PaymentOrder[]>(),
    supabase.from("providers").select("id, name").eq("active", true).order("name").returns<Pick<Provider, "id" | "name">[]>(),
    supabase.from("payment_order_invoices").select("payment_order_id, invoices(total, currency)"),
  ]);

  const providerById = new Map((providers ?? []).map((p) => [p.id, p.name]));

  // Compute per-OP totals and counts
  type TotalsMap = Map<string, { count: number; byCurrency: Map<string, number> }>;
  const totalsMap: TotalsMap = new Map();
  for (const row of opInvoiceRows ?? []) {
    const opId = row.payment_order_id as string;
    const inv = row.invoices as { total: number; currency: string } | null;
    if (!totalsMap.has(opId)) totalsMap.set(opId, { count: 0, byCurrency: new Map() });
    const entry = totalsMap.get(opId)!;
    entry.count++;
    if (inv) entry.byCurrency.set(inv.currency, (entry.byCurrency.get(inv.currency) ?? 0) + inv.total);
  }

  let filtered = ops ?? [];
  if (status) filtered = filtered.filter((op) => op.status === status);
  if (providerId) filtered = filtered.filter((op) => op.provider_id === providerId);

  function withParams(over: Partial<Filters>) {
    const p = new URLSearchParams();
    const merged = { status, provider: providerId, ...over };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const qs = p.toString();
    return qs ? `/pagos?${qs}` : "/pagos";
  }

  return (
    <div className="max-w-5xl space-y-5">
      <BackButton />
      <div className="flex items-center justify-between mt-1">
        <h1 className="text-[17px] font-semibold">Órdenes de Pago</h1>
        <Link href="/pagos/nueva">
          <Button>Nueva OP</Button>
        </Link>
      </div>

      <form className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3" method="get">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="provider">Proveedor</Label>
            <Select id="provider" name="provider" defaultValue={providerId ?? ""} className="w-52">
              <option value="">Todos</option>
              {(providers ?? []).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="status">Estado</Label>
            <Select id="status" name="status" defaultValue={status ?? ""} className="w-40">
              <option value="">Todos</option>
              <option value="EMITIDA">Emitida</option>
              <option value="EJECUTADA">Ejecutada</option>
            </Select>
          </div>
          <Button type="submit" variant="secondary">Filtrar</Button>
          {status || providerId ? (
            <Link href="/pagos" className="text-action text-[12px] text-[var(--muted)] pb-1.5">
              Limpiar
            </Link>
          ) : null}
        </div>
      </form>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] text-center text-[var(--muted)] py-10 text-[13px]">
          No hay órdenes de pago para estos filtros.
        </div>
      ) : (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
          <table>
            <thead>
              <tr>
                <th>Código</th>
                <th>Proveedor</th>
                <th className="num">Facturas</th>
                <th className="num">Total</th>
                <th>Estado</th>
                <th>Emitida</th>
                <th>Ejecutada</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((op) => {
                const entry = totalsMap.get(op.id);
                const totals = entry ? [...entry.byCurrency.entries()] : [];
                return (
                  <tr key={op.id}>
                    <td>
                      <Link href={`/pagos/${op.id}`} className="text-action font-medium">
                        {op.code}
                      </Link>
                    </td>
                    <td>{providerById.get(op.provider_id) ?? "—"}</td>
                    <td className="num">{entry?.count ?? 0}</td>
                    <td className="num">
                      {totals.length > 0
                        ? totals.map(([c, v]) => formatMoney(v, c as never)).join(" · ")
                        : "—"}
                    </td>
                    <td>
                      <Badge tone={STATUS_TONE[op.status]}>{STATUS_LABELS[op.status]}</Badge>
                    </td>
                    <td>{formatDate(op.created_at)}</td>
                    <td>{op.executed_at ? formatDate(op.executed_at) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
