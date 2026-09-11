import { notFound } from 'next/navigation';
import { resolveSandboxRoom } from '../../token-gate';
import { JoinConsole } from './join-console';

export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const resolved = await resolveSandboxRoom(token, 'competitor');
  if ('error' in resolved) notFound();
  return <JoinConsole token={token} />;
}
