import Image from 'next/image';
import Link from 'next/link';
import { resolveSandboxRoom } from '../../token-gate';
import { WatchConsole } from './watch-console';

export default async function WatchPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const resolved = await resolveSandboxRoom(token, 'observer');
  if ('error' in resolved) {
    return (
      <div className="min-h-screen bg-[var(--background)] px-4 py-8">
        <div className="mx-auto w-full max-w-3xl space-y-4">
          <Image src="/logo/niupack-wordmark.svg" alt="niupack" width={120} height={26} priority />
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-6 text-[13px] space-y-2">
            <p className="font-semibold text-[14px]">Este enlace ya no es válido.</p>
            <p className="text-[var(--muted)]">
              {resolved.error} Si el operador regeneró los links o la sala terminó, pedile el link actual de observer.
            </p>
            <Link href="/" className="inline-block text-[var(--primary)] underline hover:no-underline">
              Volver al inicio
            </Link>
          </div>
        </div>
      </div>
    );
  }
  return <WatchConsole token={token} />;
}
