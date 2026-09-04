import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Rfq } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Label, Select } from "@/components/ui/input";
import { formatDate, formatNumber } from "@/lib/format";
import { isRfqOpen, rfqClosedReason } from "@/lib/rfq-status";
import { RfqDialog } from "./rfq-dialog";
import { BackButton } from "@/components/ui/back-button";

type Filters = {
  q?: string;
  product?: string;
  open?: string; // "1" | "0"
  from?: string;
  to?: string;
  nueva?: string;
};

export default async function RfqsPage({ searchParams }: { searchParams: Promise<Filters> }) {
  await requireProfile(["comercial", "administracion", "admin"]);
  const supabase = await createClient();
  const filters = await searchParams;
  const { q, product, open, from, to } = filters;
  const hasFilters = !!(q || product || open || from || to);

  let query = supabase.from("rfqs").select("*").order("created_at", { ascending: false });
  if (q?.trim()) {
    const term = q.trim().replace(/[%,]/g, "");
    query = query.or(
      `code.ilike.%${term}%,product.ilike.%${term}%,specifications.ilike.%${term}%,internal_reference.ilike.%${term}%`
    );
  }
  if (product) query = query.eq("product", product);
  if (from) query = query.gte("created_at", from);
  if (to) {
    const toExclusive = new Date(to + "T00:00:00Z");
    toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);
    query = query.lt("created_at", toExclusive.toISOString().slice(0, 10));
  }

  // Valores de producto para el dropdown — sacados de lo que hay cargado, para
  // que el filtro siempre matchee data real. Va en paralelo con la query principal.
  const [{ data: allMatching }, { data: allRfqs }] = await Promise.all([
    query.returns<Rfq[]>(),
    supabase.from("rfqs").select("product"),
  ]);
  const products = [...new Set((allRfqs ?? []).map((r) => r.product))].sort();
  // "Abierta/Cerrada" depends on expires_at, not just a DB column, so this
  // last filter runs in JS rather than as a query condition.
  const rfqs = (allMatching ?? []).filter((r) => {
    if (open === "1") return isRfqOpen(r);
    if (open === "0") return !isRfqOpen(r);
    return true;
  });

  return (
    <div className="max-w-5xl">
      <BackButton />
      <div className="flex items-center justify-between mt-1 mb-4">
        <h1 className="text-[17px] font-semibold">Cotizaciones</h1>
        <RfqDialog
          key={filters.nueva === "1" ? "open" : "closed"}
          trigger={<Button>+ Nueva cotización</Button>}
          defaultOpen={filters.nueva === "1"}
        />
      </div>

      <form className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3 mb-4 space-y-3" method="get">
        <div>
          <Label htmlFor="q">Buscar (código, especificación, referencia)</Label>
          <Input id="q" name="q" defaultValue={q ?? ""} placeholder="ej: cubiertas" />
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="product">Producto</Label>
            <Select id="product" name="product" defaultValue={product ?? ""} className="w-44">
              <option value="">Todos</option>
              {products.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="open">Estado</Label>
            <Select id="open" name="open" defaultValue={open ?? ""} className="w-36">
              <option value="">Todos</option>
              <option value="1">Abierta</option>
              <option value="0">Cerrada</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="from">Desde</Label>
            <Input id="from" name="from" type="date" defaultValue={from ?? ""} className="w-36" />
          </div>
          <div>
            <Label htmlFor="to">Hasta</Label>
            <Input id="to" name="to" type="date" defaultValue={to ?? ""} className="w-36" />
          </div>
          <Button type="submit" variant="secondary">
            Filtrar
          </Button>
          {hasFilters ? (
            <Link href="/rfqs" className="text-action text-[12px] text-[var(--muted)] pb-1.5">
              Limpiar filtros
            </Link>
          ) : null}
        </div>
      </form>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
        <table>
          <thead>
            <tr>
              <th>Código</th>
              <th>Tipo</th>
              <th>Producto</th>
              <th>Cantidad</th>
              <th>Estado</th>
              <th>Creada</th>
            </tr>
          </thead>
          <tbody>
            {rfqs.map((r) => {
              const rfqOpen = isRfqOpen(r);
              const reason = rfqClosedReason(r);
              return (
                <tr key={r.id}>
                  <td>
                    <Link href={`/rfqs/${r.id}`} className="text-action font-medium text-[var(--foreground)]">
                      {r.code}
                    </Link>
                  </td>
                  <td>
                    <Badge tone={r.quote_type === "COT" ? "warn" : "ok"}>
                      {r.quote_type === "COT" ? "Cotización" : "RFQ"}
                    </Badge>
                  </td>
                  <td>{r.product}</td>
                  <td className="num">
                    {formatNumber(r.quantity, 2)} {r.unit}
                  </td>
                  <td>
                    <span className="inline-flex items-center gap-1.5">
                      <Badge tone={rfqOpen ? "warn" : "neutral"}>{rfqOpen ? "Abierta" : "Cerrada"}</Badge>
                      {reason ? <span className="text-[11px] text-[var(--muted)]">{reason}</span> : null}
                    </span>
                  </td>
                  <td>{formatDate(r.created_at)}</td>
                </tr>
              );
            })}
            {rfqs.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center text-[var(--muted)] py-6">
                  {hasFilters ? "Sin resultados para estos filtros." : "No hay cotizaciones todavía."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <p className="text-[12px] text-[var(--muted)] mt-2">{rfqs.length} resultado(s)</p>
    </div>
  );
}
