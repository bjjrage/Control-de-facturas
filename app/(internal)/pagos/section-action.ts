"use server";

import { unstable_noStore as noStore } from "next/cache";

import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PaymentOrder, Provider } from "@/lib/types";

export type OpEntry = {
  count: number;
  byCurrency: [string, number][];
};

export type PagosSectionData = {
  ops: PaymentOrder[];
  providers: Pick<Provider, "id" | "name">[];
  opTotals: Record<string, OpEntry>;
};

export async function getPagosData(): Promise<PagosSectionData> {
  noStore();
  await requireProfile(["administracion", "admin"]);
  const supabase = await createClient();

  const [{ data: ops }, { data: providers }, { data: opInvoiceRows }] = await Promise.all([
    supabase
      .from("payment_orders")
      .select("*")
      .order("created_at", { ascending: false })
      .returns<PaymentOrder[]>(),
    supabase
      .from("providers")
      .select("id, name")
      .eq("active", true)
      .order("name")
      .returns<Pick<Provider, "id" | "name">[]>(),
    supabase
      .from("payment_order_invoices")
      .select("payment_order_id, invoices(total, currency)"),
  ]);

  const totalsMap = new Map<string, { count: number; byCurrency: Map<string, number> }>();
  for (const row of opInvoiceRows ?? []) {
    const opId = row.payment_order_id as string;
    const rawInv = row.invoices;
    const inv = (Array.isArray(rawInv) ? rawInv[0] : rawInv) as
      | { total: number; currency: string }
      | null
      | undefined;
    if (!totalsMap.has(opId)) totalsMap.set(opId, { count: 0, byCurrency: new Map() });
    const entry = totalsMap.get(opId)!;
    entry.count++;
    if (inv) entry.byCurrency.set(inv.currency, (entry.byCurrency.get(inv.currency) ?? 0) + inv.total);
  }

  const opTotals: Record<string, OpEntry> = {};
  for (const [opId, entry] of totalsMap) {
    opTotals[opId] = { count: entry.count, byCurrency: [...entry.byCurrency.entries()] };
  }

  return {
    ops: ops ?? [],
    providers: providers ?? [],
    opTotals,
  };
}
