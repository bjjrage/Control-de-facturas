import { createAdminClient } from "@/lib/supabase/admin";

// A claim must be at least ten minutes old before it can be marked FAILED_SAFE.
// The SQL RPC rechecks this cutoff and the expected state while holding row
// locks; this caller never decides whether an attempt is safe to recover.
export const EMAIL_SEND_CLAIM_STALE_AFTER_MS = 10 * 60 * 1_000;

export async function recoverStaleEmailSendAttempts(): Promise<number> {
  const cutoff = new Date(Date.now() - EMAIL_SEND_CLAIM_STALE_AFTER_MS).toISOString();
  const { data, error } = await createAdminClient().rpc("recover_stale_email_send_attempts", {
    p_cutoff: cutoff,
  });

  if (error || typeof data !== "number" || !Number.isSafeInteger(data) || data < 0) {
    // Fail closed: sending cannot proceed if recovery's database arbitration
    // could not be confirmed. Do not include database details in the error.
    throw new Error("No se pudo verificar la recuperación segura de envíos de email");
  }

  return data;
}
