"use server";

import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Provider } from "@/lib/types";

export type ProvidersSectionData = {
  providers: Provider[];
};

export async function getProvidersData(): Promise<ProvidersSectionData> {
  await requireProfile(["admin"]);
  const supabase = await createClient();
  const { data: providers } = await supabase
    .from("providers")
    .select("*")
    .order("name")
    .returns<Provider[]>();
  return { providers: providers ?? [] };
}
