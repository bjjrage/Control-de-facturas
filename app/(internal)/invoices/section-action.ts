"use server";

import { unstable_noStore as noStore } from "next/cache";

import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Invoice, Provider } from "@/lib/types";
import { currentMonth, monthRange } from "@/lib/month-range";

export type InvoicesSectionData = {
  invoices: Invoice[];
  providers: Provider[];
  reviewCount: number;
  month: string | null;
  isAdmin: boolean;
};

export async function getInvoicesData(monthParam?: string | null): Promise<InvoicesSectionData> {
  noStore();
  const profile = await requireProfile(["administracion", "admin"]);
  const supabase = await createClient();
  const month = monthParam === "all" ? null : (monthParam ?? currentMonth());

  const { data: providers } = await supabase
    .from("providers")
    .select("*")
    .order("name")
    .returns<Provider[]>();

  let query = supabase
    .from("invoices")
    .select("*")
    .order("invoice_date", { ascending: false });

  if (month) {
    const { start, end } = monthRange(month);
    query = query.gte("invoice_date", start).lt("invoice_date", end);
  }

  const [{ data: invoices }, { count: reviewCount }] = await Promise.all([
    query.returns<Invoice[]>(),
    supabase
      .from("invoice_jobs")
      .select("id", { count: "exact", head: true })
      .in("status", ["needs_review", "failed"]),
  ]);

  return {
    invoices: invoices ?? [],
    providers: providers ?? [],
    reviewCount: reviewCount ?? 0,
    month,
    isAdmin: profile.role === "admin",
  };
}
