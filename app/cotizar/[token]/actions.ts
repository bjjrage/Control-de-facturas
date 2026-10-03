"use server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  resolveSupplierInvitation,
  submitOfferForm,
} from "@/lib/rfq/offer-submission";
export async function submitMultiItemQuote(token: string, formData: FormData) {
  try {
    const result = await submitOfferForm(createAdminClient(), token, formData);
    return { error: null, ...result };
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "No se pudo enviar la oferta",
    };
  }
}
export async function submitQuote(token: string, formData: FormData) {
  return submitMultiItemQuote(token, formData);
}
export async function markOpened(token: string) {
  const db = createAdminClient();
  try {
    const rp = await resolveSupplierInvitation(db, token);
    const { error } = await db
      .from("rfq_providers")
      .update({ opened_at: new Date().toISOString() })
      .eq("id", rp.id)
      .eq("empresa_id", rp.empresa_id)
      .is("token_revoked_at", null);
    return { error: error?.message ?? null };
  } catch {
    return { error: "Link no disponible" };
  }
}
