"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { analyzeCertificate } from "@/lib/certificate-ai";
import { revalidatePath } from "next/cache";

export async function submitCertificate(token: string, formData: FormData): Promise<{ error: string | null }> {
  const admin = createAdminClient();

  const { data: contract } = await admin
    .from("subcontractor_contracts")
    .select("*")
    .eq("public_token", token)
    .maybeSingle();
  if (!contract) return { error: "Enlace inválido." };
  if (contract.status !== "ACTIVO") return { error: "Este contrato ya no está activo — contactá a la empresa." };

  const periodStart = (formData.get("period_start") as string | null) || null;
  const periodEnd = (formData.get("period_end") as string | null) || null;
  const claimedPct = Number(formData.get("claimed_pct") ?? 0);
  const claimedAmount = Number(formData.get("claimed_amount") ?? 0);
  const notes = (formData.get("notes") as string | null)?.trim() || null;

  if (!(claimedPct > 0 && claimedPct <= 100)) return { error: "El % de avance debe estar entre 1 y 100." };
  if (!(claimedAmount > 0)) return { error: "El monto reclamado debe ser mayor a cero." };

  const { count } = await admin
    .from("subcontractor_certificates")
    .select("id", { count: "exact", head: true })
    .eq("contract_id", contract.id);
  const certificateNumber = (count ?? 0) + 1;

  const { data: cert, error } = await admin
    .from("subcontractor_certificates")
    .insert({
      contract_id: contract.id,
      project_id: contract.project_id,
      certificate_number: certificateNumber,
      period_start: periodStart,
      period_end: periodEnd,
      claimed_pct: claimedPct,
      claimed_amount: claimedAmount,
      retention_pct: contract.retention_pct,
      notes,
      submitted_by_portal: true,
    })
    .select("id")
    .single();

  if (error || !cert) return { error: "No se pudo enviar el certificado." };

  // Validación IA best-effort — nunca bloquea el guardado del certificado.
  // Nota: authorized_orders no tiene budget_item_id, así que "compras del
  // rubro" es una aproximación con las compras totales del proyecto, no del
  // rubro específico del contrato.
  try {
    const { data: prevCerts } = await admin
      .from("subcontractor_certificates")
      .select("approved_pct")
      .eq("contract_id", contract.id)
      .in("status", ["APROBADO", "PAGADO"])
      .order("approved_pct", { ascending: false })
      .limit(1);
    const previousApprovedPct = prevCerts?.[0]?.approved_pct ?? 0;

    const { data: orders } = await admin
      .from("authorized_orders")
      .select("total_price, currency")
      .eq("project_id", contract.project_id)
      .eq("currency", "PYG");
    const materialPurchases = (orders ?? []).reduce((s, o) => s + (o.total_price as number), 0);

    const result = await analyzeCertificate({
      contractDescription: contract.description,
      contractedAmount: contract.contracted_amount,
      previousApprovedPct,
      newClaimedPct: claimedPct,
      materialPurchasesInRubro: materialPurchases,
    });

    if (result.data) {
      await admin.from("subcontractor_certificates").update({ ai_flags: result.data }).eq("id", cert.id);
    }
  } catch {
    // Best-effort — el certificado ya quedó guardado, no se pierde nada.
  }

  revalidatePath(`/certificados/${token}`);
  return { error: null };
}
