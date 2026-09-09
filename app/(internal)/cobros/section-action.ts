"use server";

import { unstable_noStore as noStore } from "next/cache";

import { requireModule } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Client, CurrencyCode, SalesDocument } from "@/lib/types";

export type CobrosCuenta = { id: string; nombre: string; moneda: CurrencyCode };

export type CobrosSectionData = {
  docs: SalesDocument[];
  clients: Pick<Client, "id" | "name">[];
  cuentas: CobrosCuenta[];
};

export async function getCobrosData(): Promise<CobrosSectionData> {
  noStore();
  await requireModule("ventas", ["administracion", "admin"]);
  const supabase = await createClient();

  const [{ data: docs }, { data: clients }, { data: cuentas }] = await Promise.all([
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
    supabase
      .from("cuentas_financieras")
      .select("id, nombre, moneda")
      .eq("activo", true)
      .order("nombre")
      .returns<CobrosCuenta[]>(),
  ]);

  return {
    docs: docs ?? [],
    clients: clients ?? [],
    cuentas: cuentas ?? [],
  };
}
