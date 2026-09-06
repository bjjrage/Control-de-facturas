import { SupabaseClient } from "@supabase/supabase-js";

/**
 * RUCs get typed/stored/extracted with inconsistent punctuation ("80098765-4",
 * "80098765/4", "800987654"). Strip everything but alphanumerics before
 * comparing so a photo-extracted RUC still matches a provider on file.
 */
export function normalizeTaxId(value: string): string {
  return value.replace(/[^0-9a-zA-Z]/g, "").toUpperCase();
}

/**
 * RUC paraguayo = base + dígito verificador ("80023456-7"). Según cómo se
 * cargó el proveedor o cómo lo leyó el extractor, el dígito verificador puede
 * estar o no. Consideramos que dos RUCs coinciden si son iguales, o si uno es
 * el otro más un dígito extra al final (el verificador).
 */
export function taxIdsMatch(a: string, b: string): boolean {
  const x = normalizeTaxId(a);
  const y = normalizeTaxId(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.length === y.length + 1 && x.startsWith(y)) return true;
  if (y.length === x.length + 1 && y.startsWith(x)) return true;
  return false;
}

export async function findProviderByTaxId(
  supabase: SupabaseClient,
  taxId: string | null,
  empresaId: string
): Promise<{ id: string; name: string } | null> {
  if (!taxId) return null;
  const target = normalizeTaxId(taxId);
  if (!target) return null;

  const { data: providers } = await supabase
    .from("providers")
    .select("id, name, tax_id")
    .eq("empresa_id", empresaId)
    .not("tax_id", "is", null);
  // Primero match exacto, después tolerando el dígito verificador.
  for (const p of providers ?? []) {
    if (p.tax_id && normalizeTaxId(p.tax_id) === target) return { id: p.id, name: p.name };
  }
  for (const p of providers ?? []) {
    if (p.tax_id && taxIdsMatch(p.tax_id, target)) return { id: p.id, name: p.name };
  }
  return null;
}
