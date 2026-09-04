import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Empresa, PaymentOrder, Provider } from "@/lib/types";
import { formatDate, formatMoney } from "@/lib/format";
import { PrintButton } from "./print-button";

export default async function ImprimirOPPage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requireProfile(["administracion", "admin"]);
  const { id } = await params;
  const supabase = await createClient();

  const { data: op } = await supabase
    .from("payment_orders")
    .select("*")
    .eq("id", id)
    .single<PaymentOrder>();
  if (!op) notFound();

  const [{ data: provider }, { data: empresa }, { data: links }] = await Promise.all([
    supabase.from("providers").select("id, name, tax_id").eq("id", op.provider_id).single<Pick<Provider, "id" | "name" | "tax_id">>(),
    supabase.from("empresas").select("nombre, ruc, direccion, telefono, email_empresa").eq("id", profile.empresa_id).single<Pick<Empresa, "nombre" | "ruc" | "direccion" | "telefono" | "email_empresa">>(),
    supabase.from("payment_order_invoices").select("invoice_id").eq("payment_order_id", id),
  ]);

  const invoiceIds = (links ?? []).map((l) => l.invoice_id as string);

  const [{ data: invoices }, { data: matches }] = await Promise.all([
    invoiceIds.length > 0
      ? supabase.from("invoices").select("id, invoice_number, invoice_date, total, currency, timbrado").in("id", invoiceIds)
      : Promise.resolve({ data: [] }),
    invoiceIds.length > 0
      ? supabase.from("invoice_order_matches").select("invoice_id, authorized_orders(id, code, product)").in("invoice_id", invoiceIds)
      : Promise.resolve({ data: [] }),
  ]);

  const ocByInvoice = new Map<string, { id: string; code: string; product: string }>();
  for (const m of matches ?? []) {
    const raw = m.authorized_orders;
    const order = (Array.isArray(raw) ? raw[0] : raw) as { id: string; code: string; product: string } | null | undefined;
    if (order) ocByInvoice.set(m.invoice_id as string, order);
  }

  const totalsByCurrency = new Map<string, number>();
  for (const inv of invoices ?? []) {
    const c = inv.currency as string;
    totalsByCurrency.set(c, (totalsByCurrency.get(c) ?? 0) + (inv.total as number));
  }

  const e = empresa;

  return (
    <div className="mx-auto max-w-3xl bg-white text-black p-8 text-[12px] print:p-0" style={{ colorScheme: "light" }}>
      {/* Header */}
      <div className="flex justify-between items-start border-b-2 border-black pb-4 mb-5">
        <div>
          <div className="text-[18px] font-bold">{e?.nombre ?? "Empresa"}</div>
          {e?.ruc && <div className="text-[11px] text-gray-600">RUC: {e.ruc}</div>}
          {e?.direccion && <div className="text-[11px] text-gray-600">{e.direccion}</div>}
          {e?.telefono && <div className="text-[11px] text-gray-600">Tel: {e.telefono}</div>}
          {e?.email_empresa && <div className="text-[11px] text-gray-600">{e.email_empresa}</div>}
        </div>
        <div className="border-2 border-black p-3 text-center min-w-[180px]">
          <div className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-1">Orden de Pago</div>
          <div className="text-[22px] font-bold">{op.code}</div>
          <div className="text-[10px] text-gray-500 mt-1">Emitida: {formatDate(op.created_at)}</div>
          {op.executed_at && <div className="text-[10px] text-gray-500">Ejecutada: {formatDate(op.executed_at)}</div>}
          <div className={`mt-1.5 inline-block text-[10px] font-bold px-2 py-0.5 rounded border ${
            op.status === "EJECUTADA"
              ? "bg-green-100 text-green-800 border-green-400"
              : "bg-yellow-100 text-yellow-800 border-yellow-400"
          }`}>
            {op.status === "EJECUTADA" ? "Ejecutada" : "Emitida"}
          </div>
        </div>
      </div>

      {/* Proveedor */}
      <div className="mb-5">
        <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1.5">Proveedor</div>
        <div className="border border-gray-300 rounded px-3 py-2">
          <div className="font-bold text-[13px]">{provider?.name ?? "—"}</div>
          {(provider as { tax_id?: string | null } | null)?.tax_id && (
            <div className="text-[11px] text-gray-500 mt-0.5">RUC: {(provider as { tax_id: string }).tax_id}</div>
          )}
        </div>
      </div>

      {/* Facturas */}
      <div className="mb-5">
        <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1.5">Facturas incluidas</div>
        <table className="w-full border-collapse text-[11px]">
          <thead>
            <tr className="bg-gray-800 text-white">
              <th className="text-left px-2.5 py-1.5 font-semibold">N° Factura</th>
              <th className="text-left px-2.5 py-1.5 font-semibold">Fecha</th>
              <th className="text-left px-2.5 py-1.5 font-semibold">Timbrado</th>
              <th className="text-left px-2.5 py-1.5 font-semibold">OC vinculada</th>
              <th className="text-right px-2.5 py-1.5 font-semibold">Monto</th>
            </tr>
          </thead>
          <tbody>
            {(invoices ?? []).length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center text-gray-400 py-4">Sin facturas vinculadas.</td>
              </tr>
            ) : (
              (invoices ?? []).map((inv) => {
                const oc = ocByInvoice.get(inv.id as string);
                return (
                  <tr key={inv.id as string} className="border-b border-gray-200">
                    <td className="px-2.5 py-1.5 font-semibold">{inv.invoice_number as string}</td>
                    <td className="px-2.5 py-1.5">{formatDate(inv.invoice_date as string)}</td>
                    <td className="px-2.5 py-1.5 text-gray-500">{(inv.timbrado as string) ?? "—"}</td>
                    <td className="px-2.5 py-1.5">
                      {oc ? `${oc.code} — ${oc.product}` : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-2.5 py-1.5 text-right tabular-nums">
                      {formatMoney(inv.total as number, inv.currency as never)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Totales */}
      <div className="flex justify-end mb-6">
        <table className="text-[12px]">
          <tbody>
            {[...totalsByCurrency.entries()].map(([c, v]) => (
              <tr key={c}>
                <td className="pr-6 py-1 text-gray-600">Total a pagar ({c})</td>
                <td className="text-right font-bold text-[14px] tabular-nums border-t-2 border-black pt-1">
                  {formatMoney(v, c as never)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Notas */}
      {op.notes && (
        <div className="mb-6">
          <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Notas</div>
          <p className="text-[11px] text-gray-700">{op.notes}</p>
        </div>
      )}

      {/* Firmas */}
      <div className="grid grid-cols-2 gap-12 mt-14">
        <div className="border-t border-gray-500 pt-1.5 text-center text-[10px] text-gray-500">Autorizado por</div>
        <div className="border-t border-gray-500 pt-1.5 text-center text-[10px] text-gray-500">Recibido / Conformidad</div>
      </div>

      {/* Botón imprimir — oculto en print */}
      <div className="mt-8 text-center print:hidden">
        <PrintButton />
      </div>
    </div>
  );
}
