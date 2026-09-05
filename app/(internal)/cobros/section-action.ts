"use server";

import { requireModule } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Client, SalesDocument } from "@/lib/types";

export type CobrosSectionData = {
  docs: SalesDocument[];
  clients: Pick<Client, "id" | "name">[];
};

export async function getCobrosData(): Promise<CobrosSectionData> {
  await requireModule("ventas", ["administracion", "admin"]);
  const supabase = await createClient();

  const [{ data: docs }, { data: clients }] = await Promise.all([
    supabase
      .from("sales_documents")
      .select("*")
      .in("status", ["EMITIDA", "COBRADA_PARCIAL"])
      .in("doc_type", ["FACTURA", "NOTA_VENTA"])
      .order("issue_date", { ascending: false })
      .returns<SalesDocument[]>(),
    supabase
      .from("clients")
      .select("id, name")
      .order("name")
      .returns<Pick<Client, "id" | "name">[]>(),
  ]);

  return {
    docs: docs ?? [],
    clients: clients ?? [],
  };
}
