'use server';

import { createAdminClient } from '@/lib/supabase/admin';
import { computeRoomAdvance, buildWatchView, loadSandboxBundle, WatchView } from '@/lib/auction-sandbox/server';
import { resolveSandboxRoom } from '../../token-gate';

/** War-room is strictly READ ONLY: advance (heartbeat) + redacted view. */
export async function getWatchView(token: string): Promise<{ view?: WatchView; error?: string }> {
  const resolved = await resolveSandboxRoom(token, 'observer');
  if ('error' in resolved) return { error: resolved.error };
  const admin = createAdminClient();
  const bundle0 = resolved.bundle;
  const nowIso = new Date().toISOString();
  const advance = computeRoomAdvance(bundle0, nowIso, Math.random());
  let bundle = bundle0;
  if (advance) {
    const seqBase = bundle0.room.next_sequence;
    const { data: updated } = await admin
      .from('auction_sandbox_rooms')
      .update({ ...advance.patch, next_sequence: seqBase + advance.events.length })
      .eq('id', bundle0.room.id)
      .eq('status', bundle0.room.status)
      .select('id');
    if (updated && updated.length > 0 && advance.events.length > 0) {
      await admin.from('auction_sandbox_events').insert(
        advance.events.map((e, i) => ({ room_id: bundle0.room.id, type: e.type, payload: e.payload, server_sequence: seqBase + i }))
      );
    }
    bundle = (await loadSandboxBundle(admin, bundle0.room.id)) ?? bundle0;
  }
  return { view: buildWatchView(bundle, new Date().toISOString()) };
}
