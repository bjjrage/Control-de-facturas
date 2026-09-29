"use server";

import { unstable_noStore as noStore } from "next/cache";

import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Provider } from "@/lib/types";

export type ProvidersSectionData = {
  providers: Provider[];
  categorias: { id: string; nombre: string }[];
  rubrosByProvider: Record<string, string[]>;
};

export async function getProvidersData(): Promise<ProvidersSectionData> {
  noStore();
  const profile = await requireProfile(["admin"]);
  const supabase = await createClient();
  const [{ data: providers }, { data: categorias }, { data: links }] = await Promise.all([
    supabase.from("providers").select("*").order("name").returns<Provider[]>(),
    supabase.from("categorias_producto").select("id, nombre").eq("empresa_id", profile.empresa_id).order("orden").order("nombre"),
    supabase.from("provider_categorias").select("provider_id, categoria_id").eq("empresa_id", profile.empresa_id),
  ]);
  const rubrosByProvider: Record<string, string[]> = {};
  for (const l of (links ?? []) as { provider_id: string; categoria_id: string }[]) {
    (rubrosByProvider[l.provider_id] ??= []).push(l.categoria_id);
  }
  return {
    providers: providers ?? [],
    categorias: (categorias ?? []) as { id: string; nombre: string }[],
    rubrosByProvider,
  };
}
