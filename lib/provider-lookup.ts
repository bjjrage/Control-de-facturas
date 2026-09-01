import { SupabaseClient } from "@supabase/supabase-js";

/**
 * RUCs get typed/stored/extracted with inconsistent punctuation ("80098765-4",
 * "80098765/4", "800987654"). Strip everything but alphanumerics before
 * comparing so a photo-extracted RUC still matches a provider on file.
 */
export function normalizeTaxId(value: string): string {
  return value.replace(/[^0-9a-zA-Z]/g, "").toUpperCase();
}

export async function findProviderByTaxId(
  supabase: SupabaseClient,
  taxId: string | null
): Promise<{ id: string; name: string } | null> {
  if (!taxId) return null;
  const target = normalizeTaxId(taxId);
  if (!target) return null;

  const { data: providers } = await supabase.from("providers").select("id, name, tax_id").not("tax_id", "is", null);
  for (const p of providers ?? []) {
    if (p.tax_id && normalizeTaxId(p.tax_id) === target) return { id: p.id, name: p.name };
  }
  return null;
}
