'use server';

import { createAdminClient } from '@/lib/supabase/admin';
import { buildWatchView, loadSandboxBundle, WatchView } from '@/lib/auction-sandbox/server';
import { resolveSandboxRoom } from '../../token-gate';

/** War-room is strictly READ ONLY: atomic advance heartbeat + redacted view. */
export async function getWatchView(token: string): Promise<{ view?: WatchView; error?: string }> {
  const resolved = await resolveSandboxRoom(token, 'observer');
  if ('error' in resolved) return { error: resolved.error };
  const admin = createAdminClient();
  await admin.rpc('advance_sandbox_room', { p_room_id: resolved.bundle.room.id });
  const loaded = await loadSandboxBundle(admin, resolved.bundle.room.id);
  if ('error' in loaded) return { error: loaded.error };
  const bundle = loaded.bundle;
  return { view: buildWatchView(bundle, new Date().toISOString()) };
}
