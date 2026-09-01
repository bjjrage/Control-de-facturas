import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AuthorizedOrder } from "@/lib/types";
import { StatusBadge } from "@/components/ui/badge";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatDate, formatMoney, formatNumber } from "@/lib/format";

export default async function CostsPage({
  searchParams,
}: {
  searchParams?: Promise<{ product?: string; provider?: string }>;
}) {
  await requireProfile(["comercial", "admin"]);
  const supabase = await createClient();
  const params = (await searchParams) ?? {};

  let query = supabase
    .from("authorized_orders")
    .select("*")
    .order("authorized_at", { ascending: false });

  if (params.product) query = query.ilike("product", `%${params.product}%`);
  if (params.provider) query = query.ilike("provider_name", `%${params.provider}%`);

  const { data: orders } = await query.returns<AuthorizedOrder[]>();

  return (
    <div className="max-w-5xl">
      <h1 className="text-[17px] font-semibold mb-4">Costos históricos</h1>
      <form className="flex items-end gap-3 mb-4" method="get">
        <div>
          <Label htmlFor="product">Producto</Label>
          <Input id="product" name="product" defaultValue={params.product ?? ""} className="w-52" />
        </div>
        <div>
          <Label htmlFor="provider">Proveedor</Label>
          <Input id="provider" name="provider" defaultValue={params.provider ?? ""} className="w-52" />
        </div>
        <Button type="submit" variant="secondary">
          Filtrar
        </Button>
      </form>
      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
        <table>
          <thead>
            <tr>
              <th>RFQ</th>
              <th>Producto</th>
              <th>Proveedor</th>
              <th className="num">Cantidad</th>
              <th className="num">Precio unit.</th>
              <th className="num">Total</th>
              <th>Más económica</th>
              <th>Estado</th>
              <th>Autorizada</th>
            </tr>
          </thead>
          <tbody>
            {(orders ?? []).map((o) => (
              <tr key={o.id}>
                <td>{o.rfq_code}</td>
                <td>{o.product}</td>
                <td>{o.provider_name}</td>
                <td className="num">
                  {formatNumber(o.quantity, 2)} {o.unit}
                </td>
                <td className="num">{formatMoney(o.unit_price, o.currency)}</td>
                <td className="num">{formatMoney(o.total_price, o.currency)}</td>
                <td>{o.is_cheapest ? "Sí" : o.selection_reason ?? "-"}</td>
                <td>
                  <StatusBadge status={o.status} />
                </td>
                <td>{formatDate(o.authorized_at)}</td>
              </tr>
            ))}
            {(orders ?? []).length === 0 ? (
              <tr>
                <td colSpan={9} className="text-center text-[var(--muted)] py-6">
                  No hay órdenes autorizadas todavía.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
