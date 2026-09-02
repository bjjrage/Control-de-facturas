import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { currentMonth, monthRange } from "@/lib/month-range";
import { Invoice, Provider } from "@/lib/types";

// Generic CSV export for the Facturas panel: not tied to any specific
// accounting system, just the standard fields almost every "importar
// gastos/compras" screen expects. Delimiter is ";" and the file carries a
// UTF-8 BOM so it opens correctly (accents, decimal comma) in Excel with a
// Spanish locale, which is what virtually every accounting tool used in
// Paraguay assumes.
function csvField(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(request: Request) {
  await requireProfile(["administracion", "admin"]);
  const supabase = await createClient();

  const { searchParams } = new URL(request.url);
  const monthParam = searchParams.get("month");
  const month = monthParam === "all" ? null : monthParam || currentMonth();

  let query = supabase.from("invoices").select("*").order("invoice_date", { ascending: false });
  if (month) {
    const { start, end } = monthRange(month);
    query = query.gte("invoice_date", start).lt("invoice_date", end);
  }

  const [{ data: invoices }, { data: providers }, { data: matches }] = await Promise.all([
    query.returns<Invoice[]>(),
    supabase.from("providers").select("*").returns<Provider[]>(),
    supabase
      .from("invoice_order_matches")
      .select("invoice_id, authorized_orders(code)")
      .returns<{ invoice_id: string; authorized_orders: { code: string } | null }[]>(),
  ]);

  const providerById = new Map((providers ?? []).map((p) => [p.id, p]));
  const orderCodesByInvoice = new Map<string, string[]>();
  for (const m of matches ?? []) {
    if (!m.authorized_orders) continue;
    const list = orderCodesByInvoice.get(m.invoice_id) ?? [];
    list.push(m.authorized_orders.code);
    orderCodesByInvoice.set(m.invoice_id, list);
  }

  const header = [
    "Fecha",
    "Proveedor",
    "RUC",
    "N° Factura",
    "Timbrado",
    "Subtotal",
    "IVA",
    "Total",
    "Moneda",
    "Estado",
    "Orden(es) vinculada(s)",
  ];

  const rows = (invoices ?? []).map((i) => {
    const provider = providerById.get(i.provider_id);
    return [
      i.invoice_date,
      provider?.name ?? "",
      provider?.tax_id ?? "",
      i.invoice_number,
      i.timbrado ?? "",
      i.subtotal ?? "",
      i.vat ?? "",
      i.total,
      i.currency,
      i.status,
      (orderCodesByInvoice.get(i.id) ?? []).join(", "),
    ];
  });

  const csv = [header, ...rows].map((row) => row.map(csvField).join(";")).join("\r\n");
  const bom = "﻿";

  return new Response(bom + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="facturas-${month ?? "todas"}.csv"`,
    },
  });
}
