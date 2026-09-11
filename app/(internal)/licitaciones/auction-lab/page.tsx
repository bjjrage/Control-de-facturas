import { requireProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { CreateRoomForm } from './create-room-form';

export default async function AuctionLabPage() {
  await requireProfile(['comercial', 'administracion', 'admin']);
  const supabase = await createClient();
  const { data: rooms } = await supabase
    .from('auction_sandbox_rooms')
    .select('id, title, scope, group_id, status, opening_price_pyg, created_at')
    .order('created_at', { ascending: false })
    .limit(50);

  return (
    <div className="max-w-6xl space-y-6">
      <div className="mt-1">
        <h1 className="text-[17px] font-semibold">Auction Lab</h1>
        <p className="text-[13px] text-[var(--muted)] mt-0.5">
          Subastas simuladas para demo comercial y banco de pruebas del Auction Bot. Simulación — no es DNCP real.
        </p>
      </div>

      <CreateRoomForm />

      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Sala</th>
              <th>Alcance</th>
              <th className="num">Apertura</th>
              <th>Estado</th>
              <th>Creada</th>
            </tr>
          </thead>
          <tbody>
            {(rooms ?? []).map((r: { id: string; title: string; scope: string; group_id: string; status: string; opening_price_pyg: number; created_at: string }) => (
              <tr key={r.id}>
                <td>
                  <Link href={`/licitaciones/auction-lab/${r.id}`} className="text-action font-medium">
                    {r.title}
                  </Link>
                  <div className="text-[11px] text-[var(--muted)] font-mono">{r.group_id}</div>
                </td>
                <td className="text-[var(--muted)]">{r.scope}</td>
                <td className="num">₲ {Number(r.opening_price_pyg).toLocaleString('es-PY')}</td>
                <td className="text-[12px] text-[var(--muted)]">{r.status}</td>
                <td className="text-[var(--muted)] text-[12px]">{new Date(r.created_at).toLocaleString('es-PY')}</td>
              </tr>
            ))}
            {(rooms ?? []).length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center text-[13px] text-[var(--muted)] py-8">
                  Sin salas todavía. Creá una subasta de prueba arriba.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
