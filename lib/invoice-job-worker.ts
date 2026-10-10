import type { SupabaseClient } from "@supabase/supabase-js";

export type InvoiceJobLease = {
  id: string;
  attempts: number;
  invoice_id: string | null;
};

/** Finish only the exact worker lease that created this result. */
export async function finishInvoiceJobLease(
  supabase: SupabaseClient,
  lease: InvoiceJobLease,
  patch: Record<string, unknown>,
): Promise<{ updated: boolean; error: string | null }> {
  const query = supabase.from("invoice_jobs")
    .update({ locked_at: null, ...patch } as never)
    .eq("id", lease.id)
    .eq("status", "processing")
    .eq("attempts", lease.attempts);
  const guarded = lease.invoice_id === null
    ? query.is("invoice_id", null)
    : query.eq("invoice_id", lease.invoice_id);
  const { data, error } = await guarded.select("id").maybeSingle();
  return { updated: Boolean(data), error: error?.message ?? null };
}

export type InvoiceJobCreationDisposition =
  | { kind: "created"; invoiceId: string }
  | { kind: "existing"; invoiceId: string }
  | { kind: "failed"; duplicateNumber: boolean; error: string | null };

export function invoiceJobCreationDisposition(
  result: unknown,
  error: { code?: string; message?: string } | null,
): InvoiceJobCreationDisposition {
  const value = result as { ok?: boolean; invoice_id?: string; duplicate?: boolean; error?: string } | null;
  if (!error && value?.ok && value.duplicate && value.invoice_id) {
    return { kind: "existing", invoiceId: value.invoice_id };
  }
  if (!error && value?.ok && value.invoice_id) return { kind: "created", invoiceId: value.invoice_id };
  return {
    kind: "failed",
    duplicateNumber: error?.code === "23505" || value?.duplicate === true,
    error: error?.message ?? value?.error ?? null,
  };
}

export function invoiceJobMatchingOutcome(input: {
  lineSaveError: string | null;
  matchError: string | null;
  pendingLines: number;
  skippedProposals: number;
  matchedOrderId: string | null;
  lineCount: number;
}): { status: "done" | "needs_review"; outcome: "matched" | "created_unmatched" | "needs_manual"; message: string } {
  if (input.lineSaveError) {
    return { status: "needs_review", outcome: "needs_manual", message: "La factura se creó, pero no se pudieron guardar sus líneas. Revisá manualmente antes de conciliar." };
  }
  if (input.matchError) {
    return { status: "needs_review", outcome: "needs_manual", message: "La factura se creó, pero falló una imputación de línea. Revisá las imputaciones antes de aprobar el pago." };
  }
  if (input.pendingLines > 0) {
    return {
      status: "needs_review", outcome: "needs_manual",
      message: `${input.pendingLines} de ${input.lineCount} línea(s) quedaron sin imputación completa. Revisalas antes de aprobar el pago.`,
    };
  }
  if (input.skippedProposals > 0) {
    return {
      status: "needs_review", outcome: "needs_manual",
      message: `${input.skippedProposals} propuesta(s) de imputación no se aplicaron. Revisá la conciliación antes de aprobar el pago.`,
    };
  }
  return input.matchedOrderId
    ? { status: "done", outcome: "matched", message: "Conciliada automáticamente." }
    : { status: "done", outcome: "created_unmatched", message: "Cargada, pero ninguna orden pendiente coincide — vinculala a mano." };
}
