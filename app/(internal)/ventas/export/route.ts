import { requireModule } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { currentMonth, monthRange } from "@/lib/month-range";
import { Client, SalesDocument } from "@/lib/types";
import { docSaldo, SALES_DOC_STATUS_LABELS, SALES_DOC_TYPE_LABELS } from "@/lib/sales";

function csvField(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(request: Request) {
  await requireModule("ventas", ["administracion", "admin"]);
  const supabase = await createClient();

  const { searchParams } = new URL(request.url);
  const monthParam = searchParams.get("month");
  const month = monthParam === "all" ? null : monthParam || currentMonth();

  let query = supabase.from("sales_documents").select("*").order("issue_date", { ascending: false });
  if (month) {
    const { start, end } = monthRange(month);
    query = query.gte("issue_date", start).lt("issue_date", end);
  }

  const [{ data: docs }, { data: clients }] = await Promise.all([
    query.returns<SalesDocument[]>(),
    supabase.from("clients").select("*").returns<Client[]>(),
  ]);
  const clientById = new Map((clients ?? []).map((c) => [c.id, c]));

  const header = [
    "Fecha",
    "Codigo",
    "Tipo",
    "Cliente",
    "RUC",
    "Neto gravado",
    "IVA",
    "Total",
    "Cobrado",
    "Saldo",
    "Moneda",
    "Estado",
    "Vencimiento",
  ];

  const rows = (docs ?? []).map((d) => {
    const c = clientById.get(d.client_id);
    return [
      d.issue_date,
      d.code,
      SALES_DOC_TYPE_LABELS[d.doc_type],
      c?.name ?? "",
      c?.tax_id ?? "",
      d.subtotal,
      d.vat_amount,
      d.total,
      d.cobrado_amount,
      docSaldo(d.total, d.cobrado_amount),
      d.currency,
      SALES_DOC_STATUS_LABELS[d.status],
      d.due_date ?? "",
    ];
  });

  const csv = [header, ...rows].map((row) => row.map(csvField).join(";")).join("\r\n");
  return new Response("﻿" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="ventas-${month ?? "todas"}.csv"`,
    },
  });
}
