"use server";

import { unstable_noStore as noStore } from "next/cache";

import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Rfq } from "@/lib/types";

export type RfqsSectionData = {
  rfqs: Rfq[];
  products: string[];
};

export async function getRfqsData(): Promise<RfqsSectionData> {
  noStore();
  await requireProfile(["comercial", "administracion", "admin"]);
  const supabase = await createClient();

  const [{ data: rfqs }, { data: productRows }] = await Promise.all([
    supabase
      .from("rfqs")
      .select("*")
      .order("created_at", { ascending: false })
      .returns<Rfq[]>(),
    supabase.from("rfqs").select("product"),
  ]);

  const products = [
    ...new Set((productRows ?? []).map((r: { product: string }) => r.product)),
  ].sort();

  return {
    rfqs: rfqs ?? [],
    products,
  };
}
