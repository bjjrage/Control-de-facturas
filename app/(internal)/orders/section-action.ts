"use server";

import { unstable_noStore as noStore } from "next/cache";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AuthorizedOrder, Provider } from "@/lib/types";

export type OrdersSectionData = {
  orders: AuthorizedOrder[];
  providers: Provider[];
  isAdmin: boolean;
};

export async function getOrdersData(): Promise<OrdersSectionData> {
  noStore();
  const profile = await requireProfile(["comercial", "administracion", "admin"]);
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
    isAdmin: profile.role === "admin",
  };
}
