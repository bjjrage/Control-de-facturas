"use server";

import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import {
  ACCEPTED_INVOICE_FILE_TYPES,
  MAX_INVOICE_FILE_BYTES,
  extractInvoiceFieldsFromFile,
  ExtractedInvoiceFields,
} from "@/lib/invoice-extraction";
import { validateInvoiceArithmetic, type ArithmeticValidation } from "@/lib/invoice-arithmetic";
import { findProviderByTaxId } from "@/lib/provider-lookup";

export type ExtractedInvoiceData = ExtractedInvoiceFields & { provider_id: string | null };

export type ExtractionResult = {
  data: (ExtractedInvoiceData & { validation: ArithmeticValidation }) | null;
  error: string | null;
};

function fail(error: string): { data: null; error: string } {
  return { data: null, error };
}

export async function extractInvoiceFromPhoto(
  formData: FormData
): Promise<ExtractionResult> {
  const profile = await requireProfile(["administracion", "admin"]);

  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return fail("Elegí una foto o PDF de la factura.");
  if (file.size > MAX_INVOICE_FILE_BYTES) return fail("El archivo no puede superar los 20MB.");
  if (!ACCEPTED_INVOICE_FILE_TYPES.includes(file.type)) {
    return fail("Formato no soportado para lectura automática. Usá JPG, PNG, WEBP o PDF.");
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const { data: parsed, error } = await extractInvoiceFieldsFromFile(bytes, file.type);
  if (error || !parsed) return fail(error ?? "No se pudo leer la factura. Completá los datos a mano.");

  const supabase = await createClient();
  const provider = await findProviderByTaxId(supabase, parsed.provider_tax_id, profile.empresa_id);

  return {
    data: { ...parsed, provider_id: provider?.id ?? null, validation: validateInvoiceArithmetic(parsed) },
    error: null,
  };
}
