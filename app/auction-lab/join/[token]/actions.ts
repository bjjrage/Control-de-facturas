'use server';

import { createAdminClient } from '@/lib/supabase/admin';
import { buildJoinView, loadSandboxBundle, JoinView } from '@/lib/auction-sandbox/server';
import { resolveSandboxRoom } from '../../token-gate';

/** Phase heartbeat through the atomic advance RPC (server clock). */
async function advanceIfNeeded(roomId: string) {
  const admin = createAdminClient();
  await admin.rpc('advance_sandbox_room', { p_room_id: roomId });
}

export async function getJoinView(token: string): Promise<{ view?: JoinView; error?: string }> {
  const resolved = await resolveSandboxRoom(token, 'competitor');
  if ('error' in resolved) return { error: resolved.error };
  await advanceIfNeeded(resolved.bundle.room.id);
  const admin = createAdminClient();
  const loaded = await loadSandboxBundle(admin, resolved.bundle.room.id);
  if ('error' in loaded) return { error: loaded.error };
  const bundle = loaded.bundle;
  return { view: buildJoinView(bundle, resolved.participantId as string, new Date().toISOString()) };
}

export async function submitHumanBid(
  token: string,
  pricePyg: number,
  idempotencyKey: string
): Promise<{ accepted?: boolean; error?: string }> {
  const resolved = await resolveSandboxRoom(token, 'competitor');
  if ('error' in resolved) return { error: resolved.error };
  if (!Number.isInteger(pricePyg) || pricePyg <= 0) return { error: 'Precio inválido.' };
  if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 80) return { error: 'Clave de idempotencia inválida.' };
  await advanceIfNeeded(resolved.bundle.room.id);
  const admin = createAdminClient();
  // Server clock lives inside the RPC: no client timestamp is sent.
  const { data, error } = await admin.rpc('submit_sandbox_bid', {
    p_room_id: resolved.bundle.room.id,
    p_participant_id: resolved.participantId,
    p_price_pyg: pricePyg,
    p_idempotency_key: `hum:${resolved.bundle.room.id}:${idempotencyKey}`,
  });
  if (error) return { error: 'No se pudo registrar la oferta.' };
  const res = data as { accepted: boolean; duplicate?: boolean; rejection_message?: string; rejection_code?: string };
  if (!res.accepted) {
    await admin.rpc('append_sandbox_event', {
      p_room_id: resolved.bundle.room.id,
      p_type: 'BID_REJECTED',
      p_payload: { price_pyg: pricePyg, rejection_code: res.rejection_code },
    });
    return { error: res.rejection_message ?? 'Oferta rechazada.' };
  }
  return { accepted: true };
}
