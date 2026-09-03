import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AuthorizedOrder, Provider } from "@/lib/types";
import { formatDate, formatMoney } from "@/lib/format";
import { orderRemaining, orderStep, ORDER_STEPS } from "@/lib/reconciliation";
import { OrderDialog } from "./order-dialog";
import { OrderPipeline } from "./order-pipeline";
import { OrdersFilters } from "./orders-filters";

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
  searchParams?: Promise<{ product?: string; provider?: string; etapa?: string; nueva?: string }>;
}) {
  await requireProfile(["comercial", "administracion", "admin"]);
  const supabase = await createClient();
  const params = (await searchParams) ?? {};

  const [{ data: allOrders }, { data: providers }] = await Promise.all([
    supabase
      .from("authorized_orders")
      .select("*")
      .order("authorized_at", { ascending: false })
      .returns<AuthorizedOrder[]>(),
    supabase.from("providers").select("*").eq("active", true).order("name").returns<Provider[]>(),
  ]);

  const orders = allOrders ?? [];

  // Valores presentes en la data para los dropdowns (estilo filtro de Excel).
  const productOptions = [...new Set(orders.map((o) => o.product))].sort((a, b) => a.localeCompare(b, "es"));
  const providerOptions = [...new Set(orders.map((o) => o.provider_name))].sort((a, b) => a.localeCompare(b, "es"));

  const filtered = orders.filter((o) => {
    if (params.product && o.product !== params.product) return false;
    if (params.provider && o.provider_name !== params.provider) return false;
    if (params.etapa) {
      const step = orderStep({ status: o.status, totalPrice: o.total_price, facturadoAmount: o.facturado_amount });
      if (ORDER_STEPS[step] !== params.etapa) return false;
    }
    return true;
  });

  return (
    <div className="max-w-5xl space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[17px] font-semibold">Órdenes de compra</h1>
          <p className="text-[12px] text-[var(--muted)] mt-0.5">
            Todas tus compras y en qué etapa están.
          </p>
        </div>
        <Link
          href="/orders?nueva=1"
          className="shrink-0 h-9 inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-4 text-[13px] font-medium text-white hover:bg-[var(--primary-hover)]"
        >
          + Nueva compra
        </Link>
      </div>
      <OrderDialog
        key={params.nueva === "1" ? "open" : "closed"}
        providers={providers ?? []}
        defaultOpen={params.nueva === "1"}
      />

      <OrdersFilters products={productOptions} providers={providerOptions} />

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
                <th>Etapa</th>
                <th>Autorizada</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((o) => (
                <tr key={o.id} className="hover:bg-[var(--hover)]">
                  <td>
                    <Link href={`/orders/${o.id}`} className="text-action font-medium">
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
                    <OrderPipeline
                      status={o.status}
                      totalPrice={o.total_price}
                      facturadoAmount={o.facturado_amount}
                    />
                  </td>
                  <td className="text-[var(--muted)]">{formatDate(o.authorized_at)}</td>
                </tr>
              ))}
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center text-[var(--muted)] py-8">
                    {orders.length === 0
                      ? 'No hay órdenes todavía. Usá "+ Nueva compra" para registrar la primera.'
                      : "Ninguna orden coincide con los filtros."}
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
