"use server";

import { requireModule } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Client, SalesDocument, SalesDocType } from "@/lib/types";
import { currentMonth, monthRange } from "@/lib/month-range";

export type SalesListData = {
  docs: SalesDocument[];
  clients: Pick<Client, "id" | "name">[];
  month: string | null;
};

export async function getSalesListData(
  docType: SalesDocType,
  monthParam?: string | null
): Promise<SalesListData> {
  await requireModule("ventas", ["administracion", "admin"]);
  const supabase = await createClient();
  const month = monthParam === "all" ? null : (monthParam ?? currentMonth());

  const { data: clients } = await supabase
    .from("clients")
    .select("id, name")
    .order("name")
    .returns<Pick<Client, "id" | "name">[]>();

  let query = supabase
    .from("sales_documents")
    .select("*")
    .eq("doc_type", docType)
    .order("issue_date", { ascending: false });

  if (month) {
    const { start, end } = monthRange(month);
    query = query.gte("issue_date", start).lt("issue_date", end);
  }

  const { data: docs } = await query.returns<SalesDocument[]>();

  return {
    docs: docs ?? [],
    clients: clients ?? [],
    month,
  };
}
