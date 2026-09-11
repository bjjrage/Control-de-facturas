'use server';

import { createAdminClient } from '@/lib/supabase/admin';
import { computeRoomAdvance, buildJoinView, loadSandboxBundle, JoinView } from '@/lib/auction-sandbox/server';
import { resolveSandboxRoom } from '../../token-gate';

async function advanceIfNeeded(roomId: string) {
  const admin = createAdminClient();
  const bundle = await loadSandboxBundle(admin, roomId);
  if (!bundle) return;
  const nowIso = new Date().toISOString();
  const advance = computeRoomAdvance(bundle, nowIso, Math.random());
  if (!advance) return;
  const seqBase = bundle.room.next_sequence;
  const { data: updated } = await admin
    .from('auction_sandbox_rooms')
    .update({ ...advance.patch, next_sequence: seqBase + advance.events.length })
    .eq('id', roomId)
    .eq('status', bundle.room.status)
    .select('id');
  if (updated && updated.length > 0 && advance.events.length > 0) {
    await admin.from('auction_sandbox_events').insert(
      advance.events.map((e, i) => ({ room_id: roomId, type: e.type, payload: e.payload, server_sequence: seqBase + i }))
    );
  }
}

export async function getJoinView(token: string): Promise<{ view?: JoinView; error?: string }> {
  const resolved = await resolveSandboxRoom(token, 'competitor');
  if ('error' in resolved) return { error: resolved.error };
  await advanceIfNeeded(resolved.bundle.room.id);
  const admin = createAdminClient();
  const bundle = (await loadSandboxBundle(admin, resolved.bundle.room.id)) ?? resolved.bundle;
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
  const nowIso = new Date().toISOString();
  const { data, error } = await admin.rpc('submit_sandbox_bid', {
    p_room_id: resolved.bundle.room.id,
    p_participant_id: resolved.participantId,
    p_price_pyg: pricePyg,
    p_now_iso: nowIso,
    p_idempotency_key: `hum:${resolved.bundle.room.id}:${idempotencyKey}`,
  });
  if (error) return { error: 'No se pudo registrar la oferta.' };
  const res = data as { accepted: boolean; duplicate?: boolean; rejection_message?: string; rejection_code?: string };
  if (!res.accepted) {
    const fresh = await loadSandboxBundle(admin, resolved.bundle.room.id);
    const seq = fresh?.room.next_sequence ?? 0;
    await admin.from('auction_sandbox_events').insert({
      room_id: resolved.bundle.room.id,
      type: 'BID_REJECTED',
      payload: { price_pyg: pricePyg, rejection_code: res.rejection_code },
      server_sequence: seq,
    });
    await admin.from('auction_sandbox_rooms').update({ next_sequence: seq + 1 }).eq('id', resolved.bundle.room.id);
    return { error: res.rejection_message ?? 'Oferta rechazada.' };
  }
  return { accepted: true };
}
