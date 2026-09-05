"use server";

import { requireModule } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Client } from "@/lib/types";

export type ClientesSectionData = {
  clients: Client[];
};

export async function getClientesData(): Promise<ClientesSectionData> {
  await requireModule("ventas", ["administracion", "admin"]);
  const supabase = await createClient();
  const { data: clients } = await supabase
    .from("clients")
    .select("*")
    .order("name")
    .returns<Client[]>();
  return { clients: clients ?? [] };
}
