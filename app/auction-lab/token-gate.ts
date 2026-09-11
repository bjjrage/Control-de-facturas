'use server';

import { createAdminClient } from '@/lib/supabase/admin';
import { loadSandboxBundle, SandboxBundle } from '@/lib/auction-sandbox/server';
import { hashSandboxToken, isValidSandboxTokenFormat } from '@/lib/auction-sandbox/tokens';

/**
 * Token gate shared by the public sandbox portals (server-only).
 * Mirrors the /cotizar/[token] pattern: service-role client + explicit
 * token check in application code. Only hashes are persisted; the raw
 * token never touches the database.
 */
export async function resolveSandboxRoom(
  token: string,
  kind: 'competitor' | 'observer'
): Promise<{ bundle: SandboxBundle; participantId: string | null } | { error: string }> {
  if (!isValidSandboxTokenFormat(token)) return { error: 'Enlace inválido.' };
  const digest = hashSandboxToken(token);
  const admin = createAdminClient();
  const column = kind === 'competitor' ? 'competitor_token_hash' : 'observer_token_hash';
  const { data: room } = await admin
    .from('auction_sandbox_rooms')
    .select('id')
    .eq(column, digest)
    .maybeSingle();
  if (!room) return { error: 'Enlace inválido o vencido.' };
  const bundle = await loadSandboxBundle(admin, (room as { id: string }).id);
  if (!bundle) return { error: 'Enlace inválido o vencido.' };
  let participantId: string | null = null;
  if (kind === 'competitor') {
    participantId = bundle.participants.find((p) => p.kind === 'HUMAN')?.id ?? null;
    if (!participantId) return { error: 'Sala sin competidor asignado.' };
  }
  return { bundle, participantId };
}
