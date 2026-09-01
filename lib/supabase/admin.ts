import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Privileged service-role client. NEVER import this from client components.
 * Used only in:
 *  - server actions / route handlers behind the /cotizar/[token] provider portal
 *    (the provider has no auth.users identity, so access there is gated purely
 *    by knowledge of the unguessable per-invitation token, checked explicitly
 *    in application code before any query runs)
 *  - the seed script
 *  - generating short-lived signed URLs for private storage objects
 */
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
