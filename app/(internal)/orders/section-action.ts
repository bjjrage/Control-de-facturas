"use server";

import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AuthorizedOrder, Provider } from "@/lib/types";

export type OrdersSectionData = {
  orders: AuthorizedOrder[];
  providers: Provider[];
};

export async function getOrdersData(): Promise<OrdersSectionData> {
  await requireProfile(["comercial", "administracion", "admin"]);
  const supabase = await createClient();

  const [{ data: orders }, { data: providers }] = await Promise.all([
    supabase
      .from("authorized_orders")
      .select("*")
      .order("authorized_at", { ascending: false })
      .returns<AuthorizedOrder[]>(),
    supabase
      .from("providers")
      .select("*")
      .eq("active", true)
      .order("name")
      .returns<Provider[]>(),
  ]);

  return {
    orders: orders ?? [],
    providers: providers ?? [],
  };
}
