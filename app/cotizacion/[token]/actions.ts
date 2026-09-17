"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashQuotationToken, isValidRawQuotationToken } from "@/lib/quotation-tokens";

async function requestMeta() {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null;
  const ua = h.get("user-agent") ?? null;
  return { ip, ua };
}

function str(fd: FormData, k: string) {
  const v = fd.get(k);
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Aceptación electrónica por el cliente. El raw de la URL se hashea (sha256)
 * en app y a la DB solo llega el hash: el secreto nunca se persiste ni se
 * loguea. Toda la validación (tenant, versión, expiración, estado,
 * idempotencia, workflow) ocurre dentro del RPC accept_quotation
 * (SECURITY DEFINER, search_path fijo). Nunca devuelve datos de la OT.
 */
export async function acceptQuotationAction(token: string, formData: FormData) {
  if (!isValidRawQuotationToken(token)) return { error: "Enlace inválido." };
  const name = str(formData, "acceptor_name");
  const doc = str(formData, "acceptor_doc");
  const notes = str(formData, "notes");
  if (name.length < 2) return { error: "Indicá tu nombre y apellido para aceptar." };
  if (name.length > 200) return { error: "El nombre es demasiado largo." };
  if (doc.length > 80) return { error: "El documento es demasiado largo." };
  if (notes.length > 2000) return { error: "El comentario es demasiado largo." };

  const admin = createAdminClient();
  const { ip, ua } = await requestMeta();
  const { error } = await admin.rpc("accept_quotation", {
    p_token_hash: hashQuotationToken(token),
    p_acceptor_name: name,
    p_acceptor_doc: doc || null,
    p_notes: notes || null,
    p_ip: ip,
    p_user_agent: ua,
  });
  if (error) return { error: error.message };
  revalidatePath(`/cotizacion/${token}`);
  return { error: null as string | null };
}

export async function rejectQuotationAction(token: string, formData: FormData) {
  if (!isValidRawQuotationToken(token)) return { error: "Enlace inválido." };
  const reason = str(formData, "reason");
  const name = str(formData, "actor_name");
  if (reason.length > 2000) return { error: "El motivo es demasiado largo." };

  const admin = createAdminClient();
  const { ip, ua } = await requestMeta();
  const { error } = await admin.rpc("reject_quotation", {
    p_token_hash: hashQuotationToken(token),
    p_reason: reason || null,
    p_actor_name: name || null,
    p_ip: ip,
    p_user_agent: ua,
  });
  if (error) return { error: error.message };
  revalidatePath(`/cotizacion/${token}`);
  return { error: null as string | null };
}
