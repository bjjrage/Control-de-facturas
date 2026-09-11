import { notFound } from 'next/navigation';
import { resolveSandboxRoom } from '../../token-gate';
import { WatchConsole } from './watch-console';

export default async function WatchPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const resolved = await resolveSandboxRoom(token, 'observer');
  if ('error' in resolved) notFound();
  return <WatchConsole token={token} />;
}
