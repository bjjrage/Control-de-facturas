import { notFound } from 'next/navigation';
import { requireEmpresaId, requireProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { loadSandboxBundle } from '@/lib/auction-sandbox/server';
import { OperatorConsole } from './operator-console';

export default async function AuctionLabRoomPage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  const profile = await requireProfile(['comercial', 'administracion', 'admin']);
  const empresaId = await requireEmpresaId(['comercial', 'administracion', 'admin']);
  const supabase = await createClient();
  const loaded = await loadSandboxBundle(supabase, roomId);
  if ('error' in loaded) notFound();
  const bundle = loaded.bundle;
  if (!bundle || bundle.room.empresa_id !== empresaId) notFound();
  const canManage = profile.role === 'admin' || profile.role === 'administracion';

  return <OperatorConsole roomId={roomId} canManage={canManage} />;
}
