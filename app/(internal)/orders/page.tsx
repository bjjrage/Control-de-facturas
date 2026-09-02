import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AuthorizedOrder, Provider } from "@/lib/types";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatDate, formatMoney } from "@/lib/format";
import { orderRemaining, orderFulfillmentStatus } from "@/lib/reconciliation";
import { OrderDialog } from "./order-dialog";

const FULFILLMENT_LABEL = { pendiente: "Pendiente", parcial: "Parcial", completa: "Completa" } as const;
const FULFILLMENT_TONE = { pendiente: "neutral", parcial: "warn", completa: "ok" } as const;

function ProgressBar({ facturado, total }: { facturado: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((facturado / total) * 100)) : 0;
  const over = facturado > total;
  return (
    <div className="w-28">
      <div className="h-1.5 rounded-full bg-[var(--hover)] overflow-hidden">
        <div
          className={`h-full rounded-full ${over ? "bg-[var(--error)]" : "bg-[var(--primary)]"}`}
          style={{ width: `${Math.max(pct, over ? 100 : 0)}%` }}
        />
      </div>
      <div className="text-[10px] text-[var(--muted)] mt-0.5">{pct}%</div>
    </div>
  );
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams?: Promise<{ product?: string; provider?: string; status?: string }>;
}) {
  await requireProfile(["comercial", "administracion", "admin"]);
  const supabase = await createClient();
  const params = (await searchParams) ?? {};

  let query = supabase.from("authorized_orders").select("*").order("authorized_at", { ascending: false });
  if (params.product) query = query.ilike("product", `%${params.product}%`);
  if (params.provider) query = query.ilike("provider_name", `%${params.provider}%`);
  if (params.status) query = query.eq("status", params.status);

  const [{ data: orders }, { data: providers }] = await Promise.all([
    query.returns<AuthorizedOrder[]>(),
    supabase.from("providers").select("*").eq("active", true).order("name").returns<Provider[]>(),
  ]);

  return (
    <div className="max-w-5xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-[17px] font-semibold">Órdenes de compra</h1>
        <OrderDialog providers={providers ?? []} trigger={<Button>Nueva orden</Button>} />
      </div>

      <form className="flex flex-wrap items-end gap-3" method="get">
        <div>
          <Label htmlFor="product">Producto</Label>
          <Input id="product" name="product" defaultValue={params.product ?? ""} className="w-48" />
        </div>
        <div>
          <Label htmlFor="provider">Proveedor</Label>
          <Input id="provider" name="provider" defaultValue={params.provider ?? ""} className="w-48" />
        </div>
        <Button type="submit" variant="secondary">
          Filtrar
        </Button>
        {(params.product || params.provider || params.status) ? (
          <Link href="/orders" className="text-[12px] text-[var(--muted)] hover:underline pb-1.5">
            Limpiar
          </Link>
        ) : null}
      </form>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Código</th>
                <th>Producto</th>
                <th>Proveedor</th>
                <th className="num">Total</th>
                <th>Facturado</th>
                <th>Entrega</th>
                <th>Estado</th>
                <th>Autorizada</th>
              </tr>
            </thead>
            <tbody>
              {(orders ?? []).map((o) => {
                const f = orderFulfillmentStatus(o.total_price, o.facturado_amount);
                return (
                  <tr key={o.id} className="hover:bg-[var(--hover)]">
                    <td>
                      <Link href={`/orders/${o.id}`} className="font-medium hover:underline">
                        {o.code}
                      </Link>
                    </td>
                    <td>{o.product}</td>
                    <td className="text-[var(--muted)]">{o.provider_name}</td>
                    <td className="num">{formatMoney(o.total_price, o.currency)}</td>
                    <td>
                      <div className="flex items-center gap-2">
                        <ProgressBar facturado={o.facturado_amount} total={o.total_price} />
                        <span className="text-[11px] text-[var(--muted)] num">
                          saldo {formatMoney(orderRemaining(o.total_price, o.facturado_amount), o.currency)}
                        </span>
                      </div>
                    </td>
                    <td>
                      <Badge tone={FULFILLMENT_TONE[f]}>{FULFILLMENT_LABEL[f]}</Badge>
                    </td>
                    <td>
                      <StatusBadge status={o.status} />
                    </td>
                    <td className="text-[var(--muted)]">{formatDate(o.authorized_at)}</td>
                  </tr>
                );
              })}
              {(orders ?? []).length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center text-[var(--muted)] py-8">
                    No hay órdenes todavía. Creá una con &quot;Nueva orden&quot;, o autorizá una oferta desde
                    Solicitudes.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
