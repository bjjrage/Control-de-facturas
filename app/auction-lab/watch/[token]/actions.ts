'use server';

import { createAdminClient } from '@/lib/supabase/admin';
import { buildWatchView, loadSandboxBundle, WatchView } from '@/lib/auction-sandbox/server';
import { resolveSandboxRoom } from '../../token-gate';

/** War-room is strictly READ ONLY: reload + redacted view, zero writes.
 * The operator heartbeat is the exclusive mutating poller (F-G1). */
export async function getWatchView(token: string): Promise<{ view?: WatchView; error?: string }> {
  const resolved = await resolveSandboxRoom(token, 'observer');
  if ('error' in resolved) return { error: resolved.error };
  const admin = createAdminClient();
  const loaded = await loadSandboxBundle(admin, resolved.bundle.room.id);
  if ('error' in loaded) return { error: loaded.error };
  const bundle = loaded.bundle;
  return { view: buildWatchView(bundle, new Date().toISOString()) };
}
